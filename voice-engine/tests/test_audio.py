"""Preparo da referência com áudio sintético: sem rede, sem modelo."""

from __future__ import annotations

import numpy as np
import soundfile as sf

from irisflow_voz.audio import DURACAO_MAX_UTIL_S, classificar, preparar_referencia

SR = 24000


def _voz_sintetica(segundos: float, ruido: float = 0.0, pausas: bool = True) -> np.ndarray:
    """Vogal com vibrato (parece voz para o detector de energia), com pausas."""
    t = np.arange(int(segundos * SR)) / SR
    f0 = 140 + 10 * np.sin(2 * np.pi * 5 * t)
    voz = 0.5 * np.sin(2 * np.pi * np.cumsum(f0) / SR) + 0.2 * np.sin(2 * np.pi * 2 * np.cumsum(f0) / SR)
    if pausas:
        envelope = ((np.sin(2 * np.pi * 0.4 * t) > -0.3)).astype(np.float32)  # ~70 % do tempo falando
        voz = voz * envelope
    rng = np.random.default_rng(7)
    return (voz + ruido * rng.standard_normal(t.shape[0])).astype(np.float32)


def test_audio_limpo_e_longo_e_boa_e_cabe_no_orcamento(tmp_path):
    entrada = tmp_path / "in.wav"
    sf.write(entrada, _voz_sintetica(40), SR)
    r = preparar_referencia(str(entrada), str(tmp_path / "ref.wav"))
    assert r.qualidade == "boa"
    assert r.duracao_referencia_s <= DURACAO_MAX_UTIL_S + 0.5
    assert r.duracao_util_s > 15
    dados, sr = sf.read(tmp_path / "ref.wav")
    assert sr == SR and abs(float(np.max(np.abs(dados))) - 0.7079) < 0.02


def test_audio_ruidoso_e_reduzido_e_classificado_pela_fonte(tmp_path):
    entrada = tmp_path / "in.wav"
    sf.write(entrada, _voz_sintetica(30, ruido=0.08), SR)
    r = preparar_referencia(str(entrada), str(tmp_path / "ref.wav"))
    assert r.reduziu_ruido is True
    assert r.qualidade in ("aceitavel", "fraca")
    assert any("Ruído" in a for a in r.avisos)


def test_audio_curto_avisa(tmp_path):
    entrada = tmp_path / "in.wav"
    sf.write(entrada, _voz_sintetica(4, pausas=False), SR)
    r = preparar_referencia(str(entrada), str(tmp_path / "ref.wav"))
    assert r.qualidade == "fraca"
    assert any("Menos de 6 s" in a for a in r.avisos)


def test_classificar_espelha_o_typescript():
    assert classificar(4, 30) == "fraca"
    assert classificar(40, 8) == "fraca"
    assert classificar(10, 25) == "aceitavel"
    assert classificar(20, 25) == "boa"
    assert classificar(20, 15) == "aceitavel"
    assert classificar(20, None) == "boa"
