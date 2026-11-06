# Paper Sphere

Turning a 360° photo into a printable sheet of two S-shaped pieces that are cut out and joined into a sphere.

## Input

**Panorama**:
A full 360°×180° photo in equirectangular projection, with a 2:1 width-to-height ratio.
_Avoid_: 360 photo, equirect, image, photosphere

**Orientation**:
The rotation of the panorama relative to the bands, given as yaw, pitch and roll. Zero orientation reproduces 360craft's layout.
_Avoid_: shift, pan, offset, position

## Sphere geometry

**Band**:
One of the two congruent spiral-shaped regions that together cover the sphere exactly, each running from one pole to the other.
_Avoid_: strip, peel, gore

**Centre line**:
The spiral curve on the sphere running down the middle of a band.
_Avoid_: spine, axis, path

**Seam**:
The curve on the assembled sphere where the edges of the two bands meet.
_Avoid_: join, edge

**Unrolling**:
The geometric mapping that lays a band flat onto paper as a piece, preserving lengths as closely as possible.
_Avoid_: development, flattening, projection

**Warp**:
The whole image transformation from panorama to sheet: orientation, then band, then unrolling.
_Avoid_: remap, distortion

## Printed output

**Piece**:
One flat S-shaped cut-out: an unrolled band plus its tabs.
_Avoid_: S, strip, part, half

**Sheet**:
The printable page carrying the pieces of one or more spheres and any registration marks.
_Avoid_: output, canvas, page image

**Copies**:
The number of spheres (pairs of pieces) on one sheet. With a chosen diameter the default is as many as fit in a grid (at most 60), laid out on a grid whose neighbouring cut paths stay 3 mm apart (a pair may be turned 90° and nest); the largest-that-fits diameter is always one pair.
_Avoid_: repeats, duplicates, count

**Tab**:
A grey flap along a piece's edge that tucks under the other piece during assembly (glued, taped, or held by friction).
_Avoid_: flap, glue tab, tooth

**Cut path**:
The closed boundary of a piece including its tabs, which is what gets cut.
_Avoid_: outline (when meaning the geometry), cut line, contour

**Tie**:
A tiny uncut gap in the cut path, centred on a tab's tip (0.5 mm by default), that keeps the piece attached to the sheet until it is punched out. Optional, in the cut files only.
_Avoid_: bridge, tab (a tab is the glue flap itself)

**Outline**:
An optional printed line drawn along the cut path to guide hand cutting.
_Avoid_: border, stroke

**Bleed**:
Panorama content printed a short distance beyond a piece's edge, under the tabs, so small cutting or gluing errors don't show white.
_Avoid_: overprint, overbleed

**Registration marks**:
The marks a cutting machine's optical sensor uses to line up its cuts with a printed sheet: a solid square top-left and L-shaped corners top-right and bottom-left. They match Silhouette Studio's Type 1 marks at a 10 mm inset, and the sheet's margin is 10 mm when they are on.
_Avoid_: cutting markers, corner markers, crop marks

**Preset size**:
A Letter sheet with Silhouette marks, "as many as fit" spheres and a whole-mm sphere diameter (40, 45, 50, 55, 60 or 62 mm, the fixed sizes in the web app's diameter list) that gets a Silhouette Studio cut file from `studio3/`; the files are added size by size as they are made (none exist yet). The cut lines sit at the same mm positions at any DPI and bleed, so one file fits every render. Not the same as a 360craft preset, which fixes the whole sheet.
_Avoid_: size preset, Silhouette preset

## Reference

**360craft**:
The original, now defunct website (360craft.pythonanywhere.com, by Takayuki Sasaki) whose output this project reproduces.
_Avoid_: the old site, original app

**Reference output**:
A sheet produced by 360craft, used as ground truth in regression tests.
_Avoid_: expected image, golden file
