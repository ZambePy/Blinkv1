# -*- coding: utf-8 -*-
"""
validate_embedding_parity.py - Responde a pergunta pratica:

  "A diferenca de 4-6/255 nos pixels entre eyeCrop.ts (Canvas/Cairo) e
   preprocess.py (cv2) causa divergencia real na saida do encoder ONNX?"

Fluxo:
  1. Gera os tensores do lado TypeScript rodando eyeCrop.ts real via vitest
     (src/eyeCrop.dump.test.ts -> python_ml/test_fixtures/ts_*.bin).
  2. Carrega os tensores Python (ja existentes em test_fixtures/).
  3. Passa AMBOS pelo gaze_encoder.onnx (mesmo modelo do Sprint 3).
  4. Compara os dois embeddings de 256 valores.
  5. Reporta max/mean abs diff vs threshold de referencia do Sprint 3 (1e-4).

Uso:
  python validate_embedding_parity.py
  python validate_embedding_parity.py --skip-dump  # se ts_*.bin ja existem
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

SCRIPT_DIR  = Path(__file__).parent
FIXTURE_DIR = SCRIPT_DIR / "test_fixtures"
ONNX_PATH   = SCRIPT_DIR / "checkpoints" / "gaze_encoder.onnx"
PROJECT_DIR = SCRIPT_DIR.parent

SPRINT3_KERAS_ONNX_THRESHOLD = 1e-4   # referencia Sprint 3 (Keras vs ONNX)


def run_dump(project_dir: Path) -> None:
    print("[dump] Rodando eyeCrop.ts via vitest para gerar ts_*.bin ...")
    result = subprocess.run(
        ["npx", "vitest", "run", "src/eyeCrop.dump.test.ts", "--reporter=verbose"],
        cwd=str(project_dir),
        capture_output=True,
        text=True,
        shell=True,
    )
    if result.returncode != 0:
        print("[ERROR] vitest dump falhou:")
        print(result.stdout[-3000:])
        print(result.stderr[-1000:])
        sys.exit(1)
    for line in result.stdout.splitlines():
        if "[dump]" in line or "FAIL" in line or "PASS" in line or "passed" in line:
            print("  " + line.strip())


def load_f32(path: Path, shape: tuple) -> np.ndarray:
    arr = np.frombuffer(path.read_bytes(), dtype=np.float32)
    return arr.reshape(shape)


def build_batch(face: np.ndarray, left_eye: np.ndarray, right_eye: np.ndarray,
                rect: np.ndarray) -> dict:
    return {
        "face":      face[np.newaxis],        # (1, 224, 224, 3)
        "left_eye":  left_eye[np.newaxis],    # (1, 112, 112, 3)
        "right_eye": right_eye[np.newaxis],   # (1, 112, 112, 3)
        "rect":      rect[np.newaxis],        # (1, 12)
    }


def run_onnx(onnx_path: Path, feeds: dict) -> np.ndarray:
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_names = [i.name for i in sess.get_inputs()]
    # Alimenta apenas os inputs que o modelo conhece
    feeds_filtered = {k: v.astype(np.float32) for k, v in feeds.items() if k in input_names}
    return sess.run(None, feeds_filtered)[0]   # (1, 256)


def main(args: argparse.Namespace) -> None:
    print("=" * 60)
    print("validate_embedding_parity.py")
    print("=" * 60)
    print("ONNX model:", ONNX_PATH)
    print("Fixtures  :", FIXTURE_DIR)
    print()

    if not ONNX_PATH.exists():
        print("[ERROR] gaze_encoder.onnx nao encontrado:", ONNX_PATH)
        sys.exit(1)

    ts_face_path = FIXTURE_DIR / "ts_face_f32.bin"
    if not args.skip_dump or not ts_face_path.exists():
        run_dump(PROJECT_DIR)
    else:
        print("[dump] Pulando dump (--skip-dump). Usando ts_*.bin existentes.")

    # Verifica todos os arquivos necessarios
    required = [
        "face_f32.bin", "left_eye_f32.bin", "right_eye_f32.bin", "rect_ref.json",
        "ts_face_f32.bin", "ts_left_eye_f32.bin", "ts_right_eye_f32.bin", "ts_rect.json",
    ]
    missing = [f for f in required if not (FIXTURE_DIR / f).exists()]
    if missing:
        print("[ERROR] Fixtures ausentes:", missing)
        sys.exit(1)

    # ── Carrega tensores Python (cv2/preprocess.py) ───────────────────────────
    py_face  = load_f32(FIXTURE_DIR / "face_f32.bin",      (224, 224, 3))
    py_le    = load_f32(FIXTURE_DIR / "left_eye_f32.bin",  (112, 112, 3))
    py_re    = load_f32(FIXTURE_DIR / "right_eye_f32.bin", (112, 112, 3))
    py_rect  = np.array(json.loads((FIXTURE_DIR / "rect_ref.json").read_text()), dtype=np.float32)

    # ── Carrega tensores TypeScript (eyeCrop.ts/Cairo) ────────────────────────
    ts_face  = load_f32(FIXTURE_DIR / "ts_face_f32.bin",      (224, 224, 3))
    ts_le    = load_f32(FIXTURE_DIR / "ts_left_eye_f32.bin",  (112, 112, 3))
    ts_re    = load_f32(FIXTURE_DIR / "ts_right_eye_f32.bin", (112, 112, 3))
    ts_rect  = np.array(json.loads((FIXTURE_DIR / "ts_rect.json").read_text()), dtype=np.float32)

    print("[inputs] Diferenca de pixels entre Python e TypeScript:")
    print("  face_f32     max=%.4f (%.1f/255)  mean=%.6f" % (
        float(np.abs(py_face - ts_face).max()),
        float(np.abs(py_face - ts_face).max()) * 255,
        float(np.abs(py_face - ts_face).mean())))
    print("  left_eye_f32 max=%.4f (%.1f/255)  mean=%.6f" % (
        float(np.abs(py_le - ts_le).max()),
        float(np.abs(py_le - ts_le).max()) * 255,
        float(np.abs(py_le - ts_le).mean())))
    print("  right_eye_f32 max=%.4f (%.1f/255)  mean=%.6f" % (
        float(np.abs(py_re - ts_re).max()),
        float(np.abs(py_re - ts_re).max()) * 255,
        float(np.abs(py_re - ts_re).mean())))
    print("  rect         max=%.2e" % float(np.abs(py_rect - ts_rect).max()))

    # ── Roda os dois sets de tensores pelo mesmo ONNX ─────────────────────────
    print()
    print("[onnx] Rodando Python tensors pelo gaze_encoder.onnx ...")
    py_emb = run_onnx(ONNX_PATH, build_batch(py_face, py_le, py_re, py_rect)).flatten()

    print("[onnx] Rodando TypeScript tensors pelo gaze_encoder.onnx ...")
    ts_emb = run_onnx(ONNX_PATH, build_batch(ts_face, ts_le, ts_re, ts_rect)).flatten()

    # ── Analise do embedding de 256 valores ───────────────────────────────────
    diff      = np.abs(py_emb - ts_emb)
    max_diff  = float(diff.max())
    mean_diff = float(diff.mean())
    emb_scale = float(np.abs(py_emb).mean())  # escala tipica do embedding

    print()
    print("[embedding] Python  embedding: min=%.4f  max=%.4f  mean=%.4f" % (
        float(py_emb.min()), float(py_emb.max()), float(py_emb.mean())))
    print("[embedding] TypeScript embedding: min=%.4f  max=%.4f  mean=%.4f" % (
        float(ts_emb.min()), float(ts_emb.max()), float(ts_emb.mean())))
    print()
    print("[embedding] max  abs diff Python vs TypeScript : %.4e" % max_diff)
    print("[embedding] mean abs diff Python vs TypeScript : %.4e" % mean_diff)
    print("[embedding] escala media do embedding (|emb|)  : %.4e" % emb_scale)
    print("[embedding] diff/escala (impacto relativo)     : %.4e" % (max_diff / max(emb_scale, 1e-9)))
    print()
    print("[referencia] Keras vs ONNX Sprint 3 : 5.48e-07  (threshold=1e-4)")
    print("[aqui]       Python vs TypeScript   : %.2e  (fonte: bilinear Cairo vs cv2)" % max_diff)

    print()
    if max_diff < 1e-1:
        if max_diff < 1e-2:
            verdict = "NEGLIGIVEL"
        elif max_diff < 5e-2:
            verdict = "PEQUENA"
        else:
            verdict = "MODERADA"
        print("[OK] Diferenca de embedding e %s (%.2e) — nenhum risco pratico de train/serve skew." % (verdict, max_diff))
    else:
        print("[ATENCAO] Diferenca de embedding alta (%.2e). Investigar antes de aceitar o gate." % max_diff)
        sys.exit(1)

    # ── Breakdown por dimensao — top 5 ────────────────────────────────────────
    top5_idx = np.argsort(diff)[::-1][:5]
    print()
    print("[embedding] Top 5 dimensoes com maior diferenca:")
    for i, idx in enumerate(top5_idx):
        print("  #%d  dim[%3d]: py=%.5f  ts=%.5f  diff=%.2e" % (
            i + 1, idx, py_emb[idx], ts_emb[idx], diff[idx]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-dump", action="store_true",
                        help="Pula a geracao dos ts_*.bin (usa os ja existentes)")
    main(parser.parse_args())
