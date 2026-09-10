"""Preparo do áudio de referência.

O áudio que a família tem de uma voz perdida raramente é um WAV limpo: é uma
nota de voz de WhatsApp (Opus a 16 kHz), um vídeo com música ao fundo, uma
gravação com o ventilador ligado. O modelo clona o que ouve — inclusive o
ventilador. Este módulo faz o que um técnico de som faria antes de entregar
a referência ao modelo:

  1. decodifica qualquer formato que o libsndfile/ffmpeg leia, em mono 24 kHz;
  2. mede a relação sinal/ruído comparando a energia dos trechos com fala e
     dos trechos de pausa;
  3. reduz ruído estacionário quando a medição justifica;
  4. tira um filtro passa-altas leve (zumbido, vento no microfone);
  5. corta silêncios longos e escolhe os melhores trechos, até ~12 s, os mais
     longos primeiro — o Chatterbox condiciona nos PRIMEIROS 10 s da
     referência (6 s para o timbre do texto, 10 s para o decodificador), então
     o que vale é o que está no começo do arquivo, não a duração total;
  6. normaliza o pico e grava WAV 16 bits.

Devolve números que o app mostra ao cuidador (duração útil, SNR, avisos), e a
classificação em ``boa`` / ``aceitável`` / ``fraca`` segue a mesma regra do
lado TypeScript (``classificarReferencia`` em ``src/voz/protocolo.ts``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

SR = 24000
DURACAO_MAX_UTIL_S = 12.0
DURACAO_MIN_SEGMENTO_S = 0.3
PAUSA_ENTRE_SEGMENTOS_S = 0.15
TOP_DB = 32


@dataclass
class ResultadoDoPreparo:
    duracao_original_s: float
    """Fala útil encontrada no áudio (soma dos trechos com voz), em s."""
    duracao_util_s: float
    """Duração do arquivo de referência gravado (≤ DURACAO_MAX_UTIL_S), em s."""
    duracao_referencia_s: float
    snr_db: Optional[float]
    reduziu_ruido: bool
    avisos: list[str] = field(default_factory=list)

    @property
    def qualidade(self) -> str:
        return classificar(self.duracao_util_s, self.snr_db)


def classificar(duracao_util_s: float, snr_db: Optional[float]) -> str:
    """Espelho de ``classificarReferencia`` (TypeScript). Mudou lá, muda aqui."""
    if not math.isfinite(duracao_util_s) or duracao_util_s < 6:
        return "fraca"
    if snr_db is not None and math.isfinite(snr_db) and snr_db < 12:
        return "fraca"
    if duracao_util_s < 15:
        return "aceitavel"
    if snr_db is not None and math.isfinite(snr_db) and snr_db < 20:
        return "aceitavel"
    return "boa"


def _rms(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def _intervalos_de_fala(y: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    if y.size == 0:
        return np.zeros((0, 2), dtype=int)
    return librosa.effects.split(y, top_db=TOP_DB, frame_length=2048, hop_length=512)


def _snr(y: np.ndarray, sr: int) -> Optional[float]:
    """SNR por percentis da energia por quadro: p75 (fala) sobre p10 (fundo).

    Não depende de achar pausas. Num áudio com ventilador constante o detector
    de silêncio não acha pausa nenhuma e uma medição "fala vs. pausa" fica
    indefinida — justamente no caso em que mais interessa medir. O p10 dos
    quadros é o chão de ruído mesmo quando a pessoa fala sem parar (as
    consoantes surdas e as respirações caem lá).
    """
    import librosa

    if y.shape[0] < sr:  # menos de 1 s: não há estatística
        return None
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    p10, p75 = np.percentile(rms, [10, 75])
    if p75 <= 1e-6:
        return 0.0
    return float(20.0 * math.log10(p75 / max(float(p10), 1e-6)))


def _passa_altas(y: np.ndarray, sr: int, corte_hz: float = 70.0) -> np.ndarray:
    from scipy.signal import butter, sosfiltfilt

    sos = butter(2, corte_hz / (sr / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, y).astype(np.float32)


def _escolher_segmentos(y: np.ndarray, intervalos: np.ndarray, sr: int) -> tuple[np.ndarray, list[str], float]:
    """Devolve (referência montada, avisos, segundos de fala útil no áudio todo)."""
    avisos: list[str] = []
    minimo = int(DURACAO_MIN_SEGMENTO_S * sr)
    candidatos = [(int(a), int(b)) for a, b in intervalos if b - a >= minimo]
    if not candidatos:
        return y, ["Não foi possível separar fala de silêncio; o áudio inteiro foi usado."], y.shape[0] / sr
    fala_util_s = sum(b - a for a, b in candidatos) / sr

    # Os trechos mais longos primeiro: são os de timbre mais estável, e só os
    # primeiros ~10 s da referência entram no condicionamento do modelo. A
    # ordem das frases não importa para o timbre.
    orcamento = int(DURACAO_MAX_UTIL_S * sr)
    pausa_n = int(PAUSA_ENTRE_SEGMENTOS_S * sr)
    por_tamanho = sorted(candidatos, key=lambda ab: ab[1] - ab[0], reverse=True)
    escolhidos: list[tuple[int, int]] = []
    total = 0
    for a, b in por_tamanho:
        restante = orcamento - total - (pausa_n if escolhidos else 0)
        if restante < minimo:
            break
        # Um trecho maior que o orçamento restante entra cortado: um monólogo
        # de 40 s sem pausa não pode virar uma referência de 40 s.
        b = min(b, a + restante)
        escolhidos.append((a, b))
        total += (b - a) + (pausa_n if len(escolhidos) > 1 else 0)
    if len(escolhidos) < len(candidatos):
        avisos.append(f"Áudio longo: foram usados os melhores ~{DURACAO_MAX_UTIL_S:.0f} s.")

    pausa = np.zeros(pausa_n, dtype=np.float32)
    partes: list[np.ndarray] = []
    for a, b in escolhidos:
        if partes:
            partes.append(pausa)
        partes.append(y[a:b])
    return np.concatenate(partes), avisos, fala_util_s


def preparar_referencia(entrada: str, saida: str) -> ResultadoDoPreparo:
    import librosa
    import soundfile as sf

    try:
        y, sr = librosa.load(entrada, sr=SR, mono=True)
    except Exception as e:  # noqa: BLE001 — a mensagem crua do audioread não ajuda ninguém
        nome = type(e).__name__
        if "NoBackend" in nome or "backend" in str(e).lower():
            raise ValueError(
                "Este formato precisa do ffmpeg instalado no computador para ser lido. "
                "Converta o arquivo para WAV, MP3, OGG ou FLAC e tente de novo."
            ) from e
        raise ValueError(f"Não foi possível ler o áudio ({nome}). Tente outro arquivo ou formato.") from e
    y = np.asarray(y, dtype=np.float32)
    duracao_original = y.shape[0] / SR
    avisos: list[str] = []
    if duracao_original < 2.0:
        raise ValueError("O áudio tem menos de 2 segundos. Escolha uma gravação mais longa.")

    y = _passa_altas(y, SR)

    # A qualidade é classificada pelo SNR do áudio ORIGINAL: a redução de ruído
    # melhora o número, mas deixa artefatos que o modelo também clona. O
    # cuidador deve saber que a fonte era ruidosa.
    snr = _snr(y, SR)
    reduziu = False
    if snr is not None and snr < 20.0:
        try:
            import noisereduce as nr

            y = nr.reduce_noise(y=y, sr=SR, stationary=True, prop_decrease=0.85).astype(np.float32)
            reduziu = True
            avisos.append("Ruído de fundo reduzido automaticamente; a voz pode sair um pouco abafada.")
        except Exception as e:  # noqa: BLE001 — sem redução o preparo continua
            avisos.append(f"Redução de ruído indisponível ({type(e).__name__}); áudio usado como está.")

    intervalos = _intervalos_de_fala(y, SR)
    util, avisos_seg, fala_util_s = _escolher_segmentos(y, intervalos, SR)
    avisos.extend(avisos_seg)

    pico = float(np.max(np.abs(util))) if util.size else 0.0
    if pico > 0:
        util = (util / pico * 0.7079).astype(np.float32)  # −3 dBFS
    else:
        raise ValueError("O áudio está em silêncio.")

    if fala_util_s < 6.0:
        avisos.append("Menos de 6 s de fala útil: o timbre pode sair instável. Se puder, use um áudio mais longo.")

    sf.write(saida, util, SR, subtype="PCM_16")
    return ResultadoDoPreparo(
        duracao_original_s=round(duracao_original, 2),
        duracao_util_s=round(fala_util_s, 2),
        duracao_referencia_s=round(util.shape[0] / SR, 2),
        snr_db=None if snr is None else round(snr, 1),
        reduziu_ruido=reduziu,
        avisos=avisos,
    )
