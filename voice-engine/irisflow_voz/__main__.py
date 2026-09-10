"""Ponto de entrada: ``python -m irisflow_voz`` (dev) ou ``irisflow-voz.exe`` (build).

Lê pedidos JSON do stdin, um por linha, e responde no stdout. Comandos:

  status               → {pronto, dispositivo, modelo_baixado, versao}
  baixar_modelo        → eventos "progresso" e, ao fim, ok
  preparar_referencia  → {duracao_original_s, duracao_util_s, snr_db,
                          reduziu_ruido, qualidade, avisos}
  falar                → {duracao_s, ms, trechos, dispositivo}
  sair                 → encerra o processo

Um pedido por vez, na ordem: o Electron serializa. Um erro numa síntese volta
como ``ok: false`` com a mensagem — o processo continua vivo.
"""

from __future__ import annotations

import os
import sys
import traceback

from . import __version__
from .protocolo import evento, log, pedidos, preparar_canais, responder
from .recursos import baixar_prioridade, maquina


def _configurar_ambiente() -> None:
    # A pasta dos pesos vem do Electron (HF_HOME). Sem ela, o Hugging Face
    # usaria ~/.cache — funciona, mas espalha 1,5 GB fora da pasta do app.
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def _descrever_erro(e: BaseException) -> str:
    """Mensagem com a CAUSA raiz.

    O importador preguiçoso do ``transformers`` embrulha qualquer falha como
    "Could not import module 'LlamaModel'. Are this object's requirements
    defined correctly?" — a exceção de verdade (DLL do torch que não carrega,
    versão incompatível, pacote faltando) fica em ``__cause__``. Sem a cadeia,
    a tela mostra a embalagem e esconde o motivo.
    """
    partes: list[str] = []
    atual: BaseException | None = e
    vistos: set[int] = set()
    while atual is not None and id(atual) not in vistos and len(partes) < 4:
        vistos.add(id(atual))
        partes.append(f"{type(atual).__name__}: {atual}")
        atual = atual.__cause__ or atual.__context__
    return " ← causa: ".join(partes)


def _linha_de_comando(argv: list[str]) -> int:
    """Uso direto no terminal, sem o Electron — para testar o motor isolado.

      python -m irisflow_voz --diagnostico
      python -m irisflow_voz --preparar entrada.ogg saida.wav
      python -m irisflow_voz --falar "texto" referencia.wav saida.wav
    """
    import argparse
    import json

    ap = argparse.ArgumentParser(prog="irisflow_voz")
    ap.add_argument("--diagnostico", action="store_true", help="versões, memória, núcleos, modelo baixado")
    ap.add_argument("--preparar", nargs=2, metavar=("ENTRADA", "SAIDA_WAV"), help="prepara um áudio de referência")
    ap.add_argument("--falar", nargs=3, metavar=("TEXTO", "REFERENCIA_WAV", "SAIDA_WAV"), help="sintetiza uma frase")
    ap.add_argument("--baixar", action="store_true", help="baixa os pesos do modelo (HF_HOME)")
    args = ap.parse_args(argv)
    _configurar_ambiente()
    from . import motor as m

    if args.diagnostico:
        info = {"versao": __version__, "python": sys.version.split()[0], "maquina": maquina().para_json(), "modelo_baixado": m.modelo_baixado(), "hf_home": os.environ.get("HF_HOME")}
        try:
            import torch

            info["torch"] = torch.__version__
            info["cuda"] = torch.cuda.is_available()
        except Exception as e:  # noqa: BLE001
            info["torch"] = f"erro: {e}"
        try:
            import transformers

            info["transformers"] = transformers.__version__
        except Exception as e:  # noqa: BLE001
            info["transformers"] = f"erro: {e}"
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0
    if args.baixar:
        m.baixar_modelo(lambda etapa, pct: print(f"{pct:5.1f}%  {etapa}"))
        return 0
    if args.preparar:
        from .audio import preparar_referencia

        r = preparar_referencia(args.preparar[0], args.preparar[1])
        print(json.dumps({**r.__dict__, "qualidade": r.qualidade}, ensure_ascii=False, indent=2))
        return 0
    if args.falar:
        motor = m.Motor()
        r = motor.falar(args.falar[0], args.falar[1], args.falar[2])
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0
    ap.print_help()
    return 2


def main() -> int:
    if len(sys.argv) > 1:
        return _linha_de_comando(sys.argv[1:])
    preparar_canais()
    _configurar_ambiente()
    baixar_prioridade()
    from . import motor as m

    motor = m.Motor()
    log(f"motor de voz v{__version__} iniciado (pid {os.getpid()})")

    for pedido in pedidos():
        pid = pedido["id"]
        cmd = pedido["cmd"]
        try:
            if cmd == "status":
                # `dispositivo` só é conhecido depois de carregar o modelo:
                # descobrir antes exigiria importar o torch a cada consulta.
                responder(
                    pid, True,
                    pronto=motor.pronto(),
                    dispositivo=motor.dispositivo,
                    modelo_baixado=m.modelo_baixado(),
                    versao=__version__,
                    maquina=maquina().para_json(),
                )
            elif cmd == "baixar_modelo":
                if m.modelo_baixado():
                    responder(pid, True, ja_estava=True)
                    continue
                m.baixar_modelo(lambda etapa, pct: evento("progresso", etapa=etapa, pct=pct))
                responder(pid, True, ja_estava=False)
            elif cmd == "preparar_referencia":
                from .audio import preparar_referencia

                r = preparar_referencia(str(pedido["entrada"]), str(pedido["saida"]))
                responder(
                    pid, True,
                    duracao_original_s=r.duracao_original_s,
                    duracao_util_s=r.duracao_util_s,
                    duracao_referencia_s=r.duracao_referencia_s,
                    snr_db=r.snr_db,
                    reduziu_ruido=r.reduziu_ruido,
                    qualidade=r.qualidade,
                    avisos=r.avisos,
                )
            elif cmd == "falar":
                r = motor.falar(
                    str(pedido["texto"]),
                    str(pedido["referencia"]),
                    str(pedido["saida"]),
                    str(pedido.get("idioma") or m.IDIOMA_PADRAO),
                )
                responder(pid, True, **r)
            elif cmd == "sair":
                responder(pid, True)
                return 0
            else:
                responder(pid, False, erro=f"comando desconhecido: {cmd}")
        except Exception as e:  # noqa: BLE001 — o processo sobrevive ao pedido
            log(traceback.format_exc())
            responder(pid, False, erro=_descrever_erro(e))
    return 0


if __name__ == "__main__":
    sys.exit(main())
