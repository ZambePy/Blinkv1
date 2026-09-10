"""Recursos da máquina: memória, núcleos, prioridade.

O modelo multilíngue ocupa ~3,5 GB de RAM carregado em CPU (pesos em fp32 +
ativações). Num computador de 8 GB com o Electron, a câmera e o rastreamento
rodando ao lado, carregar isso sem olhar a memória livre leva o Windows a
trocar tudo para o disco — e a máquina "trava", que foi exatamente o que
aconteceu no primeiro teste. Este módulo é a guarda: mede antes de carregar,
recusa com uma mensagem clara quando não cabe, e baixa a prioridade do
processo para o rastreamento ocular continuar fluido enquanto a voz gera.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

# O que o modelo precisa em CPU, medido com folga: pesos (~3,2 GB) + ativações
# de uma frase + o próprio Python/torch (~0,7 GB).
MEMORIA_NECESSARIA_GB = 4.5
# Abaixo disto o total da máquina é considerado insuficiente para a voz, mesmo
# com tudo fechado — o app continua funcionando com a voz do sistema.
MEMORIA_TOTAL_MINIMA_GB = 12.0
# Núcleos que o torch pode usar. Metade dos núcleos, entre 1 e 4: o
# rastreamento ocular e a interface precisam do resto para não engasgar.
NUCLEOS_MAX_PARA_TORCH = 4


@dataclass
class Maquina:
    memoria_total_gb: float
    memoria_livre_gb: float
    nucleos: int

    def para_json(self) -> dict:
        return {
            "memoria_total_gb": round(self.memoria_total_gb, 1),
            "memoria_livre_gb": round(self.memoria_livre_gb, 1),
            "nucleos": self.nucleos,
        }


def maquina() -> Maquina:
    nucleos = os.cpu_count() or 1
    try:
        import psutil

        vm = psutil.virtual_memory()
        return Maquina(vm.total / 2**30, vm.available / 2**30, nucleos)
    except Exception:  # noqa: BLE001 — sem psutil, sem medida (não bloqueia)
        return Maquina(0.0, 0.0, nucleos)


def verificar_memoria_para_carregar() -> Optional[str]:
    """Mensagem de recusa, ou None quando dá para carregar o modelo."""
    m = maquina()
    if m.memoria_total_gb == 0.0:
        return None  # não conseguiu medir: segue, mas sem garantia
    if m.memoria_livre_gb < MEMORIA_NECESSARIA_GB:
        return (
            f"Memória livre insuficiente para a voz personalizada: {m.memoria_livre_gb:.1f} GB livres, "
            f"o modelo precisa de {MEMORIA_NECESSARIA_GB:.1f} GB. Feche outros programas ou use a voz do sistema."
        )
    return None


def nucleos_para_torch() -> int:
    n = os.cpu_count() or 2
    return max(1, min(NUCLEOS_MAX_PARA_TORCH, n // 2))


def baixar_prioridade() -> None:
    """Abaixo do normal: a voz espera; o olhar do paciente não."""
    try:
        import psutil

        p = psutil.Process()
        if os.name == "nt":
            p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        else:
            p.nice(10)
    except Exception:  # noqa: BLE001
        pass
