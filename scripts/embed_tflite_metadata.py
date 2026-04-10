from pathlib import Path
import argparse


def main() -> int:
    parser = argparse.ArgumentParser(description="Embed TFLite Object Detection metadata into model")
    parser.add_argument(
        "--model",
        default="public/models/gear_guard_net-tflite-float/gear_guard_net.tflite",
        help="Path to source .tflite model",
    )
    parser.add_argument(
        "--labels",
        default="public/models/gear_guard_net-tflite-float/labels.txt",
        help="Path to labels.txt",
    )
    parser.add_argument(
        "--output",
        default="public/models/ppe_detector.tflite",
        help="Path to output .tflite with embedded metadata",
    )

    args = parser.parse_args()

    model_path = Path(args.model)
    labels_path = Path(args.labels)
    output_path = Path(args.output)

    if not model_path.exists():
        print(f"[ERROR] Model not found: {model_path}")
        return 1
    if not labels_path.exists():
        print(f"[ERROR] Labels not found: {labels_path}")
        return 1

    try:
        from tflite_support.metadata_writers import object_detector
        from tflite_support.metadata_writers import writer_utils
        from tflite_support import metadata as _metadata
    except Exception as exc:
        print("[ERROR] Missing dependency tflite-support. Install with: pip install tflite-support")
        print(f"Details: {exc}")
        return 2

    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[INFO] Source model : {model_path}")
    print(f"[INFO] Labels       : {labels_path}")
    print(f"[INFO] Output model : {output_path}")

    try:
        writer = object_detector.MetadataWriter.create_for_inference(
            writer_utils.load_file(str(model_path)),
            input_norm_mean=[127.5],
            input_norm_std=[127.5],
            label_file_paths=[str(labels_path)],
        )
        populated = writer.populate()
        writer_utils.save_file(populated, str(output_path))
    except Exception as exc:
        print("[ERROR] Failed to embed metadata.")
        print(f"Details: {exc}")
        return 3

    try:
        displayer = _metadata.MetadataDisplayer.with_model_file(str(output_path))
        metadata_json = displayer.get_metadata_json()
        print("[OK] Embedded metadata successfully.")
        print("[INFO] Metadata preview:")
        print(metadata_json[:1200] + ("..." if len(metadata_json) > 1200 else ""))
    except Exception as exc:
        print("[WARN] Output model created but failed to read metadata back.")
        print(f"Details: {exc}")
        return 4

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
