# Paper Sphere

Turning a 360° photo into a printable sheet of two S-shaped pieces that are cut out and glued into a sphere.

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
The printable page carrying both pieces and any registration marks.
_Avoid_: output, canvas, page image

**Tab**:
A grey flap along a piece's edge that is glued under the other piece during assembly.
_Avoid_: flap, glue tab, tooth

**Cut path**:
The closed boundary of a piece including its tabs, which is what gets cut.
_Avoid_: outline (when meaning the geometry), cut line, contour

**Outline**:
An optional printed line drawn along the cut path to guide hand cutting.
_Avoid_: border, stroke

**Bleed**:
Panorama content printed a short distance beyond a piece's edge, under the tabs, so small cutting or gluing errors don't show white.
_Avoid_: overprint, overbleed

**Registration marks**:
The marks a cutting machine's optical sensor uses to line up its cuts with a printed sheet: a solid square top-left and L-shaped corners top-right and bottom-left.
_Avoid_: cutting markers, corner markers, crop marks

## Reference

**360craft**:
The original, now defunct website (360craft.pythonanywhere.com, by Takayuki Sasaki) whose output this project reproduces.
_Avoid_: the old site, original app

**Reference output**:
A sheet produced by 360craft, used as ground truth in regression tests.
_Avoid_: expected image, golden file
