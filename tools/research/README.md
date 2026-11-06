# Research tools (Python, dev only)

Extract reference data from the local-only 360craft outputs (`photo examples/`, see ADR-0002). Not part of the shipped tool.
All outputs go to `test-output/research/` (gitignored); only `test/regression/tolerances.json` (numbers) is committed.

Run from the repo root, in this order:

    uv run --with-requirements tools/research/requirements.txt python tools/research/align.py
    uv run --with-requirements tools/research/requirements.txt python tools/research/correspond.py --fixture <id>
    uv run --with-requirements tools/research/requirements.txt python tools/research/tolerances.py

- `common.py`: manifest loading, DXF LINE reader (same rules as `test/support/dxf.js`), canonical ink-mask rasteriser.
- `align.py`: for `cropped: true` fixtures, fits uniform scale + translation (reference px to canonical high-res sheet px) of the fixture `mask` image to the DXF mask. Writes `<id>.align.json`.
- `correspond.py`: SIFT + FLANN (ratio 0.7) between the panorama (3456x1728) and the low-res sheet, with the 40 px / 0.06 rad neighbourhood probe filter. Writes `<id>.matches.json` (`[x, y, lonRad, latRad]`, low-res sheet px).
- `tolerances.py`: per-fixture colour MAE (half-pixel shift, JPEG q90 re-encode) on the eroded ink interior. Writes `test/regression/tolerances.json`.
