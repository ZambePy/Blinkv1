"""Entrada para o PyInstaller (o `-m irisflow_voz` não funciona num executável)."""

import sys

from irisflow_voz.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
