"""Leitura e escrita do protocolo JSON-por-linha.

O stdout é RESERVADO ao protocolo. Bibliotecas de áudio e o PyTorch imprimem
avisos no stdout sem pedir licença, e uma linha que não é JSON no meio do fluxo
faria o Electron perder uma resposta. Por isso, na abertura, o descritor 1 é
duplicado para o canal do protocolo e o ``sys.stdout`` do processo passa a
apontar para o stderr: o que as bibliotecas imprimirem vai para o log, e só o
que sai por ``responder``/``evento`` chega ao Electron.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any, Iterator

_lock = threading.Lock()
_canal = None


def preparar_canais() -> None:
    """Chame uma vez, antes de importar qualquer biblioteca barulhenta."""
    global _canal
    if _canal is not None:
        return
    fd = os.dup(1)
    _canal = os.fdopen(fd, "w", encoding="utf-8", buffering=1)
    # Depois da cópia, o descritor 1 passa a apontar para o stderr: até o que
    # for escrito em C (bibliotecas nativas, filhos herdados) sai do protocolo.
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    # Entrada sempre UTF-8. No Windows um stdin por pipe usa a página de código
    # ANSI: "ção" chegaria trocado e um "Á" (byte 0x81) derrubaria o leitor.
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass


def _escrever(obj: dict[str, Any]) -> None:
    linha = json.dumps(obj, ensure_ascii=False)
    # Sem canal (uso como biblioteca, testes): a mensagem vai para o stderr,
    # onde não confunde ninguém que esteja lendo o stdout como protocolo.
    if _canal is None:
        print(linha, file=sys.stderr, flush=True)
        return
    with _lock:
        _canal.write(linha + "\n")
        _canal.flush()


def responder(pedido_id: int, ok: bool, **campos: Any) -> None:
    _escrever({"id": pedido_id, "ok": ok, **campos})


def evento(nome: str, **campos: Any) -> None:
    _escrever({"evento": nome, **campos})


def log(mensagem: str) -> None:
    """Log para o Electron (stderr) e como evento, para depuração na tela."""
    print(f"[irisflow-voz] {mensagem}", file=sys.stderr, flush=True)


def pedidos() -> Iterator[dict[str, Any]]:
    """Itera os pedidos do stdin até EOF. Linhas inválidas viram log, não erro."""
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            obj = json.loads(linha)
        except json.JSONDecodeError:
            log(f"linha ignorada (não é JSON): {linha[:80]}")
            continue
        if isinstance(obj, dict) and isinstance(obj.get("id"), int) and isinstance(obj.get("cmd"), str):
            yield obj
        else:
            log(f"pedido malformado ignorado: {linha[:80]}")
