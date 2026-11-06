"""SIFT correspondences between a panorama and the (aligned) reference sheet.

Usage: correspond.py --fixture <id>
Writes test-output/research/<id>.matches.json = {sheet: "low", points: [[x, y, lonRad, latRad], ...]}
x/y are low-res canonical sheet px (y down); lon/lat come from the panorama keypoint.
"""
import argparse
import json
import math

import cv2
import numpy as np
from scipy.spatial import cKDTree

import common

PANO_SIZE = (3456, 1728)
RATIO = 0.7
PROBE_RADIUS_PX = 40
PROBE_MAX_RAD = 0.06
MIN_NEIGHBOURS = 3


def sheet_low(fixture):
    """Reference as a canonical low-res sheet (2850x4160) BGR image."""
    ref_high, _ = common.aligned_reference_high(fixture)
    return cv2.resize(ref_high, common.LOW_SIZE, interpolation=cv2.INTER_AREA)


def sift_features(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.SIFT_create(nfeatures=40000).detectAndCompute(gray, None)


def to_vec(lon, lat):
    c = np.cos(lat)
    return np.stack([c * np.cos(lon), c * np.sin(lon), np.sin(lat)], axis=1)


def probe_filter(xy, lonlat):
    """Keep matches whose direction agrees (<= 0.06 rad) with the median of neighbours within 40 px."""
    tree = cKDTree(xy)
    vec = to_vec(lonlat[:, 0], lonlat[:, 1])
    keep = np.zeros(len(xy), bool)
    for i, nbrs in enumerate(tree.query_ball_point(xy, PROBE_RADIUS_PX)):
        nbrs = [j for j in nbrs if j != i]
        if len(nbrs) < MIN_NEIGHBOURS:
            continue
        med = np.median(vec[nbrs], axis=0)
        n = np.linalg.norm(med)
        if n == 0:
            continue
        cos = np.clip(vec[i] @ (med / n), -1, 1)
        keep[i] = math.acos(cos) <= PROBE_MAX_RAD
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    fid = ap.parse_args().fixture
    manifest = common.load_manifest()
    fixture = common.fixture_by_id(manifest, fid)
    if fixture.get("cropped") and not common.align_path(fid).exists():
        raise SystemExit("run align.py first")

    pano = cv2.resize(common.read_image(fixture["panorama"]), PANO_SIZE, interpolation=cv2.INTER_AREA)
    sheet = sheet_low(fixture)
    kp_p, des_p = sift_features(pano)
    kp_s, des_s = sift_features(sheet)
    print(f"{fid}: {len(kp_p)} pano features, {len(kp_s)} sheet features")

    flann = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=64))
    good = [m[0] for m in flann.knnMatch(des_s, des_p, k=2)
            if len(m) == 2 and m[0].distance < RATIO * m[1].distance]
    print(f"{len(good)} ratio-test matches")

    xy = np.array([kp_s[m.queryIdx].pt for m in good], np.float64)
    pp = np.array([kp_p[m.trainIdx].pt for m in good], np.float64)
    W, H = PANO_SIZE
    # SIFT keypoint coordinates are pixel-centre based (centre of pixel i is i), so +0.5 for edge coordinates.
    pp += 0.5
    xy += 0.5
    lonlat = np.stack([pp[:, 0] / W * 2 * np.pi - np.pi, np.pi / 2 - pp[:, 1] / H * np.pi], axis=1)

    keep = probe_filter(xy, lonlat)
    print(f"{int(keep.sum())} points after probe filter")
    pts = [[float(x), float(y), float(lo), float(la)] for (x, y), (lo, la) in zip(xy[keep], lonlat[keep])]
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    (common.OUT_DIR / f"{fid}.matches.json").write_text(json.dumps({"sheet": "low", "points": pts}))
    print(f"{fid}: wrote {len(pts)} points")


if __name__ == "__main__":
    main()
