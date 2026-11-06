"""Measure 360craft's print style (T10): tab grey, outline width, bleed width.

Needs the model geometry in canonical low-res sheet px: run first
    node tools/research/dump-style-geometry.mjs
then
    uv run --with-requirements tools/research/requirements.txt python tools/research/measure-style.py

 - tab grey: median RGB of pixels inside the tab polygons that are >= 3 px from the model seam and from the cut path
   (every reference without an outline: alaska, site-high-bleed; and site-low-outline);
 - outline width: dark-run width across the cut path in the low-res outline sample (site-low-outline), sub-pixel,
   from the half-contrast crossings on both sides of the darkest point; median;
 - bleed width: along the outward normal from the seam into the tab, the distance to where the image content
   gives way to tab grey (alaska, site-high-bleed); median over seam points away from the tips.
Each is converted to R units with the fitted pxPerR; the bleed also to a SPHERE distance by the edge stretch kEdge
(ruling R27). Writes test-output/research/style.json and prints the values.
"""
import json

import cv2
import numpy as np
from scipy.ndimage import map_coordinates

import common

GEOM = common.OUT_DIR / "style-geometry.json"
MARGIN = 3  # px from the seam / outline for the tab grey


def load_geometry():
    g = json.loads(GEOM.read_text())
    return g["pxPerR"], g["kEdge"], g["seamLength"], g["pieces"]


def masks(pieces, shape, k):
    """Tab interior mask eroded >= MARGIN px from seam and cut path, at scale k (1 low, 2 high)."""
    h, w = shape
    tab = np.zeros((h, w), np.uint8)
    for p in pieces:
        for t in p["tabs"]:
            cv2.fillPoly(tab, [np.round(np.array(t) * k * 16).astype(np.int32).reshape(-1, 1, 2)], 255, lineType=cv2.LINE_AA, shift=4)
    near = np.zeros((h, w), np.uint8)
    for p in pieces:
        for line, closed in ((p["pos"], False), (p["neg"], False), (p["cutPath"], True)):
            cv2.polylines(near, [np.round(np.array(line) * k).astype(np.int32).reshape(-1, 1, 2)], closed, 255, 1)
    dist = cv2.distanceTransform(255 - near, cv2.DIST_L2, 3)
    return (tab > 250) & (dist >= MARGIN * k), tab > 127


def tab_grey(img, pieces, k):
    inside, _ = masks(pieces, img.shape[:2], k)
    px = img[inside][:, ::-1]  # BGR -> RGB
    return [float(v) for v in np.median(px, axis=0)], int(inside.sum())


def lum(img):
    return img.astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32)


def outline_width(img, pieces):
    """Sub-pixel dark-run width (px) across the cut path, median over samples."""
    L = lum(img)
    widths = []
    ts = np.arange(-9, 9.001, 0.1)
    for p in pieces:
        path = np.array(p["cutPath"])
        # resample every 3 px
        seg = np.hypot(*np.diff(np.vstack([path, path[:1]]), axis=0).T)
        cum = np.concatenate([[0], np.cumsum(seg)])
        full = np.vstack([path, path[:1]])
        for s in np.arange(1.5, cum[-1], 3.0):
            i = np.searchsorted(cum, s, side="right") - 1
            a, b = full[i], full[i + 1]
            f = (s - cum[i]) / max(seg[i], 1e-9)
            c = a + (b - a) * f
            t = (b - a) / max(seg[i], 1e-9)
            # skip short segments and samples within 6 px of a vertex (corners distort the normal profile)
            if seg[i] < 12 or min(s - cum[i], cum[i + 1] - s) < 6:
                continue
            n = np.array([-t[1], t[0]])
            xs = c[0] + n[0] * ts
            ys = c[1] + n[1] * ts
            prof = map_coordinates(L, [ys - 0.5, xs - 0.5], order=1, mode="nearest")
            core = np.abs(ts) <= 4
            j = np.argmin(np.where(core, prof, 1e9))
            m = prof[j]
            if m > 50:
                continue
            bg_l = np.median(prof[:15])
            bg_r = np.median(prof[-15:])
            if min(bg_l, bg_r) - m < 60:
                continue
            thr_l, thr_r = (m + bg_l) / 2, (m + bg_r) / 2
            a_i = j
            while a_i > 0 and prof[a_i] < thr_l:
                a_i -= 1
            b_i = j
            while b_i < len(prof) - 1 and prof[b_i] < thr_r:
                b_i += 1
            if a_i == 0 or b_i == len(prof) - 1:
                continue
            xl = ts[a_i] + (thr_l - prof[a_i]) / (prof[a_i + 1] - prof[a_i]) * 0.1
            xr = ts[b_i - 1] + (thr_r - prof[b_i - 1]) / (prof[b_i] - prof[b_i - 1]) * 0.1
            widths.append(xr - xl)
    return float(np.median(widths)), len(widths), float(np.percentile(widths, 10)), float(np.percentile(widths, 90))


def bleed_width(img, pieces, grey, seam_len, k):
    """Distances (px of this image) from the seam to where content gives way to tab grey."""
    h, w = img.shape[:2]
    _, tab = masks(pieces, (h, w), k)
    rgb = img[:, :, ::-1].astype(np.float32)
    isgrey = np.abs(rgb - np.array(grey, np.float32)).max(axis=2) <= 8
    ds = np.arange(0.0, 40.0, 0.25) * k
    out = []
    for p in pieces:
        edge = np.round(np.array(p["edge"]) * k * 16).astype(np.int32).reshape(-1, 1, 2)
        for side in ("pos", "neg"):
            pts = np.array(p[side]) * k
            for i in range(25, len(pts) - 25, 12):
                sigma = i * 0.002
                if sigma < 0.5 or sigma > seam_len - 0.5:
                    continue
                t = pts[i + 3] - pts[i - 3]
                t /= np.hypot(*t)
                n = np.array([-t[1], t[0]])
                # outward = out of the piece edge polygon
                test = pts[i] + n * 2 * k
                inside = cv2.pointPolygonTest(edge.astype(np.float32) / 16, (float(test[0]), float(test[1])), False) >= 0
                if inside:
                    n = -n
                xs = pts[i, 0] + n[0] * ds
                ys = pts[i, 1] + n[1] * ds
                xi = np.clip(np.round(xs - 0.5).astype(int), 0, w - 1)
                yi = np.clip(np.round(ys - 0.5).astype(int), 0, h - 1)
                g = isgrey[yi, xi]
                # content ends at the first grey run of >= 4 px, within the tab
                run = np.convolve(g.astype(int), np.ones(int(4 * k)), "valid") == int(4 * k)
                if not run.any() or not tab[yi[: np.argmax(run) + int(4 * k)], xi[: np.argmax(run) + int(4 * k)]].all():
                    continue
                out.append(ds[np.argmax(run)])  # sheet px of this image
    return out


def main():
    pxPerR, kEdge, seam_len, pieces = load_geometry()
    manifest = common.load_manifest()
    refs = {f["id"]: f for f in manifest["styleOnly"] + manifest["fixtures"]}
    imgs = {i: common.read_image(refs[i]["reference"]) for i in ("site-low-outline", "site-high-bleed", "alaska")}
    res = {"pxPerR": pxPerR, "kEdge": kEdge, "tabGrey": {}, "bleedPx": {}}
    for i, k in (("site-low-outline", 1), ("site-high-bleed", 2), ("alaska", 2)):
        g, n = tab_grey(imgs[i], pieces, k)
        res["tabGrey"][i] = {"rgb": g, "pixels": n}
        print(f"tab grey {i}: {g} ({n} px)")
    greys = [v["rgb"] for v in res["tabGrey"].values()]
    grey = [float(v) for v in np.median(greys, axis=0)]
    res["tabColor"] = [int(round(v)) for v in grey]
    print("tab grey (median of the three):", res["tabColor"])

    w, n, p10, p90 = outline_width(imgs["site-low-outline"], pieces)
    res["outlineWidthPx"] = w
    res["outlineWidthR"] = w / pxPerR
    print(f"outline width: {w:.3f} px at low res over {n} samples (p10 {p10:.2f}, p90 {p90:.2f}) = {w / pxPerR:.5f} R")

    allb = []
    for i in ("site-high-bleed", "alaska"):
        b = bleed_width(imgs[i], pieces, grey, seam_len, 2)
        med = float(np.median(b))
        res["bleedPx"][i] = {"highResPx": med, "lowResPx": med / 2, "samples": len(b), "p10": float(np.percentile(b, 10)), "p90": float(np.percentile(b, 90))}
        print(f"bleed {i}: median {med:.2f} high-res px ({med / 2:.2f} low-res px) over {len(b)} samples (p10 {np.percentile(b, 10):.2f}, p90 {np.percentile(b, 90):.2f})")
        allb += [v / 2 for v in b]
    flat_low = float(np.median(allb))
    res["bleedFlatLowPx"] = flat_low
    res["bleedFlatR"] = flat_low / pxPerR
    res["bleedR"] = flat_low / pxPerR / kEdge
    print(f"bleed: {flat_low:.3f} low-res px flat = {res['bleedFlatR']:.5f} R flat = {res['bleedR']:.5f} R on the sphere (kEdge {kEdge:.4f})")
    (common.OUT_DIR / "style.json").write_text(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
