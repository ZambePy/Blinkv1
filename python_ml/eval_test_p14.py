"""Ad-hoc eval: gaze_cnn_best.keras on test.tfrecord (p14). NOT integrated."""
import os, json
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

from pathlib import Path
import numpy as np
import scipy.io
import tensorflow as tf

SCRIPT_DIR = Path(__file__).parent
CKPT = SCRIPT_DIR / "checkpoints" / "gaze_cnn_best.keras"
TFREC = SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze" / "processed" / "test.tfrecord"
SCREEN = SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze" / "raw" / "Data" / "p14" / "Calibration" / "screenSize.mat"

FEAT = {
    "face": tf.io.FixedLenFeature([], tf.string),
    "left_eye": tf.io.FixedLenFeature([], tf.string),
    "right_eye": tf.io.FixedLenFeature([], tf.string),
    "rect": tf.io.FixedLenFeature([12], tf.float32),
    "label": tf.io.FixedLenFeature([2], tf.float32),
    "subject_id": tf.io.FixedLenFeature([], tf.int64),
}

def parse(raw):
    p = tf.io.parse_single_example(raw, FEAT)
    inp = {
        "face": tf.reshape(tf.io.decode_raw(p["face"], tf.float32), [224, 224, 3]),
        "left_eye": tf.reshape(tf.io.decode_raw(p["left_eye"], tf.float32), [112, 112, 3]),
        "right_eye": tf.reshape(tf.io.decode_raw(p["right_eye"], tf.float32), [112, 112, 3]),
        "rect": p["rect"],
    }
    return inp, p["label"], p["subject_id"]

def main():
    mat = scipy.io.loadmat(str(SCREEN))
    wpx = float(mat["width_pixel"].flat[0])
    hpx = float(mat["height_pixel"].flat[0])
    wmm = float(mat["width_mm"].flat[0])
    hmm = float(mat["height_mm"].flat[0])
    print(f"p14 screen: {wpx:.0f}x{hpx:.0f} px  |  {wmm:.2f}x{hmm:.2f} mm")

    print(f"Loading {CKPT}")
    model = tf.keras.models.load_model(str(CKPT))

    ds = tf.data.TFRecordDataset(str(TFREC)).map(parse).batch(32).prefetch(tf.data.AUTOTUNE)

    preds, gts, sids = [], [], []
    n = 0
    for inp, lbl, sid in ds:
        y = model.predict(inp, verbose=0)
        preds.append(y)
        gts.append(lbl.numpy())
        sids.append(sid.numpy())
        n += y.shape[0]
        if n % 320 == 0:
            print(f"  processed {n} samples")

    preds = np.concatenate(preds, axis=0)
    gts = np.concatenate(gts, axis=0)
    sids = np.concatenate(sids, axis=0)
    print(f"Total: {preds.shape[0]} samples, unique subjects: {sorted(set(sids.tolist()))}")

    # Per-sample errors
    err_frac = preds - gts                                # (N, 2), fraction of screen
    err_px = np.column_stack([err_frac[:, 0] * wpx, err_frac[:, 1] * hpx])
    err_mm = np.column_stack([err_frac[:, 0] * wmm, err_frac[:, 1] * hmm])
    err_cm = err_mm / 10.0

    dist_frac = np.linalg.norm(err_frac, axis=1)
    dist_px = np.linalg.norm(err_px, axis=1)
    dist_cm = np.linalg.norm(err_cm, axis=1)

    def stats(name, arr, unit):
        print(f"  {name:>18} [{unit}]  mean={arr.mean():.4f}  median={np.median(arr):.4f}  "
              f"std={arr.std():.4f}  p90={np.percentile(arr, 90):.4f}  max={arr.max():.4f}")

    print("\n== Per-axis MAE ==")
    stats("MAE_x", np.abs(err_frac[:, 0]), "frac")
    stats("MAE_y", np.abs(err_frac[:, 1]), "frac")
    stats("MAE_x", np.abs(err_px[:, 0]), "px")
    stats("MAE_y", np.abs(err_px[:, 1]), "px")
    stats("MAE_x", np.abs(err_cm[:, 0]), "cm")
    stats("MAE_y", np.abs(err_cm[:, 1]), "cm")

    print("\n== Per-axis RMSE ==")
    for i, ax in enumerate(("x", "y")):
        rmse_f = float(np.sqrt(np.mean(err_frac[:, i] ** 2)))
        rmse_p = float(np.sqrt(np.mean(err_px[:, i] ** 2)))
        rmse_c = float(np.sqrt(np.mean(err_cm[:, i] ** 2)))
        print(f"  RMSE_{ax}: {rmse_f:.4f} frac | {rmse_p:.1f} px | {rmse_c:.3f} cm")

    print("\n== 2D Euclidean distance ==")
    stats("distance", dist_frac, "frac")
    stats("distance", dist_px, "px")
    stats("distance", dist_cm, "cm")

    # MSE (matches train_cnn loss)
    mse = float(np.mean(err_frac ** 2))
    mae_frac = float(np.mean(np.abs(err_frac)))
    print(f"\n== Aggregated (Keras-style, average of x,y) ==")
    print(f"  test_loss (MSE, frac²) : {mse:.6f}")
    print(f"  test_mae  (frac)       : {mae_frac:.6f}")

    out = {
        "subject": "p14",
        "n_samples": int(preds.shape[0]),
        "screen": {"width_px": wpx, "height_px": hpx, "width_mm": wmm, "height_mm": hmm},
        "test_loss_mse_frac": mse,
        "test_mae_frac": mae_frac,
        "euclid_cm": {
            "mean": float(dist_cm.mean()),
            "median": float(np.median(dist_cm)),
            "std": float(dist_cm.std()),
            "p90": float(np.percentile(dist_cm, 90)),
            "max": float(dist_cm.max()),
        },
        "euclid_px": {
            "mean": float(dist_px.mean()),
            "median": float(np.median(dist_px)),
        },
        "per_axis_rmse_cm": {
            "x": float(np.sqrt(np.mean(err_cm[:, 0] ** 2))),
            "y": float(np.sqrt(np.mean(err_cm[:, 1] ** 2))),
        },
        "per_axis_mae_cm": {
            "x": float(np.mean(np.abs(err_cm[:, 0]))),
            "y": float(np.mean(np.abs(err_cm[:, 1]))),
        },
    }
    out_path = SCRIPT_DIR / "eval_test_p14_results.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nSaved -> {out_path}")

if __name__ == "__main__":
    main()
