# The 360craft warp model

We reproduce 360craft's warp with a model fitted to its reference outputs. The model has four
parts: a Clelia spiral, closest-point coordinates on the band's centre line, central projection
onto the tangent developable along that line, and a fixed base orientation. Its values live in
`src/model/360craft.js` (`MODEL_360CRAFT`). They were measured by `tools/research/fit-model.mjs`
against three reference outputs (alaska, 2018-09-a, 2018-09-b) and 360craft's recovered
`outline.dxf`. The images and the DXF stay local, as ADR-0002 requires: only numbers are committed.

## The formula

**Spiral and bands.**
- The centre line of band 0 is the Clelia curve λ = rate·θ (θ is the polar angle from +z, λ is
  the longitude), running from pole to pole.
- A point belongs to band 0 when its phase, `bandPhase` = λ(p) − rate·θ(p) wrapped to (−π, π],
  satisfies |phase| < π/2.
- Band 1 is band 0 rotated by π about z.
- The seams are the phase = ±π/2 curves.

**Strip and tip cells (closest-point coordinates).** Each sphere point is described by its
nearest point on the centre line C.
- If the nearest point is an interior foot, the point is a strip cell. Its coordinates (s, d)
  satisfy p = cos d·C(s) + sin d·N(s), where N = C × T.
- If the point lies behind one end of C and is nearer to that tip than to any foot, it is a tip
  cell. Its coordinates are polar about the tip: (ρ, α), with α measured from T toward N.

**Laying flat.**
- C is laid flat as the plane curve c(s) whose curvature is the geodesic curvature kg(s), with
  frame (t, n).
- A strip cell goes to c(s) + tan d·n(s).
- A tip cell goes to c(tip) + tan ρ·(cos α·t + sin α·n) + δ.

This is the band projected centrally, from the sphere's centre, onto the tangent developable
along C. That surface is the envelope of the tangent planes along C. Its rulings run along N, and
it lies flat onto (c, n) exactly. Behind each tip the projection is gnomonic onto the tip's
tangent plane.

**The join correction δ.** Near a tip, kg reaches about 12. There the tip cell and the next
winding of the strip ("the arm") meet on a medial axis, and their two charts disagree slightly
along it. δ moves the tip chart onto the arm chart along that axis, so the outline has no notch.
It vanishes on the tip's normal rays and fades out past the bleed. The flat→strip map is the
exact inverse of this forward map.

**Sheet placement.**
- Each piece is the flat band, placed on the sheet by `pieceAffine(piece, pxPerR)`: Y is
  reflected (flat is y-up, the sheet is y-down), then rotated by angleDeg, scaled by pxPerR and
  translated so that the north tip lands at (x, y).
- A sheet pixel's panorama direction is M_user·M_base·Rz(band·π)·p, where p is the band-0 point
  found by flatToStrip followed by stripToSphere.

## Parameters and how they were measured

The fit minimises the sum of two terms, both Huber-scored with δ = 2 px:
- **Correspondence term.** For each SIFT match (`correspond.py`) between the panorama and the
  low-res sheet, the angle between the matched direction and the model's direction for that
  sheet point, × pxPerR.
- **DXF term.** The distance from the vertices of `outline.dxf` to the model's seams, trimmed to
  the closest 70% so the tab vertices are dropped.

Nelder–Mead runs over all eleven parameters at once. It is initialised by:
1. a bbox grid search for each piece's angle;
2. a fit of the layout to the DXF alone;
3. a closed-form least-squares rotation for the base orientation, tried for every piece→band
   assignment and half-turn of each piece.

| Parameter | Value | Determined by |
|---|---|---|
| spiral | clelia, rate 6.00528 | correspondences and DXF (band count, length) |
| baseOrientation | yaw 89.529°, pitch −0.006°, roll 0.017° | correspondences |
| pxPerR | 492.429 px per R (low res) | both terms |
| pieces[0] (left, DXF MyLines1) | band 1, north tip at (882.90, 563.92) px, 118.104° | DXF and correspondences |
| pieces[1] (right, MyLines2) | band 0, north tip at (2132.96, 563.85) px, 118.109° | DXF and correspondences |

**Exact ties.** Swapping both pieces' bands is the same model as M_base·Rz(π). Turning both
pieces by half a turn is a symmetry of the sphere. These choices therefore tie exactly, and the
fit keeps the candidate with the smaller base rotation. Turning only one piece costs about 2,700
times more, so the relative half-turn is unambiguous.

**Handedness.** The least-squares rotation has a positive determinant, so the reflection in
pieceAffine is the right handedness. The brief's escape hatch (dropping the reflection) was not
needed.

**Rate.** The fitted rate is within 0.1% of 6. develop.js's arm-to-arm search thresholds were
measured at rate 6 (|d| > 0.32 within 2.5 R of a tip), so they hold for it.

**Fit cost.** Inside the optimiser the fit uses 4,000 sampled matches and a 0.01 R seam step, with
the unrolling cached per rate. The reported numbers use all 18,888 deduplicated matches and the
default 0.002 R step.

## Family: Clelia only

The probe could not separate the two candidate families: Clelia c ≈ 6.0 scored 95.8% and
loxodrome k ≈ 5.6 scored 95.6%. The maintainer chose Clelia for the rest of the project
(ruling R9), so the loxodrome was not fitted. The loxodrome code in `src/sphere/` stays general,
but is unused by the model.

## Residuals

All figures are in low-res px. "Seam vertices" are DXF vertices within 2 px of a model seam.
"Tip region" means within 1 R of seam arc length from a tip.

| Unrolling | corr. median / p90 | seam mean / p95 / max | seam body mean | seam tip mean |
|---|---|---|---|---|
| strip at flat offset d (first fit, rejected) | 0.83 / 1.98 | 0.82 / – / 2.00 | 1.53 | 0.51 |
| **strip at tan d (this model)** | **0.31 / 0.69** | **0.55 / 1.39 / 2.00** | 0.47 | 0.68 |
| same, outline resampled every 1 px | – | 0.55 / 1.72 / 2.00 | 0.50 | 0.84 |

The seam columns are over raw DXF vertices, the measure the plan and R16 name. That measure is
biased low: about 100 DXF vertices pile up within 1 px of each tip point and fit well, while
straight edges carry few vertices. The resampled row weights the outline by length instead.

**Why tan d.** The first fit laid strip points at c(s) + d·n(s). Its residuals showed two things:
- 360craft's outline is 5.7 px wider than that model, constantly along the body.
- Its image content is pushed outward by ≈ d³/3, which is the series of tan d − d.

Projecting onto the tangent developable removes both (ruling R15).

**Per fixture.** The correspondence medians are 0.31 px (alaska), 0.30 px (2018-09-a) and
0.36 px (2018-09-b), with one base orientation for all three.

**Skipped matches.** 174 matches are skipped because flatToStrip found no consistent preimage,
and 288 because they lie outside both pieces (bleed and tabs).

**The tips are checked by the DXF only.** Only 27 matches fall within 1 R of a tip, and none fall
in a tip cell.

## Acceptance criterion used

The plan's targets were: correspondence median ≤ 1.0 px, seam mean ≤ 0.5 px and seam max ≤ 1.5 px.
The model misses the two seam targets: mean 0.55 px and max 2.00 px.

The reason is one remaining systematic difference, which one bounded investigation round
(ruling R16) did not explain:
- **Where:** on the convex side of the curl, between 0.3 and 1.8 R of arc length from each tip,
  360craft's edge lies outside ours. The gap grows to 2.2 px about 1 R from the tip and then
  closes again at the tip.
- **Where it is not:** it lies in strip cells, not in tip cells or the δ join. A normal-ray edge
  rule gives the same seam there.
- **Symmetry:** it is point-symmetric between the two ends and the same in both pieces.
- **The image agrees:** the content near the south end is offset by about 2 px in the same
  direction (few matches there).
- **Cause:** it looks like a small difference in how 360craft lays the strongly curved part of
  the centre line flat. It was not identified.

The model is accepted under ruling R16's fallback, applied to the same seam vertices:
- correspondence median ≤ 1.0 px (0.31);
- seam mean ≤ 0.75 px (0.55);
- seam p95 ≤ 1.5 px (1.39).

**Caveat (ruling R19).** The p95 is measured on raw DXF vertices, as the plan and R16 specify.
That statistic is flattered by the ~100 vertices piled at each tip. On the outline resampled
every 1 px the seam p95 is 1.72 px, which would fail 1.5. For scale, the largest residual,
≤ 2.2 px on the low sheet at about 492 px per R, is ≈ 0.0045 R: about 0.2 mm on a sphere of
10 cm diameter.

`test/regression/model-fit.test.js` checks these thresholds, together with the plan's alaska
reprojection test (median ≤ 1.0 px, p90 ≤ 2.5 px). Cost if this is wrong: up to about 2 px of
edge error on prints, near the tip curls.

## Tabs

(T7 appends.)

## Style

(T10 appends.)
