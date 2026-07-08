"""
Gate validation for the TFRecord preprocessing output.

Reads N samples from each .tfrecord split via tf.data.TFRecordDataset,
asserts shapes, dtype, and value ranges, and prints the first sample's
rect + label so you can cross-check against the earlier grid.png.

Usage:
  python validate_tfrecord.py                    # check all available splits
  python validate_tfrecord.py --split train      # check one split only
  python validate_tfrecord.py --n 32             # check more samples
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import tensorflow as tf

PROCESSED_DIR = (
    Path(__file__).parent
    / "datasets" / "prototype_nc_mpiifacegaze" / "processed"
)
META_PATH = PROCESSED_DIR / "metadata.json"

N_CHECK_DEFAULT = 16

EXPECTED_SHAPES = {
    "face":      (224, 224, 3),
    "left_eye":  (112, 112, 3),
    "right_eye": (112, 112, 3),
    "rect":      (12,),
    "label":     (2,),
}

_FEATURE_DESC = {
    "face":       tf.io.FixedLenFeature([], tf.string),
    "left_eye":   tf.io.FixedLenFeature([], tf.string),
    "right_eye":  tf.io.FixedLenFeature([], tf.string),
    "rect":       tf.io.FixedLenFeature([12], tf.float32),
    "label":      tf.io.FixedLenFeature([2],  tf.float32),
    "subject_id": tf.io.FixedLenFeature([],   tf.int64),
}


def _parse(raw_bytes):
    p = tf.io.parse_single_example(raw_bytes, _FEATURE_DESC)
    return {
        "face":       tf.reshape(tf.io.decode_raw(p["face"],      tf.float32), [224, 224, 3]),
        "left_eye":   tf.reshape(tf.io.decode_raw(p["left_eye"],  tf.float32), [112, 112, 3]),
        "right_eye":  tf.reshape(tf.io.decode_raw(p["right_eye"], tf.float32), [112, 112, 3]),
        "rect":       p["rect"],
        "label":      p["label"],
        "subject_id": p["subject_id"],
    }


def validate_split(split: str, n_check: int) -> bool:
    tfr_path = PROCESSED_DIR / f"{split}.tfrecord"
    if not tfr_path.exists():
        print(f"  [{split}] SKIP — file not found: {tfr_path}")
        return True  # not a failure, just absent

    print(f"\n{'='*55}")
    print(f"  Validating split: {split}  (checking first {n_check} samples)")
    print(f"  File: {tfr_path}")
    size_mb = tfr_path.stat().st_size / (1024 ** 2)
    print(f"  Size: {size_mb:.1f} MB")

    # Load metadata if available
    if META_PATH.exists():
        with open(META_PATH) as f:
            meta = json.load(f)
        split_meta = meta.get("splits", {}).get(split, {})
        total = split_meta.get("total", "?")
        subjects = split_meta.get("subjects", {})
        print(f"  Metadata: total={total}, subjects={list(subjects.keys())}")

    dataset = (
        tf.data.TFRecordDataset(str(tfr_path))
        .map(_parse, num_parallel_calls=1)
        .take(n_check)
    )

    errors  = []
    n_read  = 0
    first   = None

    for record in dataset:
        sample = {k: v.numpy() for k, v in record.items()}
        n_read += 1

        if first is None:
            first = sample

        for field, expected_shape in EXPECTED_SHAPES.items():
            actual = sample[field].shape
            if actual != expected_shape:
                errors.append(f"  shape mismatch [{field}]: got {actual}, expected {expected_shape}")

        for field in ("face", "left_eye", "right_eye"):
            arr = sample[field]
            if arr.min() < -1e-4 or arr.max() > 1.0001:
                errors.append(
                    f"  value range [{field}]: min={arr.min():.4f} max={arr.max():.4f} — expected [0, 1]"
                )

        for val in sample["rect"]:
            if val < -0.01 or val > 1.01:
                errors.append(f"  rect value out of range: {val:.4f}")
                break

        for val in sample["label"]:
            if val < -0.01 or val > 1.01:
                errors.append(f"  label value out of range: {val:.4f}")
                break

    if n_read == 0:
        errors.append("  no records could be read from file")
    else:
        print(f"\n  Records read  : {n_read}")
        if first is not None:
            print(f"  First sample:")
            print(f"    subject_id : {int(first['subject_id'])}")
            print(f"    face       : shape={first['face'].shape}  "
                  f"min={first['face'].min():.4f}  max={first['face'].max():.4f}")
            print(f"    left_eye   : shape={first['left_eye'].shape}")
            print(f"    right_eye  : shape={first['right_eye'].shape}")
            print(f"    rect       : {np.round(first['rect'], 4).tolist()}")
            print(f"    label      : {np.round(first['label'], 4).tolist()}  "
                  "(gaze fraction of screen)")

    if errors:
        print(f"\n  FAILURES ({len(errors)}):")
        for e in errors:
            print(f"    {e}")
        return False

    print(f"\n  PASS — all {n_read} samples validated")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Validate .tfrecord output of preprocess.py."
    )
    parser.add_argument(
        "--split", choices=["train", "val", "test"], default=None,
        help="Validate only this split (default: all available).",
    )
    parser.add_argument(
        "--n", type=int, default=N_CHECK_DEFAULT, metavar="N",
        help=f"Number of samples to check per split (default: {N_CHECK_DEFAULT}).",
    )
    args = parser.parse_args()

    splits = [args.split] if args.split else ["train", "val", "test"]

    all_ok = True
    for split in splits:
        ok = validate_split(split, args.n)
        all_ok = all_ok and ok

    print(f"\n{'='*55}")
    if all_ok:
        print("OVERALL: PASS")
        sys.exit(0)
    else:
        print("OVERALL: FAIL — see errors above")
        sys.exit(1)


if __name__ == "__main__":
    main()
