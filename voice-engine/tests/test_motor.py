"""Testes do motor sem o modelo real (que pesa 1,5 GB e precisa de rede).

O modelo é substituído por um dublê que devolve um tom senoidal com a duração
proporcional ao texto; o que se testa é o fluxo: divisão em trechos, pausa
entre eles, condicionais preparados uma vez por referência, normalização e
gravação do WAV.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
import pytest
import soundfile as sf
import torch

from irisflow_voz import motor as m
from irisflow_voz.motor import dividir_em_trechos


def test_dividir_em_trechos_respeita_frases_e_limite():
    assert dividir_em_trechos("") == []
    assert dividir_em_trechos("Oi.  Tudo bem?") == ["Oi. Tudo bem?"]
    longa = "palavra " * 60
    partes = dividir_em_trechos(longa.strip() + ". Fim.")
    assert all(len(p) <= m.TAMANHO_MAX_TRECHO for p in partes)
    assert partes[-1].endswith("Fim.")


def test_dividir_quebra_frase_gigante_nas_virgulas():
    frase = ", ".join(["um pedaço bem comprido de texto"] * 12) + "."
    partes = dividir_em_trechos(frase)
    assert len(partes) >= 2
    assert all(len(p) <= m.TAMANHO_MAX_TRECHO for p in partes)


class ModeloDuble:
    sr = 24000

    def __init__(self):
        self.preparos = 0
        self.gerados: list[str] = []

    def prepare_conditionals(self, caminho):
        self.preparos += 1

    def generate(self, texto, language_id):
        assert language_id == "pt"
        self.gerados.append(texto)
        n = int(0.05 * len(texto) * self.sr)
        t = np.arange(n) / self.sr
        return torch.from_numpy((2.0 * np.sin(2 * np.pi * 220 * t)).astype(np.float32))[None, :]


def test_falar_concatena_trechos_e_normaliza(tmp_path):
    ref = tmp_path / "ref.wav"
    sf.write(ref, np.zeros(24000, dtype=np.float32), 24000)
    motor = m.Motor()
    duble = ModeloDuble()
    motor._modelo = duble  # noqa: SLF001 — injeta o dublê
    motor.dispositivo = "cpu"

    saida = tmp_path / "fala.wav"
    r = motor.falar("Primeira frase. Segunda frase!", str(ref), str(saida), "pt")
    assert r["trechos"] == 1  # cabem num trecho só
    audio, sr = sf.read(saida)
    assert sr == 24000
    assert float(np.max(np.abs(audio))) <= 0.9 + 1e-3  # normalizado
    assert duble.preparos == 1

    # Segunda fala com a MESMA referência não refaz os condicionais.
    motor.falar("Outra.", str(ref), str(saida), "pt")
    assert duble.preparos == 1

    # Referência alterada (mtime novo) refaz.
    os.utime(ref, (os.path.getmtime(ref) + 10, os.path.getmtime(ref) + 10))
    motor.falar("Outra.", str(ref), str(saida), "pt")
    assert duble.preparos == 2


def test_falar_texto_longo_vira_varios_trechos_com_pausa(tmp_path):
    ref = tmp_path / "ref.wav"
    sf.write(ref, np.zeros(24000, dtype=np.float32), 24000)
    motor = m.Motor()
    motor._modelo = ModeloDuble()  # noqa: SLF001
    texto = " ".join(f"Frase número {i} com algumas palavras a mais." for i in range(12))
    r = motor.falar(texto, str(ref), str(tmp_path / "f.wav"), "pt")
    assert r["trechos"] >= 2
    audio, sr = sf.read(tmp_path / "f.wav")
    esperado = sum(int(0.05 * len(t) * sr) for t in dividir_em_trechos(texto)) + (r["trechos"] - 1) * int(m.PAUSA_ENTRE_TRECHOS_S * sr)
    assert abs(len(audio) - esperado) < 10


def test_protocolo_ponta_a_ponta_status_e_erro():
    """Sobe o processo de verdade: status responde, comando desconhecido devolve ok=false, `sair` encerra."""
    pedidos = "\n".join([
        json.dumps({"id": 1, "cmd": "status"}),
        json.dumps({"id": 2, "cmd": "nao_existe"}),
        "isto não é json",
        json.dumps({"id": 3, "cmd": "sair"}),
    ]) + "\n"
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = subprocess.run([sys.executable, "-m", "irisflow_voz"], input=pedidos, capture_output=True, text=True, cwd=raiz, timeout=120)
    linhas = [json.loads(l) for l in p.stdout.splitlines() if l.startswith("{")]
    por_id = {l["id"]: l for l in linhas if "id" in l}
    # `dispositivo` só é conhecido depois de carregar o modelo (e `status` não
    # importa o torch de propósito): antes disso vem None.
    assert por_id[1]["ok"] is True and por_id[1]["dispositivo"] in (None, "cpu", "cuda")
    assert por_id[1]["modelo_baixado"] is False
    assert por_id[2]["ok"] is False
    assert por_id[3]["ok"] is True
    assert p.returncode == 0


@pytest.mark.skipif(not os.environ.get("IRISFLOW_AUDIO_TESTE"), reason="defina IRISFLOW_AUDIO_TESTE=<arquivo> para testar o preparo com áudio real")
def test_preparo_com_audio_real(tmp_path):
    from irisflow_voz.audio import preparar_referencia

    r = preparar_referencia(os.environ["IRISFLOW_AUDIO_TESTE"], str(tmp_path / "ref.wav"))
    assert r.duracao_referencia_s <= 12.5
    assert r.qualidade in ("boa", "aceitavel", "fraca")


def test_guarda_de_memoria_recusa_antes_de_importar_o_torch(monkeypatch):
    from irisflow_voz import recursos

    monkeypatch.setattr(recursos, "maquina", lambda: recursos.Maquina(8.0, 2.0, 4))
    monkeypatch.setattr(m, "verificar_memoria_para_carregar", recursos.verificar_memoria_para_carregar)
    motor = m.Motor()
    with pytest.raises(MemoryError, match="Memória livre insuficiente"):
        motor.carregar()
    assert motor.pronto() is False


def test_nucleos_para_torch_deixa_metade_para_o_rastreamento(monkeypatch):
    from irisflow_voz import recursos

    monkeypatch.setattr(os, "cpu_count", lambda: 8)
    assert recursos.nucleos_para_torch() == 4
    monkeypatch.setattr(os, "cpu_count", lambda: 2)
    assert recursos.nucleos_para_torch() == 1
    monkeypatch.setattr(os, "cpu_count", lambda: 16)
    assert recursos.nucleos_para_torch() == 4
