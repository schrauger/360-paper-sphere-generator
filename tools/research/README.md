# Research tools (Python and Node, dev only)

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
- `fit-model.mjs` (Node, after correspond.py): fits the warp model (Clelia rate, base orientation, pxPerR, piece layout) to the matches and `outline.dxf` with `lib/nelder-mead.mjs`. Writes `fit-report.json`.

## Tolerances

`test/regression/tolerances.json` values for cropped fixtures (2018-09-a, 2018-09-b) are measured on the reference warped into canonical high-res coordinates with bilinear resampling via `<id>.align.json`. That smooths the image and biases the MAEs low compared with alaska (uncropped, native pixels). Consumers must compare against the reference resampled the same way; otherwise the thresholds are too strict.

## Probe filter

A match is kept only if at least `MIN_NEIGHBOURS = 3` other matches lie within 40 px on the sheet and its direction is within 0.06 rad of the median neighbour direction. Matches with fewer neighbours are dropped. This is our interpretation of the probe filter.
