# -*- coding: utf-8 -*-
"""
export_onnx.py - Exporta o encoder CNN (3 ramos) para ONNX.

Versoes validadas nesta exportacao (Sprint 3, 2026-07-10):
  tensorflow : 2.19.0
  tf2onnx    : 1.17.0  (opset 17)
  onnx       : 1.22.0

Nota de compatibilidade tf2onnx:
  tf2onnx 1.17.0 nao expoe from_saved_model como API Python — apenas via CLI.
  A conversao aqui usa tf2onnx.convert.from_keras, que internamente passa por
  um SavedModel temporario. Isso funcionou corretamente com TF 2.19.0, mas
  from_keras tambem pode mudar entre versoes menores do tf2onnx.

ATENCAO — apos qualquer atualizacao de tensorflow ou tf2onnx:
  Reexecute a checagem de paridade numerica (python validate_onnx_parity.py)
  antes de considerar uma nova exportacao valida. Nao assuma que a ausencia
  de erro na conversao implica paridade numerica com o modelo Keras original.
  Criterio de aprovacao: max abs diff (Keras embedding vs ONNX) < 1e-4.
  Resultado de referencia do Sprint 3: max abs diff = 5.48e-07.

Fluxo:
  1. Carrega gaze_cnn_best.keras.
  2. Constroi submodelo (inputs=model.input, output="embedding") - descarta gaze_xy.
  3. Exporta via tf2onnx.convert.from_keras (opset 17).
  4. Valida com onnx.checker e lista nomes de input/output.
  5. Salva em checkpoints/gaze_encoder.onnx.
"""

import os
import sys
from pathlib import Path

import onnx
import tensorflow as tf
import tf2onnx

SCRIPT_DIR  = Path(__file__).parent
CKPT_DIR    = SCRIPT_DIR / "checkpoints"
KERAS_MODEL = CKPT_DIR / "gaze_cnn_best.keras"
ONNX_OUT    = CKPT_DIR / "gaze_encoder.onnx"

os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


def build_encoder_submodel(full_model: tf.keras.Model) -> tf.keras.Model:
    embedding_layer = full_model.get_layer("embedding")
    return tf.keras.Model(
        inputs=full_model.input,
        outputs=embedding_layer.output,
        name="gaze_encoder",
    )


def build_input_signature(encoder: tf.keras.Model):
    """Build tf.TensorSpec list from encoder Keras inputs."""
    specs = []
    for inp in encoder.inputs:
        # inp.shape includes batch dim as None; replace with explicit None for export
        shape = [None] + list(inp.shape[1:])
        specs.append(tf.TensorSpec(shape=shape, dtype=inp.dtype, name=inp.name))
    return specs


def export_to_onnx(encoder: tf.keras.Model, out_path: Path) -> onnx.ModelProto:
    input_signature = build_input_signature(encoder)
    print("[export] Input signature:")
    for spec in input_signature:
        print("         - %s: shape=%s dtype=%s" % (spec.name, spec.shape, spec.dtype))

    print("[export] Convertendo para ONNX opset 17 via tf2onnx.convert.from_keras ...")
    model_proto, _ = tf2onnx.convert.from_keras(
        encoder,
        input_signature=input_signature,
        opset=17,
        output_path=str(out_path),
    )
    return model_proto


def validate_and_report(onnx_path: Path) -> None:
    model = onnx.load(str(onnx_path))
    onnx.checker.check_model(model)
    print("\n[validate] onnx.checker.check_model: OK")

    inputs  = [i.name for i in model.graph.input]
    outputs = [o.name for o in model.graph.output]
    print("[validate] Inputs  (%d): %s" % (len(inputs), inputs))
    print("[validate] Outputs (%d): %s" % (len(outputs), outputs))

    for inp in model.graph.input:
        shape = [
            (d.dim_param if d.dim_param else d.dim_value)
            for d in inp.type.tensor_type.shape.dim
        ]
        print("           - %s: %s" % (inp.name, shape))

    for out in model.graph.output:
        shape = [
            (d.dim_param if d.dim_param else d.dim_value)
            for d in out.type.tensor_type.shape.dim
        ]
        print("           - %s: %s" % (out.name, shape))


def main() -> None:
    print("TensorFlow  :", tf.__version__)
    print("tf2onnx     :", tf2onnx.__version__)
    print("onnx        :", onnx.__version__)
    print("Modelo Keras:", KERAS_MODEL)
    print()

    print("[load] Carregando gaze_cnn_best.keras ...")
    full_model = tf.keras.models.load_model(str(KERAS_MODEL))

    print("\n[submodel] Construindo encoder (output=embedding, sem gaze_xy) ...")
    encoder = build_encoder_submodel(full_model)
    print("  Keras input names :", [i.name for i in encoder.inputs])
    print("  Keras output names:", [o.name for o in encoder.outputs])
    print("  Output shape      :", encoder.output_shape)

    export_to_onnx(encoder, ONNX_OUT)
    size_kb = ONNX_OUT.stat().st_size / 1024
    print("\n[export] ONNX salvo em %s  (%.1f KB)" % (ONNX_OUT, size_kb))

    validate_and_report(ONNX_OUT)
    print("\n[done] Exportacao concluida com sucesso.")


if __name__ == "__main__":
    main()
