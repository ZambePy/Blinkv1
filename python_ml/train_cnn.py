"""
train_cnn.py — 3-branch CNN encoder for gaze estimation on MPIIFaceGaze.

Architecture (GazeFollower-inspired, screen-coordinate regression):
  Inputs  : face(224,224,3), left_eye(112,112,3), right_eye(112,112,3), rect(12,)
  Branches: face → Conv×3+GAP, eyes → Conv×2+GAP each
  Head    : concat → Dense(256,relu,name='embedding') → Dense(2,sigmoid)
  Output  : (gaze_x, gaze_y) in [0,1] screen fraction

Usage:
  python train_cnn.py --benchmark       # estimate training time first
  python train_cnn.py                   # full training
  python train_cnn.py --resume          # resume from last checkpoint
  python train_cnn.py --batch-size 16   # if RAM is tight

Training is intentionally on CPU.  TensorFlow ≥2.11 on native Windows
no longer supports GPU — this is expected, not a misconfiguration.
"""

import argparse
import json
import time
from pathlib import Path

import tensorflow as tf

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR    = Path(__file__).parent
PROCESSED_DIR = SCRIPT_DIR / "datasets" / "prototype_nc_mpiifacegaze" / "processed"
CKPT_DIR      = SCRIPT_DIR / "checkpoints"
META_PATH     = PROCESSED_DIR / "metadata.json"

BEST_CKPT  = CKPT_DIR / "gaze_cnn_best.keras"
LAST_CKPT  = CKPT_DIR / "gaze_cnn_last.keras"
STATE_FILE = CKPT_DIR / "checkpoint_state.json"
LOG_FILE   = CKPT_DIR / "training_log.csv"

# ── Hyper-parameters ──────────────────────────────────────────────────────────
# Reduce BATCH_SIZE to 16 if system RAM becomes tight; data is streamed so
# the full dataset never sits in RAM — only the shuffle buffer does.
BATCH_SIZE    = 32
LEARNING_RATE = 1e-3
MAX_EPOCHS    = 100
ES_PATIENCE   = 10    # EarlyStopping patience in epochs

# Shuffle buffer: ~2048 samples × ~0.86 MB/sample ≈ 1.8 GB in RAM.
# Lower to 512 (~440 MB) if this causes memory pressure.
SHUFFLE_BUF = 2048

BENCHMARK_BATCHES = 20  # warm-up batch excluded from timing

# ── TFRecord feature descriptor (mirrors validate_tfrecord.py) ────────────────
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
    inputs = {
        "face":      tf.reshape(tf.io.decode_raw(p["face"],      tf.float32), [224, 224, 3]),
        "left_eye":  tf.reshape(tf.io.decode_raw(p["left_eye"],  tf.float32), [112, 112, 3]),
        "right_eye": tf.reshape(tf.io.decode_raw(p["right_eye"], tf.float32), [112, 112, 3]),
        "rect":      p["rect"],
    }
    return inputs, p["label"]


def _augment(inputs, label):
    """Consistent brightness + contrast jitter across all 3 image branches."""
    # Single random factors per sample — keeps face/eye branches correlated.
    delta  = tf.random.uniform([], -0.15, 0.15)
    factor = tf.random.uniform([], 0.85, 1.15)

    def jitter(img):
        img = tf.image.adjust_brightness(img, delta)
        img = tf.image.adjust_contrast(img, factor)
        return tf.clip_by_value(img, 0.0, 1.0)

    return {
        "face":      jitter(inputs["face"]),
        "left_eye":  jitter(inputs["left_eye"]),
        "right_eye": jitter(inputs["right_eye"]),
        "rect":      inputs["rect"],
    }, label


def build_dataset(split: str, augment: bool, batch_size: int) -> tf.data.Dataset:
    path = PROCESSED_DIR / f"{split}.tfrecord"
    ds = tf.data.TFRecordDataset(str(path))
    ds = ds.map(_parse, num_parallel_calls=tf.data.AUTOTUNE)
    # .repeat() before shuffle: the shuffle buffer receives a continuous stream
    # across epoch boundaries, preventing OUT_OF_RANGE when model.fit() shares
    # one iterator across epochs (the behaviour when steps_per_epoch is explicit).
    ds = ds.repeat()
    if split == "train":
        ds = ds.shuffle(SHUFFLE_BUF, reshuffle_each_iteration=True)
    if augment:
        ds = ds.map(_augment, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(batch_size, drop_remainder=False)
    ds = ds.prefetch(tf.data.AUTOTUNE)
    return ds


# ── Model ─────────────────────────────────────────────────────────────────────

def _conv_block(x, filters: int, prefix: str):
    x = tf.keras.layers.Conv2D(
        filters, 3, padding="same", use_bias=False, name=f"{prefix}_conv"
    )(x)
    x = tf.keras.layers.BatchNormalization(name=f"{prefix}_bn")(x)
    x = tf.keras.layers.Activation("relu", name=f"{prefix}_relu")(x)
    x = tf.keras.layers.MaxPooling2D(2, name=f"{prefix}_pool")(x)
    return x


def build_model() -> tf.keras.Model:
    # Face branch — 3 conv blocks
    face_in = tf.keras.Input(shape=(224, 224, 3), name="face")
    f = _conv_block(face_in, 32,  "face_c1")
    f = _conv_block(f,       64,  "face_c2")
    f = _conv_block(f,       128, "face_c3")
    f = tf.keras.layers.GlobalAveragePooling2D(name="face_gap")(f)

    # Left-eye branch — 2 conv blocks
    leye_in = tf.keras.Input(shape=(112, 112, 3), name="left_eye")
    l = _conv_block(leye_in, 32, "leye_c1")
    l = _conv_block(l,       64, "leye_c2")
    l = tf.keras.layers.GlobalAveragePooling2D(name="leye_gap")(l)

    # Right-eye branch — 2 conv blocks
    reye_in = tf.keras.Input(shape=(112, 112, 3), name="right_eye")
    r = _conv_block(reye_in, 32, "reye_c1")
    r = _conv_block(r,       64, "reye_c2")
    r = tf.keras.layers.GlobalAveragePooling2D(name="reye_gap")(r)

    # Rect input (normalised bounding box coords)
    rect_in = tf.keras.Input(shape=(12,), name="rect")

    # Fusion: concat → embedding → gaze output
    merged    = tf.keras.layers.Concatenate(name="concat")([f, l, r, rect_in])
    embedding = tf.keras.layers.Dense(256, activation="relu", name="embedding")(merged)
    out       = tf.keras.layers.Dense(2,   activation="sigmoid", name="gaze_xy")(embedding)

    return tf.keras.Model(
        inputs=[face_in, leye_in, reye_in, rect_in],
        outputs=out,
        name="gaze_cnn",
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_metadata() -> dict:
    with open(META_PATH) as f:
        return json.load(f)


def _steps(meta: dict, split: str, batch_size: int) -> int:
    total = meta["splits"][split]["total"]
    return (total + batch_size - 1) // batch_size


# ── Benchmark ─────────────────────────────────────────────────────────────────

def run_benchmark(model: tf.keras.Model, batch_size: int) -> None:
    print("\n" + "=" * 62)
    print("  BENCHMARK MODE  —  no checkpoints will be saved")
    print("=" * 62)

    meta            = _load_metadata()
    steps_per_epoch = _steps(meta, "train", batch_size)
    total_train     = meta["splits"]["train"]["total"]

    model.compile(optimizer=tf.keras.optimizers.Adam(LEARNING_RATE), loss="mse")

    ds = build_dataset("train", augment=False, batch_size=batch_size)
    it = iter(ds)

    print("  Running 1 warm-up batch (graph tracing) …")
    model.train_on_batch(*next(it))

    print(f"  Timing {BENCHMARK_BATCHES} batches …")
    t0 = time.perf_counter()
    for _ in range(BENCHMARK_BATCHES):
        model.train_on_batch(*next(it))
    elapsed = time.perf_counter() - t0

    sec_per_batch = elapsed / BENCHMARK_BATCHES
    sec_per_epoch = sec_per_batch * steps_per_epoch
    sec_total     = sec_per_epoch * MAX_EPOCHS  # upper bound; ES fires sooner

    print(f"\n  Dataset (train)    : {total_train:,} samples")
    print(f"  Batch size         : {batch_size}")
    print(f"  Steps / epoch      : {steps_per_epoch}")
    print(f"  Batches timed      : {BENCHMARK_BATCHES}")
    print(f"  Time / batch       : {sec_per_batch:.2f} s")
    print(f"  Estimated / epoch  : {sec_per_epoch / 60:.1f} min")
    print(f"  Estimated total    : {sec_total / 3600:.1f} h  (<= {MAX_EPOCHS} epochs)")
    print(f"  (EarlyStopping @ patience={ES_PATIENCE} will likely cut this)")
    print("=" * 62)


# ── Full training ─────────────────────────────────────────────────────────────

class _EpochStateCallback(tf.keras.callbacks.Callback):
    """Persists the last completed epoch number so --resume can continue."""
    def on_epoch_end(self, epoch, logs=None):
        STATE_FILE.write_text(json.dumps({"last_epoch": epoch + 1}))


def run_training(
    model: tf.keras.Model,
    initial_epoch: int,
    batch_size: int,
    steps_limit: int | None = None,
) -> None:
    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    meta = _load_metadata()

    train_ds = build_dataset("train", augment=True,  batch_size=batch_size)
    val_ds   = build_dataset("val",   augment=False, batch_size=batch_size)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(LEARNING_RATE),
        loss="mse",
        metrics=["mae"],
    )

    smoke_test = steps_limit is not None
    n_steps     = steps_limit if smoke_test else _steps(meta, "train", batch_size)
    n_val_steps = steps_limit if smoke_test else _steps(meta, "val",   batch_size)
    n_epochs    = initial_epoch + 3 if smoke_test else MAX_EPOCHS

    if smoke_test:
        print(f"\n[smoke-test] steps_per_epoch={n_steps}, validation_steps={n_val_steps}, epochs=3")

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=ES_PATIENCE,
            restore_best_weights=True,
            verbose=1,
        ),
        tf.keras.callbacks.ModelCheckpoint(
            str(BEST_CKPT),
            monitor="val_loss",
            save_best_only=True,
            verbose=1,
        ),
        # Saved unconditionally each epoch so --resume can pick up where we left off
        tf.keras.callbacks.ModelCheckpoint(
            str(LAST_CKPT),
            save_best_only=False,
            verbose=0,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=5,
            min_lr=1e-6,
            verbose=1,
        ),
        tf.keras.callbacks.CSVLogger(
            str(LOG_FILE),
            append=(initial_epoch > 0),
        ),
        _EpochStateCallback(),
    ]

    t0 = time.perf_counter()
    history = model.fit(
        train_ds,
        epochs=n_epochs,
        initial_epoch=initial_epoch,
        steps_per_epoch=n_steps,
        validation_data=val_ds,
        validation_steps=n_val_steps,
        callbacks=callbacks,
        verbose=1,
    )
    elapsed = time.perf_counter() - t0

    _print_summary(history, elapsed, batch_size)


def _print_summary(history, elapsed: float, batch_size: int) -> None:
    print("\n" + "=" * 62)
    print("  TRAINING SUMMARY")
    print("=" * 62)

    cpus = tf.config.list_physical_devices("CPU")
    gpus = tf.config.list_physical_devices("GPU")
    print(f"  Device      : CPU  {[d.name for d in cpus]}")
    if gpus:
        print(f"  (GPU present but not used — TF ≥2.11 on Windows trains on CPU)")
    print(f"  Batch size  : {batch_size}")

    val_losses = history.history.get("val_loss", [])
    if val_losses:
        best_val = min(val_losses)
        best_idx = val_losses.index(best_val)
        # history.epoch holds absolute 0-based epoch indices; +1 matches Keras "Epoch N/100" display
        best_ep  = history.epoch[best_idx] + 1
        print(f"  Epochs run  : {len(val_losses)}  (best @ epoch {best_ep})")
        print(f"  Best val_loss (MSE)      : {best_val:.6f}")
        # MSE averages x and y errors equally, so sqrt(MSE) is per-coord RMSE
        rmse = best_val ** 0.5
        print(f"  Per-coord RMSE           : {rmse:.4f}  (normalised, [0,1])")
        print(f"  ~pixel RMSE @ 1920 wide  : {rmse * 1920:.1f} px")
        print(f"  ~pixel RMSE @ 1080 tall  : {rmse * 1080:.1f} px")

    print(f"  Total time  : {elapsed / 3600:.2f} h")
    print(f"  Best ckpt   : {BEST_CKPT}")
    print(f"  Last ckpt   : {LAST_CKPT}")
    print(f"  Train log   : {LOG_FILE}")
    print("=" * 62)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train 3-branch gaze CNN on MPIIFaceGaze TFRecords."
    )
    parser.add_argument(
        "--benchmark", action="store_true",
        help="Run ~20 timed batches and print a time estimate, then exit.",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume from gaze_cnn_last.keras if it exists.",
    )
    parser.add_argument(
        "--batch-size", type=int, default=BATCH_SIZE, metavar="N",
        help=f"Batch size (default {BATCH_SIZE}). Use 16 if RAM is tight.",
    )
    parser.add_argument(
        "--steps-limit", type=int, default=None, metavar="N",
        help="Cap steps_per_epoch and validation_steps at N and run only 3 epochs "
             "(smoke-test mode — verifies no OUT_OF_RANGE across epoch boundaries).",
    )
    args = parser.parse_args()

    # Report device situation upfront
    cpus = tf.config.list_physical_devices("CPU")
    gpus = tf.config.list_physical_devices("GPU")
    print(f"TensorFlow {tf.__version__}")
    print(f"CPUs : {[d.name for d in cpus]}")
    print(f"GPUs : {[d.name for d in gpus]}"
          + ("  (not used — TF ≥2.11 on Windows trains on CPU)" if gpus else "  (none)"))

    # Load or build model
    initial_epoch = 0
    if args.resume and LAST_CKPT.exists():
        print(f"\nLoading checkpoint: {LAST_CKPT}")
        model = tf.keras.models.load_model(str(LAST_CKPT))
        if STATE_FILE.exists():
            state = json.loads(STATE_FILE.read_text())
            initial_epoch = state.get("last_epoch", 0)
        print(f"Resuming from epoch {initial_epoch}")
    else:
        if args.resume:
            print("--resume requested but no checkpoint found — starting fresh.")
        model = build_model()
        model.summary(line_length=90)

    if args.benchmark:
        run_benchmark(model, args.batch_size)
        return

    run_training(model, initial_epoch, args.batch_size, steps_limit=args.steps_limit)


if __name__ == "__main__":
    main()
