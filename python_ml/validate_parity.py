# -*- coding: utf-8 -*-
"""
validate_parity.py - Sprint 3: valida paridade numerica Keras vs ONNX.

Carrega 8 amostras do val.tfrecord, roda pelo submodelo Keras (embedding)
e pelo modelo ONNX exportado (via onnxruntime), compara elemento a elemento.
Critério de aprovação: max abs diff < 1e-4.
"""

import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import tensorflow as tf

SCRIPT_DIR    = Path(__file__).parent
CKPT_DIR      = SCRIPT_DIR / "checkpoints"
PROCESSED_DIR = SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze" / "processed"
KERAS_MODEL   = CKPT_DIR / "gaze_cnn_best.keras"
ONNX_MODEL    = CKPT_DIR / "gaze_encoder.onnx"
N_SAMPLES     = 8

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


def load_samples():
    path = PROCESSED_DIR / "val.tfrecord"
    ds = tf.data.TFRecordDataset(str(path)).map(parse_sample).take(N_SAMPLES).batch(N_SAMPLES)
    batch = next(iter(ds))
    return {k: v.numpy() for k, v in batch.items()}


def build_encoder(full_model: tf.keras.Model) -> tf.keras.Model:
    return tf.keras.Model(
        inputs=full_model.input,
        outputs=full_model.get_layer("embedding").output,
        name="gaze_encoder",
    )


def run_keras(encoder, samples: dict) -> np.ndarray:
    return encoder.predict(samples, verbose=0)


def run_onnx(onnx_path: Path, samples: dict) -> np.ndarray:
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_names = [i.name for i in sess.get_inputs()]
    feeds = {name: samples[name].astype(np.float32) for name in input_names}
    output = sess.run(None, feeds)
    return output[0]


def main():
    print("TensorFlow    :", tf.__version__)
    print("onnxruntime   :", ort.__version__)
    print()

    print("[load] Carregando Keras model ...")
    full_model = tf.keras.models.load_model(str(KERAS_MODEL))
    encoder    = build_encoder(full_model)

    print("[load] Carregando %d amostras do val.tfrecord ..." % N_SAMPLES)
    samples = load_samples()
    for k, v in samples.items():
        print("       - %s: shape=%s dtype=%s" % (k, v.shape, v.dtype))

    print("\n[keras] Rodando inferencia pelo submodelo Keras (embedding) ...")
    keras_out = run_keras(encoder, samples)
    print("  output shape:", keras_out.shape)

    print("\n[onnx] Rodando inferencia pelo ONNX (onnxruntime CPU) ...")
    onnx_out = run_onnx(ONNX_MODEL, samples)
    print("  output shape:", onnx_out.shape)

    print("\n[paridade] Comparando saidas elemento a elemento ...")
    abs_diff = np.abs(keras_out - onnx_out)
    max_diff = float(abs_diff.max())
    mean_diff = float(abs_diff.mean())

    print("  max  abs diff : %.2e" % max_diff)
    print("  mean abs diff : %.2e" % mean_diff)

    THRESHOLD = 1e-4
    if max_diff < THRESHOLD:
        print("\n  [PASS] max diff %.2e < %.0e - paridade OK" % (max_diff, THRESHOLD))
    else:
        print("\n  [FAIL] max diff %.2e >= %.0e - INVESTIGAR antes de prosseguir!" % (max_diff, THRESHOLD))
        print("  Dicas: BatchNormalization folding, oneDNN reordering, ou diferenca de dtype.")
        sys.exit(1)

    # Show per-sample max diff
    print("\n  Por amostra (max abs diff):")
    for i in range(len(keras_out)):
        d = float(np.abs(keras_out[i] - onnx_out[i]).max())
        print("    amostra %d: %.2e" % (i, d))


if __name__ == "__main__":
    main()
