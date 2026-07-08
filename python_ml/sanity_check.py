"""
Visual sanity check for train.tfrecord.
Outputs a PNG grid showing face (with eye bboxes from rect) + left_eye + right_eye
for 16 random samples.

Usage: python sanity_check.py
Output: python_ml/sanity_check/grid.png
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import tensorflow as tf

TFRECORD_PATH = (
    Path(__file__).parent
    / "datasets" / "prototype_nc_mpiifacegaze" / "processed" / "train.tfrecord"
)
META_PATH = TFRECORD_PATH.parent / "metadata.json"
OUT_DIR   = Path(__file__).parent / "sanity_check"
N_SAMPLES = 16
COLS      = 4
SEED      = 42
PAD       = 6
LABEL_H   = 20

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


def _load_samples(tfrecord_path: Path, indices: np.ndarray) -> list:
    """Single-pass read; collect only the records at the requested indices."""
    target = set(indices.tolist())
    samples = {}
    dataset = tf.data.TFRecordDataset(str(tfrecord_path)).map(_parse)
    for i, record in enumerate(dataset):
        if i in target:
            samples[i] = {k: v.numpy() for k, v in record.items()}
        if len(samples) == len(target):
            break
    return [samples[i] for i in sorted(samples)]


def rect_to_face_boxes(rect, face_size=224):
    """
    Convert 12-value rect (all normalized by original image dims) to
    pixel coordinates relative to the 224x224 face crop.

    rect layout:
      [fw/W, fh/H, fx1/W, fy1/H,           <- face bbox  (indices 0-3)
       le_bw/W, le_bh/H, le_bx/W, le_by/H, <- left eye   (indices 4-7)
       re_bw/W, re_bh/H, re_bx/W, re_by/H] <- right eye  (indices 8-11)
    """
    fw_n,  fh_n,  fx1_n, fy1_n  = rect[0], rect[1], rect[2], rect[3]
    le_bw, le_bh, le_bx, le_by  = rect[4], rect[5], rect[6], rect[7]
    re_bw, re_bh, re_bx, re_by  = rect[8], rect[9], rect[10], rect[11]

    scale_x = face_size / fw_n
    scale_y = face_size / fh_n

    def to_face(bx_n, by_n, bw_n, bh_n):
        x = int((bx_n - fx1_n) * scale_x)
        y = int((by_n - fy1_n) * scale_y)
        w = int(bw_n * scale_x)
        h = int(bh_n * scale_y)
        return x, y, w, h

    return to_face(le_bx, le_by, le_bw, le_bh), to_face(re_bx, re_by, re_bw, re_bh)


def make_cell(face_f32, le_f32, re_f32, rect, label, subject_id):
    """
    Build one grid cell (height=224+LABEL_H, width=338):
      [face_224x224_with_rects | sep | left_eye_112 stacked over right_eye_112]
      [          label bar                                                      ]
    """
    face = (face_f32 * 255).clip(0, 255).astype(np.uint8).copy()
    le   = (le_f32   * 255).clip(0, 255).astype(np.uint8).copy()
    re   = (re_f32   * 255).clip(0, 255).astype(np.uint8).copy()

    face_bgr = cv2.cvtColor(face, cv2.COLOR_RGB2BGR)
    le_box, re_box = rect_to_face_boxes(rect)

    lx, ly, lw, lh = le_box
    cv2.rectangle(face_bgr, (lx, ly), (lx + lw, ly + lh), (0, 220, 0), 2)
    rx, ry, rw, rh = re_box
    cv2.rectangle(face_bgr, (rx, ry), (rx + rw, ry + rh), (30, 130, 255), 2)

    le_bgr = cv2.resize(cv2.cvtColor(le, cv2.COLOR_RGB2BGR), (112, 112))
    re_bgr = cv2.resize(cv2.cvtColor(re, cv2.COLOR_RGB2BGR), (112, 112))

    eye_col  = np.vstack([le_bgr, re_bgr])
    sep      = np.full((224, 2, 3), 50, dtype=np.uint8)
    main_row = np.hstack([face_bgr, sep, eye_col])

    bar  = np.full((LABEL_H, main_row.shape[1], 3), 25, dtype=np.uint8)
    text = f"s{int(subject_id):02d}  gaze=({label[0]:.3f}, {label[1]:.3f})"
    cv2.putText(bar, text, (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.38,
                (200, 200, 200), 1, cv2.LINE_AA)

    return np.vstack([main_row, bar])


def main():
    if not TFRECORD_PATH.exists():
        sys.exit(f"[ERROR] train.tfrecord not found: {TFRECORD_PATH}\n"
                 "Run preprocess.py first.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Derive total sample count from metadata if available; fall back to full scan
    if META_PATH.exists():
        with open(META_PATH) as f:
            meta = json.load(f)
        n_total = meta["splits"].get("train", {}).get("total", 0)
    else:
        print("metadata.json not found — counting records (slow)…")
        n_total = sum(1 for _ in tf.data.TFRecordDataset(str(TFRECORD_PATH)))

    if n_total == 0:
        sys.exit("[ERROR] train.tfrecord contains no records.")

    rng     = np.random.default_rng(SEED)
    indices = rng.choice(n_total, size=min(N_SAMPLES, n_total), replace=False)
    indices.sort()

    print(f"Building grid: {len(indices)} samples from {n_total} total…")
    records = _load_samples(TFRECORD_PATH, indices)

    cells = [
        make_cell(
            r["face"], r["left_eye"], r["right_eye"],
            r["rect"], r["label"], r["subject_id"],
        )
        for r in records
    ]

    blank = np.zeros_like(cells[0])

    rows = []
    for r in range(0, len(cells), COLS):
        row_cells = cells[r : r + COLS]
        while len(row_cells) < COLS:
            row_cells.append(blank)
        hpad    = np.full((row_cells[0].shape[0], PAD, 3), 12, dtype=np.uint8)
        row_img = row_cells[0]
        for c in row_cells[1:]:
            row_img = np.hstack([row_img, hpad, c])
        rows.append(row_img)

    vpad = np.full((PAD, rows[0].shape[1], 3), 12, dtype=np.uint8)
    grid = rows[0]
    for r in rows[1:]:
        grid = np.vstack([grid, vpad, r])

    legend_h = 24
    legend   = np.full((legend_h, grid.shape[1], 3), 20, dtype=np.uint8)
    cv2.putText(legend,
                "GREEN = left eye bbox   ORANGE = right eye bbox   "
                "Eyes stacked right of each face (L top / R bottom)",
                (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (160, 200, 160), 1, cv2.LINE_AA)
    grid = np.vstack([grid, legend])

    out_path = OUT_DIR / "grid.png"
    cv2.imwrite(str(out_path), grid)

    print(f"Saved -> {out_path}")
    print(f"Grid   : {grid.shape[1]} x {grid.shape[0]} px  ({COLS} cols x {len(rows)} rows)")
    print("Legend : green rect = left eye,  orange rect = right eye")
    print("         Right side of each cell: left_eye (top) / right_eye (bottom)")


if __name__ == "__main__":
    main()
