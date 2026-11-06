"""Per-fixture colour tolerances from the reference images themselves.

maeHalfPixel: MAE between the reference and itself shifted by (0.5, 0.5) px (bilinear).
maeJpegReencode: MAE between the reference and a JPEG q90 re-encode of it.
Both over RGB, on pixels inside the canonical high-res ink mask eroded by 6 px.
Writes test/regression/tolerances.json (numbers only, 2 decimals).
"""
import json

import cv2
import numpy as np

import common

ERODE_PX = 6


def main():
    manifest = common.load_manifest()
    ink = common.canonical_mask("high", manifest)
    k = 2 * ERODE_PX + 1
    interior_base = cv2.erode(ink, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
    result = {}
    for f in manifest["fixtures"]:
        img, valid = common.aligned_reference_high(f)
        interior = interior_base & (valid > 0)
        shifted = cv2.warpAffine(img, np.array([[1, 0, 0.5], [0, 1, 0.5]], np.float64),
                                 (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_REPLICATE)
        half = np.abs(img.astype(np.float32) - shifted.astype(np.float32))[interior].mean()
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        re = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        jpeg = np.abs(img.astype(np.float32) - re.astype(np.float32))[interior].mean()
        result[f["id"]] = {"maeHalfPixel": round(float(half), 2), "maeJpegReencode": round(float(jpeg), 2)}
        print(f["id"], result[f["id"]], "interior px", int(interior.sum()))
    out = common.REPO / "test" / "regression" / "tolerances.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
