"""
Preprocess MPIIFaceGaze → .tfrecord splits (train/val/test).

DATASET LICENCE: MPIIFaceGaze — CC BY-NC-SA, non-commercial research only.
Resulting .tfrecord files are for architecture validation exclusively.
DO NOT use weights trained on this data in production builds without
prior legal review.

Writes incrementally — each sample goes straight to the .tfrecord writer as it
is processed, never accumulating more than one subject's images in memory at a
time.  This resolves the MemoryError that occurred when np.concatenate tried to
assemble the full train split (~18.5 GiB) in RAM.

Annotation format (one line per image):
  img_rel  gaze_x  gaze_y  lm1x lm1y ... lm6x lm6y  <12 pose cols>  eye_side
  col 0    col 1   col 2   cols 3-14                  cols 15-26      col 27

Usage:
  # Gate validation — 2 subjects only:
  python preprocess.py --subjects p00 p01

  # Full dataset:
  python preprocess.py
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import psutil
import scipy.io
import tensorflow as tf
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).parent
BASE_DIR      = _SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze"
RAW_DIR       = BASE_DIR / "raw" / "Data"
PROCESSED_DIR = BASE_DIR / "processed"

ALL_SUBJECTS   = [f"p{i:02d}" for i in range(15)]
TRAIN_SUBJECTS = set(ALL_SUBJECTS[:12])    # p00–p11
VAL_SUBJECTS   = set(ALL_SUBJECTS[12:14])  # p12, p13
TEST_SUBJECTS  = set(ALL_SUBJECTS[14:])    # p14

# MediaPipe FaceMesh landmark indices used for eye crops
_LEFT_EYE_IDX  = [33, 133, 159, 145]   # outer-corner, inner-corner, top, bottom
_RIGHT_EYE_IDX = [362, 263, 386, 374]  # inner-corner, outer-corner, top, bottom

EYE_MARGIN = 0.4  # fraction of half-size added as padding on each side

# Fixed shapes used when writing and reading back TFRecords
FIELD_SHAPES = {
    "face":      [224, 224, 3],
    "left_eye":  [112, 112, 3],
    "right_eye": [112, 112, 3],
    "rect":      [12],
    "label":     [2],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_screen_size(subject_dir: Path):
    mat = scipy.io.loadmat(subject_dir / "Calibration" / "screenSize.mat")
    return int(mat["width_pixel"].flat[0]), int(mat["height_pixel"].flat[0])


def _load_annotations(ann_path: Path):
    """Return list of (img_rel, gaze_x_px, gaze_y_px)."""
    rows = []
    with open(ann_path) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 3:
                continue
            rows.append((parts[0], float(parts[1]), float(parts[2])))
    return rows


def _lm_bbox(landmarks, indices, img_w, img_h):
    xs = [landmarks[i].x * img_w for i in indices]
    ys = [landmarks[i].y * img_h for i in indices]
    return min(xs), min(ys), max(xs), max(ys)


def _crop_eye(img_rgb, x1, y1, x2, y2, margin, out_size):
    """Crop eye region with margin; return (resized_crop, (bx, by, bw, bh)) or (None, None)."""
    img_h, img_w = img_rgb.shape[:2]
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    hw = (x2 - x1) / 2.0 * (1.0 + margin)
    hh = (y2 - y1) / 2.0 * (1.0 + margin)
    bx  = max(0, int(cx - hw))
    by  = max(0, int(cy - hh))
    bx2 = min(img_w, int(cx + hw))
    by2 = min(img_h, int(cy + hh))
    bw, bh = bx2 - bx, by2 - by
    crop = img_rgb[by:by2, bx:bx2]
    if crop.size == 0:
        return None, None
    return cv2.resize(crop, (out_size, out_size)), (bx, by, bw, bh)


def _make_example(face_f32, left_eye_f32, right_eye_f32, rect, label, subject_id: int):
    """Serialize one sample as a tf.train.Example proto."""
    feature = {
        "face":       tf.train.Feature(bytes_list=tf.train.BytesList(value=[face_f32.tobytes()])),
        "left_eye":   tf.train.Feature(bytes_list=tf.train.BytesList(value=[left_eye_f32.tobytes()])),
        "right_eye":  tf.train.Feature(bytes_list=tf.train.BytesList(value=[right_eye_f32.tobytes()])),
        "rect":       tf.train.Feature(float_list=tf.train.FloatList(value=rect.tolist())),
        "label":      tf.train.Feature(float_list=tf.train.FloatList(value=label.tolist())),
        "subject_id": tf.train.Feature(int64_list=tf.train.Int64List(value=[subject_id])),
    }
    return tf.train.Example(features=tf.train.Features(feature=feature))


# ---------------------------------------------------------------------------
# Per-subject processing  (streaming — writes directly, never accumulates)
# ---------------------------------------------------------------------------

def process_subject(subject: str, face_mesh, writer):
    """
    Process all images for one subject and write each sample directly to
    `writer` as it is produced.  Returns (n_processed, n_skipped).
    """
    subj_dir  = RAW_DIR / subject
    screen_w, screen_h = _read_screen_size(subj_dir)
    annotations = _load_annotations(subj_dir / f"{subject}.txt")
    sid = int(subject[1:])

    n_processed = 0
    n_skipped   = 0

    for img_rel, gaze_x, gaze_y in tqdm(annotations, desc=subject, leave=False):
        img_path = subj_dir / img_rel
        img_bgr  = cv2.imread(str(img_path))
        if img_bgr is None:
            n_skipped += 1
            continue

        img_h, img_w = img_bgr.shape[:2]
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        result = face_mesh.process(img_rgb)
        if not result.multi_face_landmarks:
            n_skipped += 1
            continue

        lm = result.multi_face_landmarks[0].landmark

        # --- face bbox from full mesh convex hull ---
        all_x = [l.x * img_w for l in lm]
        all_y = [l.y * img_h for l in lm]
        fx1 = max(0, int(min(all_x)))
        fy1 = max(0, int(min(all_y)))
        fx2 = min(img_w, int(max(all_x)))
        fy2 = min(img_h, int(max(all_y)))
        face_crop = img_rgb[fy1:fy2, fx1:fx2]
        if face_crop.size == 0:
            n_skipped += 1
            continue
        face_crop = cv2.resize(face_crop, (224, 224))

        # --- left eye crop ---
        le_x1, le_y1, le_x2, le_y2 = _lm_bbox(lm, _LEFT_EYE_IDX, img_w, img_h)
        le_crop, le_box = _crop_eye(img_rgb, le_x1, le_y1, le_x2, le_y2, EYE_MARGIN, 112)

        # --- right eye crop (mirrored) ---
        re_x1, re_y1, re_x2, re_y2 = _lm_bbox(lm, _RIGHT_EYE_IDX, img_w, img_h)
        re_crop, re_box = _crop_eye(img_rgb, re_x1, re_y1, re_x2, re_y2, EYE_MARGIN, 112)

        if le_crop is None or re_crop is None:
            n_skipped += 1
            continue

        re_crop = re_crop[:, ::-1, :]  # horizontal mirror

        # --- rect: 12 values, all normalized by image dimensions ---
        fw, fh = fx2 - fx1, fy2 - fy1
        le_bx, le_by, le_bw, le_bh = le_box
        re_bx, re_by, re_bw, re_bh = re_box
        rect = np.array([
            fw    / img_w, fh    / img_h, fx1   / img_w, fy1   / img_h,
            le_bw / img_w, le_bh / img_h, le_bx / img_w, le_by / img_h,
            re_bw / img_w, re_bh / img_h, re_bx / img_w, re_by / img_h,
        ], dtype=np.float32)

        # --- label: gaze fraction of screen, clipped to [0, 1] ---
        label = np.array([
            np.clip(gaze_x / screen_w, 0.0, 1.0),
            np.clip(gaze_y / screen_h, 0.0, 1.0),
        ], dtype=np.float32)

        # Normalize images to [0, 1] float32.  astype() is a copy so the
        # mirrored right-eye view becomes contiguous before tobytes().
        face_f32 = face_crop.astype(np.float32) / 255.0
        le_f32   = le_crop.astype(np.float32)   / 255.0
        re_f32   = re_crop.astype(np.float32)   / 255.0

        writer.write(_make_example(face_f32, le_f32, re_f32, rect, label, sid).SerializeToString())
        n_processed += 1

    return n_processed, n_skipped


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Preprocess MPIIFaceGaze into train/val/test .tfrecord splits."
    )
    parser.add_argument(
        "--subjects", nargs="+", default=None, metavar="pXX",
        help="Process only these subjects (e.g. --subjects p00 p01). Default: all 15.",
    )
    args = parser.parse_args()

    subjects_to_run = args.subjects if args.subjects else ALL_SUBJECTS

    invalid = [s for s in subjects_to_run if s not in ALL_SUBJECTS]
    if invalid:
        sys.exit(f"Unknown subjects: {invalid}. Valid range: p00–p14.")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=False,
        min_detection_confidence=0.5,
    )

    proc = psutil.Process()
    peak_rss_mb = proc.memory_info().rss / (1024 ** 2)

    # Metadata accumulators
    split_totals  = {"train": 0, "val": 0, "test": 0}
    subject_dist  = {"train": {}, "val": {}, "test": {}}
    subject_counts = {}
    total_processed = 0
    total_skipped   = 0

    # Writers opened lazily so partial runs don't create empty files
    writers = {}

    def _get_writer(split):
        if split not in writers:
            writers[split] = tf.io.TFRecordWriter(str(PROCESSED_DIR / f"{split}.tfrecord"))
        return writers[split]

    try:
        for subj in subjects_to_run:
            if subj in TRAIN_SUBJECTS:
                split = "train"
            elif subj in VAL_SUBJECTS:
                split = "val"
            else:
                split = "test"

            print(f"\n-> {subj}  [split={split}]")
            n, sk = process_subject(subj, face_mesh, _get_writer(split))

            split_totals[split]       += n
            subject_dist[split][subj]  = n
            subject_counts[subj]       = {"processed": n, "skipped": sk}
            total_processed += n
            total_skipped   += sk

            rss_mb = proc.memory_info().rss / (1024 ** 2)
            if rss_mb > peak_rss_mb:
                peak_rss_mb = rss_mb
            print(f"   processed={n}  skipped={sk}  RAM={rss_mb:.0f} MB")

    finally:
        for w in writers.values():
            w.close()
        face_mesh.close()

    # --- Write metadata JSON ---
    metadata = {
        "splits": {
            split: {
                "total":    split_totals[split],
                "subjects": subject_dist[split],
            }
            for split in ("train", "val", "test")
            if split_totals[split] > 0
        },
        "shapes": FIELD_SHAPES,
        "dtype": "float32",
    }
    meta_path = PROCESSED_DIR / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"\nMetadata -> {meta_path}")

    # --- Summary ---
    print("\n" + "=" * 55)
    print("SUMMARY")
    print(f"  Total processed : {total_processed}")
    print(f"  Total skipped   : {total_skipped}")
    print(f"  Peak RAM        : {peak_rss_mb:.0f} MB")
    print("\n  Per-split file sizes:")
    for split in ("train", "val", "test"):
        p = PROCESSED_DIR / f"{split}.tfrecord"
        if p.exists():
            size_gib = p.stat().st_size / (1024 ** 3)
            print(f"    {split}.tfrecord : {size_gib:.2f} GiB  ({split_totals[split]} samples)")
    print("\n  Per-subject breakdown:")
    for subj in subjects_to_run:
        split_tag = (
            "train" if subj in TRAIN_SUBJECTS else
            "val"   if subj in VAL_SUBJECTS   else
            "test"
        )
        counts = subject_counts[subj]
        print(
            f"    {subj} [{split_tag}]  "
            f"processed={counts['processed']}  skipped={counts['skipped']}"
        )
    print("=" * 55)


if __name__ == "__main__":
    main()
