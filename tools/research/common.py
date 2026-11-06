"""Shared helpers for the research scripts: manifest, DXF outline, canonical masks."""
import json
import os
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[2]
MANIFEST_DIR = REPO / "photo examples"
OUT_DIR = REPO / "test-output" / "research"
LOW_SIZE = (2850, 4160)  # width, height at low res; high res is exactly 2x
TOL = 1e-6


def load_manifest(directory=MANIFEST_DIR):
    """Return {dxfPath, fixtures, styleOnly} with absolute paths."""
    root = Path(directory)
    raw = json.loads((root / "manifest.json").read_text())

    def fix(f):
        out = dict(f)
        out["reference"] = str(root / f["reference"])
        for k in ("panorama", "mask"):
            if k in f:
                out[k] = str(root / f[k])
        return out

    return {
        "dxfPath": str(root / raw["dxf"]),
        "fixtures": [fix(f) for f in raw.get("fixtures", [])],
        "styleOnly": [fix(f) for f in raw.get("styleOnly", [])],
    }


def read_dxf_lines(path):
    """LINE entities in the ENTITIES section: [(layer, x1, y1, x2, y2)], raw y-up."""
    rows = Path(path).read_text(errors="replace").splitlines()
    lines, in_entities, cur = [], False, None

    def flush():
        nonlocal cur
        if cur and cur["layer"] is not None and all(
            cur[k] is not None for k in ("x1", "y1", "x2", "y2")
        ):
            lines.append((cur["layer"], cur["x1"], cur["y1"], cur["x2"], cur["y2"]))
        cur = None

    keys = {10: "x1", 20: "y1", 11: "x2", 21: "y2"}
    for i in range(0, len(rows) - 1, 2):
        try:
            code = int(rows[i].strip())
        except ValueError:
            continue
        value = rows[i + 1].strip()
        if code == 0:
            flush()
            if value == "SECTION":
                continue
            if value == "ENDSEC":
                in_entities = False
                continue
            if in_entities and value == "LINE":
                cur = {"layer": None, "x1": None, "y1": None, "x2": None, "y2": None}
            continue
        if code == 2 and cur is None:
            in_entities = value == "ENTITIES"
            continue
        if cur is None:
            continue
        if code == 8:
            cur["layer"] = value
        elif code in keys:
            cur[keys[code]] = float(value)
    flush()
    return lines


def _near(a, b):
    return abs(a[0] - b[0]) <= TOL and abs(a[1] - b[1]) <= TOL


def dxf_to_polylines(lines, sheet_height):
    """Chain segments end-to-end per layer; flip y to sheet_height - y. {layer: [ndarray Nx2]}."""
    by_layer = {}
    for layer, x1, y1, x2, y2 in lines:
        a, b = (x1, y1), (x2, y2)
        if _near(a, b):
            continue
        by_layer.setdefault(layer, []).append((a, b))
    out = {}
    for layer, segs in by_layer.items():
        key = lambda p: (round(p[0] / TOL), round(p[1] / TOL))
        index = {}
        for i, s in enumerate(segs):
            for e, p in enumerate(s):
                index.setdefault(key(p), []).append((i, e))
        used = [False] * len(segs)

        def find(p):
            cx, cy = key(p)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for i, e in index.get((cx + dx, cy + dy), []):
                        if not used[i] and _near(segs[i][e], p):
                            return i, e
            return None

        polys = []
        for s in range(len(segs)):
            if used[s]:
                continue
            used[s] = True
            pts = [segs[s][0], segs[s][1]]
            while True:
                hit = find(pts[-1])
                if not hit:
                    break
                used[hit[0]] = True
                pts.append(segs[hit[0]][1 - hit[1]])
            if len(pts) > 2 and _near(pts[0], pts[-1]):
                pts.pop()
            polys.append(np.array([(x, sheet_height - y) for x, y in pts]))
        out[layer] = polys
    return out


def canonical_polylines(manifest=None):
    manifest = manifest or load_manifest()
    lines = read_dxf_lines(manifest["dxfPath"])
    return dxf_to_polylines(lines, LOW_SIZE[1])  # low-res sheet px, y down


def canonical_mask(scale="low", manifest=None):
    """uint8 mask (255 = ink: pieces + tabs filled) at 'low' (1x) or 'high' (2x)."""
    k = 1 if scale == "low" else 2
    polys = canonical_polylines(manifest)
    mask = np.zeros((LOW_SIZE[1] * k, LOW_SIZE[0] * k), np.uint8)
    for plist in polys.values():
        for p in plist:
            pts = np.round(p * k).astype(np.int32).reshape(-1, 1, 2)
            cv2.fillPoly(mask, [pts], 255)
    return mask


def fixture_by_id(manifest, fid):
    for f in manifest["fixtures"]:
        if f["id"] == fid:
            return f
    raise SystemExit(f"unknown fixture {fid}")


def align_path(fid):
    return OUT_DIR / f"{fid}.align.json"


def load_align(fid):
    return json.loads(align_path(fid).read_text())


def read_image(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"cannot read {path}")
    return img


def aligned_reference_high(fixture):
    """Reference as a canonical high-res (5700x8320) BGR image plus validity mask.

    Uncropped fixtures are used as-is; cropped ones are warped with align.json.
    """
    ref = read_image(fixture["reference"])
    w, h = LOW_SIZE[0] * 2, LOW_SIZE[1] * 2
    if not fixture.get("cropped"):
        if ref.shape[:2] != (h, w):
            raise SystemExit(f"{fixture['id']}: expected {w}x{h} reference, got {ref.shape}")
        return ref, np.full((h, w), 255, np.uint8)
    a = load_align(fixture["id"])
    M = np.array([[a["scale"], 0, a["tx"]], [0, a["scale"], a["ty"]]], np.float64)
    img = cv2.warpAffine(ref, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    valid = cv2.warpAffine(
        np.full(ref.shape[:2], 255, np.uint8), M, (w, h), flags=cv2.INTER_NEAREST
    )
    return img, valid
