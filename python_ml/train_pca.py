# -*- coding: utf-8 -*-
"""
train_pca.py - Treina PCA offline sobre embeddings da CNN e exporta em JSON.

Fluxo:
  1. Amostra N exemplos do train.tfrecord (face, left_eye, right_eye, rect).
  2. Roda o gaze_encoder.onnx em batches -> coleta N embeddings de 256 dims.
  3. Ajusta sklearn.decomposition.PCA com n_components suficientes para
     capturar >= MIN_VARIANCE_RATIO de variancia explicada (max MAX_COMPONENTS).
  4. Exporta em JSON para public/models/embedding_pca.json:
       { "n_components": int,
         "mean_": [256 floats],
         "components_": [n_components*256 floats, row-major] }
  5. Reporta variancia explicada acumulada e tamanho do arquivo.

Uso:
  python train_pca.py
  python train_pca.py --n-samples 4000 --max-components 64 --min-variance 0.95
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import tensorflow as tf
from sklearn.decomposition import PCA

SCRIPT_DIR    = Path(__file__).parent
PROJECT_DIR   = SCRIPT_DIR.parent
PROCESSED_DIR = SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze" / "processed"
ONNX_PATH     = SCRIPT_DIR / "checkpoints" / "gaze_encoder.onnx"
OUTPUT_PATH   = PROJECT_DIR / "public" / "models" / "embedding_pca.json"

DEFAULT_N_SAMPLES    = 4000
DEFAULT_MAX_COMPS    = 64
DEFAULT_MIN_VARIANCE = 0.95
BATCH_SIZE           = 32

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

_FEATURE_DESC = {
    "face":      tf.io.FixedLenFeature([], tf.string),
    "left_eye":  tf.io.FixedLenFeature([], tf.string),
    "right_eye": tf.io.FixedLenFeature([], tf.string),
    "rect":      tf.io.FixedLenFeature([12], tf.float32),
    "label":     tf.io.FixedLenFeature([2],  tf.float32),
}


def parse_sample(raw):
    p = tf.io.parse_single_example(raw, _FEATURE_DESC)
    return {
        "face":      tf.reshape(tf.io.decode_raw(p["face"],      tf.float32), [224, 224, 3]),
        "left_eye":  tf.reshape(tf.io.decode_raw(p["left_eye"],  tf.float32), [112, 112, 3]),
        "right_eye": tf.reshape(tf.io.decode_raw(p["right_eye"], tf.float32), [112, 112, 3]),
        "rect":      p["rect"],
    }


def load_samples(n: int) -> dict:
    path = PROCESSED_DIR / "train.tfrecord"
    if not path.exists():
        print("[ERROR] train.tfrecord nao encontrado:", path)
        sys.exit(1)

    ds = (tf.data.TFRecordDataset(str(path))
          .shuffle(buffer_size=min(n * 4, 8000), seed=42)
          .take(n)
          .map(parse_sample, num_parallel_calls=tf.data.AUTOTUNE)
          .batch(BATCH_SIZE)
          .prefetch(tf.data.AUTOTUNE))

    faces, left_eyes, right_eyes, rects = [], [], [], []
    for batch in ds:
        faces.append(batch["face"].numpy())
        left_eyes.append(batch["left_eye"].numpy())
        right_eyes.append(batch["right_eye"].numpy())
        rects.append(batch["rect"].numpy())

    return {
        "face":      np.concatenate(faces,      axis=0).astype(np.float32),
        "left_eye":  np.concatenate(left_eyes,  axis=0).astype(np.float32),
        "right_eye": np.concatenate(right_eyes, axis=0).astype(np.float32),
        "rect":      np.concatenate(rects,      axis=0).astype(np.float32),
    }


def run_encoder_batched(onnx_path: Path, samples: dict) -> np.ndarray:
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_names = {i.name for i in sess.get_inputs()}
    n = samples["face"].shape[0]
    embeddings = []

    print(f"[encoder] Rodando {n} amostras em batches de {BATCH_SIZE} ...")
    t0 = time.time()

    for start in range(0, n, BATCH_SIZE):
        end = min(start + BATCH_SIZE, n)
        feeds = {
            k: samples[k][start:end]
            for k in ["face", "left_eye", "right_eye", "rect"]
            if k in input_names
        }
        out = sess.run(None, feeds)[0]   # (batch, 256)
        embeddings.append(out)

        if (start // BATCH_SIZE + 1) % 20 == 0:
            elapsed = time.time() - t0
            done    = end / n
            eta     = elapsed / done * (1 - done) if done > 0 else 0
            print(f"  {end}/{n}  {elapsed:.1f}s decorridos  ETA {eta:.1f}s")

    elapsed = time.time() - t0
    result  = np.concatenate(embeddings, axis=0)
    print(f"[encoder] {n} embeddings coletados em {elapsed:.1f}s  "
          f"({elapsed/n*1000:.1f} ms/amostra)")
    return result   # (n, 256)


def find_n_components(pca_full: PCA, min_variance: float, max_components: int) -> int:
    cumvar = np.cumsum(pca_full.explained_variance_ratio_)
    for k, cv in enumerate(cumvar, start=1):
        if cv >= min_variance:
            return min(k, max_components)
    return max_components


def export_json(pca: PCA, n_components: int, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "n_components":  n_components,
        "mean_":         pca.mean_.tolist(),
        "components_":   pca.components_[:n_components].flatten().tolist(),
    }
    output.write_text(json.dumps(data, separators=(",", ":")))


def main(args: argparse.Namespace) -> None:
    print("=" * 60)
    print("train_pca.py")
    print("=" * 60)
    print(f"Amostras : {args.n_samples}")
    print(f"Max comps: {args.max_components}")
    print(f"Min var  : {args.min_variance:.0%}")
    print(f"ONNX     : {ONNX_PATH}")
    print(f"Output   : {OUTPUT_PATH}")
    print()

    if not ONNX_PATH.exists():
        print("[ERROR] gaze_encoder.onnx nao encontrado")
        sys.exit(1)

    print(f"[data] Carregando {args.n_samples} amostras do train.tfrecord ...")
    samples = load_samples(args.n_samples)
    print(f"[data] face={samples['face'].shape}  "
          f"left_eye={samples['left_eye'].shape}  "
          f"rect={samples['rect'].shape}")

    embeddings = run_encoder_batched(ONNX_PATH, samples)
    print(f"[pca] Embeddings: shape={embeddings.shape}  "
          f"mean={embeddings.mean():.4f}  std={embeddings.std():.4f}")

    print(f"\n[pca] Ajustando PCA com max {args.max_components} componentes ...")
    t0 = time.time()
    pca_full = PCA(n_components=min(args.max_components, embeddings.shape[0],
                                    embeddings.shape[1]), random_state=42)
    pca_full.fit(embeddings)
    print(f"[pca] Ajuste concluido em {time.time()-t0:.1f}s")

    n_comp = find_n_components(pca_full, args.min_variance, args.max_components)
    cumvar = float(np.cumsum(pca_full.explained_variance_ratio_)[n_comp - 1])

    print()
    print(f"[pca] Componentes necessarios para {args.min_variance:.0%} de variancia: {n_comp}")
    print(f"[pca] Variancia explicada acumulada com {n_comp} componentes: {cumvar:.4f} ({cumvar:.2%})")
    print()

    print("[pca] Variancia por componente (primeiros 10):")
    for i, r in enumerate(pca_full.explained_variance_ratio_[:10], 1):
        cum = float(np.cumsum(pca_full.explained_variance_ratio_)[i-1])
        print(f"  PC{i:02d}: {r:.4f}  acum={cum:.4f}")

    print()
    export_json(pca_full, n_comp, OUTPUT_PATH)

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"[export] Salvo em {OUTPUT_PATH}")
    print(f"[export] Tamanho: {size_kb:.1f} KB  "
          f"({n_comp} x 256 floats + 256 mean = {n_comp*256+256} valores)")
    print(f"[export] n_components={n_comp}  variancia_explicada={cumvar:.4f}")
    print()
    print("[done] PCA exportado. Proximos passos:")
    print("  1. Verifique public/models/embedding_pca.json")
    print("  2. npm run test  (testes de fusion.ts devem passar)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-samples",      type=int,   default=DEFAULT_N_SAMPLES)
    parser.add_argument("--max-components", type=int,   default=DEFAULT_MAX_COMPS)
    parser.add_argument("--min-variance",   type=float, default=DEFAULT_MIN_VARIANCE)
    main(parser.parse_args())
