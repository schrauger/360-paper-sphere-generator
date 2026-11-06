# Silhouette cut files

One Silhouette Studio cut file per preset sphere size, which the web app offers beside the sheet
download. Print the sheet with Silhouette marks at 100%, open the matching file, and cut.

Naming: `<page>-<diameter>mm.studio3`, for example `letter-50mm.studio3`. The sizes are listed in
`src/layout/silhouette-presets.js`; the layout places the cut lines identically in mm at any DPI
and bleed, so one file per size fits every render.

## Making a file

1. `node tools/silhouette-presets.mjs ./presets` writes `letter-<D>mm.svg` for every size
   (red cut lines, black registration marks).
2. In Silhouette Studio, set the page to Letter and import the SVG at the page origin (0, 0).
3. Turn on Type 1 registration marks at a 10 mm inset.
4. Delete the black mark shapes from the SVG, or set them to no cut.
5. Save as `studio3/<page>-<D>mm.studio3` and commit it.
