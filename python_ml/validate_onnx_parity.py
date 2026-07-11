# -*- coding: utf-8 -*-
"""
validate_onnx_parity.py - Checagem de paridade numerica: Keras embedding vs ONNX.

Script canonico reutilizavel para validar que o arquivo gaze_encoder.onnx
produz resultados numericamente identicos ao submodelo Keras original.

Execute sempre que:
  - O modelo for re-exportado (nova rodada de treino ou mudanca de arquitetura)
  - tensorflow, tf2onnx ou onnxruntime forem atualizados
  - A arquitetura do encoder for alterada

Criterio de aprovacao: max abs diff (Keras vs ONNX) < 1e-4.
Resultado de referencia (Sprint 3, 2026-07-10):
  tensorflow 2.19.0 / tf2onnx 1.17.0 / onnxruntime 1.27.0
  max abs diff = 5.48e-07  (mean = 2.08e-08)

Uso:
  python validate_onnx_parity.py
  python validate_onnx_parity.py --n-samples 16
  python validate_onnx_parity.py --keras-model checkpoints/gaze_cnn_best.keras
  python validate_onnx_parity.py --onnx-model checkpoints/gaze_encoder.onnx
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import tensorflow as tf

SCRIPT_DIR    = Path(__file__).parent
CKPT_DIR      = SCRIPT_DIR / "checkpoints"
PROCESSED_DIR = SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze" / "processed"

THRESHOLD = 1e-4

os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

_FEATURE_DESC = {
    "face":       tf.io.FixedLenFeature([], tf.string),
    "left_eye":   tf.io.FixedLenFeature([], tf.string),
    "right_eye":  tf.io.FixedLenFeature([], tf.string),
    "rect":       tf.io.FixedLenFeature([12], tf.float32),
    "label":      tf.io.FixedLenFeature([2],  tf.float32),
    "subject_id": tf.io.FixedLenFeature([],   tf.int64),
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
    path = PROCESSED_DIR / "val.tfrecord"
    ds = tf.data.TFRecordDataset(str(path)).map(parse_sample).take(n).batch(n)
    batch = next(iter(ds))
    return {k: v.numpy() for k, v in batch.items()}


def build_encoder(full_model: tf.keras.Model) -> tf.keras.Model:
    return tf.keras.Model(
        inputs=full_model.input,
        outputs=full_model.get_layer("embedding").output,
        name="gaze_encoder",
    )


def run_keras(encoder: tf.keras.Model, samples: dict) -> np.ndarray:
    return encoder.predict(samples, verbose=0)


def run_onnx(onnx_path: Path, samples: dict) -> np.ndarray:
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_names = [i.name for i in sess.get_inputs()]
    feeds = {name: samples[name].astype(np.float32) for name in input_names}
    return sess.run(None, feeds)[0]


def main(args: argparse.Namespace) -> None:
    keras_path = Path(args.keras_model)
    onnx_path  = Path(args.onnx_model)

    print("=" * 60)
    print("validate_onnx_parity.py")
    print("=" * 60)
    print("TensorFlow  :", tf.__version__)
    print("onnxruntime :", ort.__version__)
    print("numpy       :", np.__version__)
    print("Keras model :", keras_path)
    print("ONNX model  :", onnx_path)
    print("N samples   :", args.n_samples)
    print("Threshold   : %.0e" % THRESHOLD)
    print()

    if not keras_path.exists():
        print("[ERROR] Keras model nao encontrado:", keras_path)
        sys.exit(1)
    if not onnx_path.exists():
        print("[ERROR] ONNX model nao encontrado:", onnx_path)
        sys.exit(1)

    print("[load] Carregando Keras model ...")
    full_model = tf.keras.models.load_model(str(keras_path))
    encoder    = build_encoder(full_model)

    print("[load] Carregando %d amostras do val.tfrecord ..." % args.n_samples)
    samples = load_samples(args.n_samples)
    for k, v in samples.items():
        print("       - %s: %s %s" % (k, v.shape, v.dtype))

    print("\n[keras] Rodando submodelo Keras (embedding layer) ...")
    keras_out = run_keras(encoder, samples)
    print("  shape:", keras_out.shape)

    print("\n[onnx] Rodando modelo ONNX (CPUExecutionProvider) ...")
    onnx_out = run_onnx(onnx_path, samples)
    print("  shape:", onnx_out.shape)

    print("\n[paridade] Comparando embeddings elemento a elemento ...")
    abs_diff  = np.abs(keras_out - onnx_out)
    max_diff  = float(abs_diff.max())
    mean_diff = float(abs_diff.mean())

    print("  max  abs diff : %.2e" % max_diff)
    print("  mean abs diff : %.2e" % mean_diff)
    print("  ref Sprint 3  : 5.48e-07  (tensorflow 2.19.0 / tf2onnx 1.17.0 / onnxruntime 1.27.0)")

    print("\n  Por amostra (max abs diff):")
    for i in range(len(keras_out)):
        d = float(np.abs(keras_out[i] - onnx_out[i]).max())
        print("    amostra %2d: %.2e" % (i, d))

    print()
    if max_diff < THRESHOLD:
        print("[PASS] max diff %.2e < %.0e — paridade OK" % (max_diff, THRESHOLD))
    else:
        print("[FAIL] max diff %.2e >= %.0e — INVESTIGAR antes de prosseguir!" % (max_diff, THRESHOLD))
        print("Possiveis causas: BatchNormalization folding, oneDNN reordering,")
        print("  diferenca de dtype, ou mudanca de comportamento entre versoes")
        print("  de tensorflow/tf2onnx. Nao use o ONNX exportado sem resolver.")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Valida paridade numerica entre submodelo Keras e ONNX exportado."
    )
    parser.add_argument(
        "--keras-model",
        default=str(CKPT_DIR / "gaze_cnn_best.keras"),
        metavar="PATH",
        help="Caminho para o .keras (default: checkpoints/gaze_cnn_best.keras)",
    )
    parser.add_argument(
        "--onnx-model",
        default=str(CKPT_DIR / "gaze_encoder.onnx"),
        metavar="PATH",
        help="Caminho para o .onnx exportado (default: checkpoints/gaze_encoder.onnx)",
    )
    parser.add_argument(
        "--n-samples",
        type=int,
        default=8,
        metavar="N",
        help="Numero de amostras do val.tfrecord para comparar (default: 8)",
    )
    main(parser.parse_args())
