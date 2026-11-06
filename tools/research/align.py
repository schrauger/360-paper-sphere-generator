"""Fit scale + translation mapping each cropped fixture's mask image to the canonical high-res DXF mask.

Writes test-output/research/<id>.align.json = {scale, tx, ty, maskIoU}, with x_canon = scale*x_ref + tx.
"""
import json

import cv2
import numpy as np
from scipy.optimize import minimize

import common


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def iou_at(ref_ink, canon, params, d):
    """IoU at 1/d resolution; params are full-res (scale, tx, ty)."""
    s, tx, ty = params
    M = np.array([[s / d, 0, tx / d], [0, s / d, ty / d]], np.float64)
    h, w = canon.shape
    small = cv2.warpAffine(ref_ink, M, (w, h), flags=cv2.INTER_LINEAR)
    a, b = small > 127, canon > 127
    return (a & b).sum() / max((a | b).sum(), 1)


def iou_without_marks(ref_ink, canon, p):
    """IoU after dropping reference ink blobs that never touch the canonical mask (hand-added marks)."""
    h, w = canon.shape
    M = np.array([[p[0], 0, p[1]], [0, p[0], p[2]]], np.float64)
    a = cv2.warpAffine(ref_ink, M, (w, h), flags=cv2.INTER_LINEAR) > 127
    b = canon > 127
    n, labels = cv2.connectedComponents(a.astype(np.uint8), connectivity=8)
    keep = np.unique(labels[a & b])
    a = np.isin(labels, keep[keep > 0])
    return (a & b).sum() / max((a | b).sum(), 1)


def fit(fixture, canon_full):
    ref = cv2.imread(fixture["mask"], cv2.IMREAD_GRAYSCALE)
    ink = np.where(ref < 128, 255, 0).astype(np.uint8)
    rx0, ry0, rx1, ry1 = bbox(ink)
    cx0, cy0, cx1, cy1 = bbox(canon_full)
    s = ((cx1 - cx0) / (rx1 - rx0) + (cy1 - cy0) / (ry1 - ry0)) / 2
    p = np.array([s, cx0 - s * rx0, cy0 - s * ry0])
    for d, steps in ((8, (0.01, 8, 8)), (4, (0.003, 3, 3)), (2, (0.001, 1.5, 1.5)), (1, (0.0003, 0.5, 0.5))):
        canon = cv2.resize(canon_full, None, fx=1 / d, fy=1 / d, interpolation=cv2.INTER_AREA)
        simplex = np.vstack([p] + [p + np.eye(3)[i] * steps[i] for i in range(3)])
        r = minimize(lambda q: -iou_at(ink, canon, q, d), p, method="Nelder-Mead",
                     options={"initial_simplex": simplex, "xatol": steps[0] / 20, "fatol": 1e-6, "maxiter": 300})
        p = r.x
    return p, iou_at(ink, canon_full, p, 1), iou_without_marks(ink, canon_full, p)


def main():
    manifest = common.load_manifest()
    canon = common.canonical_mask("high", manifest)
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in manifest["fixtures"]:
        if not f.get("cropped"):
            continue
        p, iou, iou_clean = fit(f, canon)
        out = {"scale": float(p[0]), "tx": float(p[1]), "ty": float(p[2]), "maskIoU": float(iou), "maskIoUExcludingMarks": float(iou_clean)}
        common.align_path(f["id"]).write_text(json.dumps(out, indent=2))
        print(f["id"], out, "| maskIoU", round(iou, 4), "excluding marks", round(iou_clean, 4))


if __name__ == "__main__":
    main()
