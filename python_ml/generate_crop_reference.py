# -*- coding: utf-8 -*-
"""
generate_crop_reference.py - Gera fixtures de referencia para comparar eyeCrop.ts vs Python.

Pega uma imagem fixa do dataset MPIIFaceGaze (p00/day01/0005.jpg), roda a
mesma logica de preprocess.py e salva em python_ml/test_fixtures/:
  - raw_image_rgb.bin   : bytes brutos HxWx3 uint8 da imagem original
  - image_dims.json     : {"width": W, "height": H}
  - landmarks.json      : lista de 478 {x, y, z} normalizados
  - face_box.json       : PixelBox da face
  - le_box.json         : PixelBox do olho esquerdo (com margem)
  - re_box.json         : PixelBox do olho direito (com margem)
  - rect_ref.json       : 12 floats do vetor rect
  - face_f32.bin        : 224*224*3 float32 (RGB, [0,1])
  - left_eye_f32.bin    : 112*112*3 float32 (RGB, [0,1])
  - right_eye_f32.bin   : 112*112*3 float32 (RGB, [0,1], espelhado)

Usage:
  python generate_crop_reference.py
"""

import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

SCRIPT_DIR  = Path(__file__).parent
FIXTURE_DIR = SCRIPT_DIR / "test_fixtures"
IMAGE_PATH  = (
    SCRIPT_DIR
    / "datasets" / "prototype_nc_mpiifacegaze" / "raw" / "Data"
    / "p00" / "day01" / "0005.jpg"
)

_LEFT_EYE_IDX  = [33, 133, 159, 145]
_RIGHT_EYE_IDX = [362, 263, 386, 374]
EYE_MARGIN = 0.4


def _lm_bbox(lm, indices, img_w, img_h):
    xs = [lm[i].x * img_w for i in indices]
    ys = [lm[i].y * img_h for i in indices]
    return min(xs), min(ys), max(xs), max(ys)


def _crop_eye(img_rgb, x1, y1, x2, y2, margin, out_size):
    img_h, img_w = img_rgb.shape[:2]
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    hw = (x2 - x1) / 2.0 * (1.0 + margin)
    hh = (y2 - y1) / 2.0 * (1.0 + margin)
    bx  = max(0, int(cx - hw))
    by  = max(0, int(cy - hh))
    bx2 = min(img_w, int(cx + hw))
    by2 = min(img_h, int(cy + hh))
    bw, bh = bx2 - bx, by2 - by
    if bw <= 0 or bh <= 0:
        return None, None
    crop = img_rgb[by:by2, bx:bx2]
    return cv2.resize(crop, (out_size, out_size)), (bx, by, bw, bh)


def main():
    if not IMAGE_PATH.exists():
        print("[ERROR] Imagem nao encontrada:", IMAGE_PATH)
        sys.exit(1)

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    print("[load] Lendo", IMAGE_PATH)
    img_bgr = cv2.imread(str(IMAGE_PATH))
    if img_bgr is None:
        print("[ERROR] cv2.imread falhou")
        sys.exit(1)

    img_h, img_w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    print("[load] Dimensoes:", img_w, "x", img_h)

    # Salva bytes brutos da imagem (HxWx3 uint8 RGB)
    (FIXTURE_DIR / "raw_image_rgb.bin").write_bytes(img_rgb.astype(np.uint8).tobytes())
    (FIXTURE_DIR / "image_dims.json").write_text(json.dumps({"width": img_w, "height": img_h}))
    print("[save] raw_image_rgb.bin + image_dims.json")

    # Roda MediaPipe FaceMesh
    print("[mediapipe] Rodando FaceMesh ...")
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=False,
        min_detection_confidence=0.5,
    )
    result = face_mesh.process(img_rgb)
    face_mesh.close()

    if not result.multi_face_landmarks:
        print("[ERROR] FaceMesh nao detectou face em", IMAGE_PATH)
        sys.exit(1)

    lm = result.multi_face_landmarks[0].landmark
    lm_list = [{"x": l.x, "y": l.y, "z": l.z} for l in lm]
    print("[mediapipe] Detectados", len(lm_list), "landmarks")

    (FIXTURE_DIR / "landmarks.json").write_text(json.dumps(lm_list))
    print("[save] landmarks.json")

    # Face bbox (convex hull de todos os 478 landmarks)
    all_x = [l.x * img_w for l in lm]
    all_y = [l.y * img_h for l in lm]
    fx1 = max(0, int(min(all_x)))
    fy1 = max(0, int(min(all_y)))
    fx2 = min(img_w, int(max(all_x)))
    fy2 = min(img_h, int(max(all_y)))
    face_crop_raw = img_rgb[fy1:fy2, fx1:fx2]
    face_crop = cv2.resize(face_crop_raw, (224, 224))

    face_box = {"x1": fx1, "y1": fy1, "x2": fx2, "y2": fy2, "w": fx2 - fx1, "h": fy2 - fy1}
    (FIXTURE_DIR / "face_box.json").write_text(json.dumps(face_box))
    print("[save] face_box.json:", face_box)

    # Left eye
    le_x1, le_y1, le_x2, le_y2 = _lm_bbox(lm, _LEFT_EYE_IDX, img_w, img_h)
    le_crop, le_box_raw = _crop_eye(img_rgb, le_x1, le_y1, le_x2, le_y2, EYE_MARGIN, 112)
    if le_crop is None:
        print("[ERROR] left eye crop falhou")
        sys.exit(1)
    le_bx, le_by, le_bw, le_bh = le_box_raw
    le_box = {"x1": le_bx, "y1": le_by, "x2": le_bx + le_bw, "y2": le_by + le_bh,
              "w": le_bw, "h": le_bh}
    (FIXTURE_DIR / "le_box.json").write_text(json.dumps(le_box))
    print("[save] le_box.json:", le_box)

    # Right eye (espelhado)
    re_x1, re_y1, re_x2, re_y2 = _lm_bbox(lm, _RIGHT_EYE_IDX, img_w, img_h)
    re_crop, re_box_raw = _crop_eye(img_rgb, re_x1, re_y1, re_x2, re_y2, EYE_MARGIN, 112)
    if re_crop is None:
        print("[ERROR] right eye crop falhou")
        sys.exit(1)
    re_bx, re_by, re_bw, re_bh = re_box_raw
    re_box = {"x1": re_bx, "y1": re_by, "x2": re_bx + re_bw, "y2": re_by + re_bh,
              "w": re_bw, "h": re_bh}
    (FIXTURE_DIR / "re_box.json").write_text(json.dumps(re_box))
    print("[save] re_box.json:", re_box)

    re_crop_mirrored = re_crop[:, ::-1, :]

    # Rect
    rect_vals = [
        (fx2-fx1) / img_w, (fy2-fy1) / img_h, fx1 / img_w, fy1 / img_h,
        le_bw / img_w, le_bh / img_h, le_bx / img_w, le_by / img_h,
        re_bw / img_w, re_bh / img_h, re_bx / img_w, re_by / img_h,
    ]
    (FIXTURE_DIR / "rect_ref.json").write_text(json.dumps(rect_vals))
    print("[save] rect_ref.json:", ["%.4f" % v for v in rect_vals])

    # Tensores float32 [0,1]
    face_f32 = face_crop.astype(np.float32) / 255.0
    le_f32   = le_crop.astype(np.float32)   / 255.0
    re_f32   = re_crop_mirrored.astype(np.float32) / 255.0

    (FIXTURE_DIR / "face_f32.bin").write_bytes(face_f32.tobytes())
    (FIXTURE_DIR / "left_eye_f32.bin").write_bytes(le_f32.tobytes())
    (FIXTURE_DIR / "right_eye_f32.bin").write_bytes(re_f32.tobytes())
    print("[save] face_f32.bin  (%dx%dx3)" % (224, 224))
    print("[save] left_eye_f32.bin  (%dx%dx3)" % (112, 112))
    print("[save] right_eye_f32.bin (%dx%dx3, espelhado)" % (112, 112))

    print("\n[done] Fixtures salvas em", FIXTURE_DIR)


if __name__ == "__main__":
    main()
