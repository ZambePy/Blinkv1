"""Carga do modelo e síntese.

Chatterbox multilíngue (Resemble AI, licença MIT): clonagem zero-shot a partir
de uma referência de poucos segundos, 23 idiomas incluindo português. O modelo
é carregado uma vez por processo e fica em memória — em CPU a carga leva
dezenas de segundos, e é ela, não a síntese, que o paciente sentiria a cada
frase se fosse refeita.

Os pesos são baixados do Hugging Face para ``HF_HOME`` (o Electron aponta para
a pasta de dados do app) na primeira vez, com progresso reportado por evento.
Depois disso nada mais sai do computador: ``HF_HUB_OFFLINE`` é ligado assim
que o modelo está completo.
"""

from __future__ import annotations

import os
import re
import time
from typing import Callable, Optional

from .protocolo import evento, log
from .recursos import nucleos_para_torch, verificar_memoria_para_carregar

REPO_ID = "ResembleAI/chatterbox"
# Arquivos que ``ChatterboxMultilingualTTS.from_pretrained`` pede. Mantido
# explícito para o teste de "modelo baixado?" não precisar importar o torch.
ARQUIVOS_MTL = [
    "ve.pt",
    "t3_mtl23ls_v2.safetensors",
    "s3gen.pt",
    "grapheme_mtl_merged_expanded_v1.json",
    "conds.pt",
    "Cangjie5_TC.json",
]
IDIOMA_PADRAO = "pt"
TAMANHO_MAX_TRECHO = 220
PAUSA_ENTRE_TRECHOS_S = 0.25


def modelo_baixado() -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache
    except Exception:  # noqa: BLE001
        return False
    for nome in ARQUIVOS_MTL:
        r = try_to_load_from_cache(REPO_ID, nome)
        if not isinstance(r, str) or not os.path.exists(r):
            return False
    return True


def baixar_modelo(progresso: Callable[[str, float], None]) -> None:
    from huggingface_hub import hf_hub_download

    total = len(ARQUIVOS_MTL)
    for i, nome in enumerate(ARQUIVOS_MTL):
        progresso(nome, 100.0 * i / total)
        hf_hub_download(REPO_ID, nome)
    progresso("concluído", 100.0)


def dispositivo_disponivel() -> str:
    """Importa o torch (centenas de MB): só chame quando for carregar o modelo."""
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


def dividir_em_trechos(texto: str, maximo: int = TAMANHO_MAX_TRECHO) -> list[str]:
    """Frases inteiras por trecho; uma frase longa demais é quebrada em vírgulas.

    O modelo perde qualidade (e memória) em textos longos, e o paciente ouve o
    primeiro trecho enquanto o segundo ainda é gerado.
    """
    texto = re.sub(r"\s+", " ", texto).strip()
    if not texto:
        return []
    frases = re.split(r"(?<=[.!?…])\s+", texto)
    trechos: list[str] = []
    atual = ""

    def por_palavras(s: str) -> list[str]:
        # Último recurso: sem pontuação nenhuma, corta em palavras.
        out: list[str] = []
        linha = ""
        for w in s.split(" "):
            if linha and len(linha) + 1 + len(w) > maximo:
                out.append(linha)
                linha = w
            else:
                linha = f"{linha} {w}" if linha else w
        if linha:
            out.append(linha)
        return out

    for f in frases:
        if len(f) > maximo:
            pedacos = [q for p in re.split(r"(?<=[,;:])\s+", f) for q in (por_palavras(p) if len(p) > maximo else [p])]
        else:
            pedacos = [f]
        for p in pedacos:
            if not atual:
                atual = p
            elif len(atual) + 1 + len(p) <= maximo:
                atual = f"{atual} {p}"
            else:
                trechos.append(atual)
                atual = p
    if atual:
        trechos.append(atual)
    return trechos


class Motor:
    def __init__(self) -> None:
        self._modelo = None
        self.dispositivo: Optional[str] = None
        # (caminho, mtime) da referência cujos condicionais já estão no modelo.
        # `prepare_conditionals` custa segundos em CPU; refazê-lo a cada frase
        # dobraria a latência de tudo que o paciente diz.
        self._referencia_preparada: Optional[tuple[str, float]] = None

    def pronto(self) -> bool:
        return self._modelo is not None

    def carregar(self) -> None:
        if self._modelo is not None:
            return
        # Guarda de memória ANTES de importar o torch: num computador apertado,
        # o carregamento levava a máquina inteira para o swap.
        recusa = verificar_memoria_para_carregar()
        if recusa:
            raise MemoryError(recusa)
        inicio = time.time()
        # Só sobe o modo offline quando os arquivos já estão todos no disco:
        # antes disso o from_pretrained ainda precisa baixar. A variável de
        # ambiente é lida pelo huggingface_hub na IMPORTAÇÃO (que `status` já
        # fez), então a constante do módulo é ajustada diretamente também.
        if modelo_baixado():
            os.environ["HF_HUB_OFFLINE"] = "1"
            try:
                from huggingface_hub import constants as hf_constants

                hf_constants.HF_HUB_OFFLINE = True
            except Exception:  # noqa: BLE001
                pass
        import torch

        self.dispositivo = dispositivo_disponivel()
        if self.dispositivo == "cpu":
            # Metade dos núcleos (1–4): o rastreamento ocular e a interface
            # rodam ao lado e precisam do resto para não engasgar.
            torch.set_num_threads(nucleos_para_torch())
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                pass  # só pode ser chamado antes do primeiro uso paralelo
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        evento("progresso", etapa="carregando modelo", pct=None)
        self._modelo = ChatterboxMultilingualTTS.from_pretrained(device=self.dispositivo)
        log(f"modelo carregado em {time.time() - inicio:.1f}s ({self.dispositivo})")

    def falar(self, texto: str, referencia: str, saida: str, idioma: str = IDIOMA_PADRAO) -> dict:
        import numpy as np
        import soundfile as sf
        import torch

        self.carregar()
        assert self._modelo is not None
        trechos = dividir_em_trechos(texto)
        if not trechos:
            raise ValueError("Texto vazio.")
        sr = int(self._modelo.sr)
        pausa = np.zeros(int(PAUSA_ENTRE_TRECHOS_S * sr), dtype=np.float32)
        partes: list[np.ndarray] = []
        inicio = time.time()
        chave = (referencia, os.path.getmtime(referencia))
        if self._referencia_preparada != chave:
            with torch.inference_mode():
                self._modelo.prepare_conditionals(referencia)
            self._referencia_preparada = chave
        for i, trecho in enumerate(trechos):
            with torch.inference_mode():
                wav = self._modelo.generate(trecho, language_id=idioma)
            y = wav.squeeze().detach().cpu().numpy().astype(np.float32)
            if partes:
                partes.append(pausa)
            partes.append(y)
            evento("progresso", etapa="sintetizando", pct=100.0 * (i + 1) / len(trechos))
        audio = np.concatenate(partes)
        pico = float(np.max(np.abs(audio))) if audio.size else 0.0
        if pico > 0.9:
            audio = audio / pico * 0.9
        sf.write(saida, audio, sr, subtype="PCM_16")
        return {
            "duracao_s": round(audio.shape[0] / sr, 2),
            "ms": int((time.time() - inicio) * 1000),
            "trechos": len(trechos),
            "dispositivo": self.dispositivo,
        }
