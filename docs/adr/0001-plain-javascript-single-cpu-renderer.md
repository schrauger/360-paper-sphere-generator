# Plain JavaScript core with one CPU renderer for preview and print

The warp, geometry and layout code is plain JavaScript (ES modules, no build step), shared by a static web page on GitHub Pages and a Node CLI, so the tool is free to host and panoramas never leave the user's computer. The live previews (panorama with seams, sheet, globe) and the final print all use the same per-pixel CPU code, run in a web worker. Previews just render at lower resolution, so the preview cannot disagree with the print.

## Considered Options

- **Python core + Pyodide in the browser**: clear numpy code, but a ~15 MB first load and slower interaction.
- **Python core + Flask server**: simplest Python, but needs a paid or self-run host, and uploads personal photos.
- **WebGL shader for previews**: fastest, but it would be a second implementation of the warp that could drift from the print renderer. Add it later only if the CPU preview is measurably too slow (target < 50 ms per ~600×900 frame).

## Consequences

Python stays available as a dev-only tool (`tools/research/`) for reverse-engineering 360craft from reference outputs. It is never a runtime dependency. The CLI uses `sharp` for image input and output. The core only ever sees RGBA buffers.
