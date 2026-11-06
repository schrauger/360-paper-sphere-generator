# paper-sphere

Turns a 360° equirectangular panorama (2:1) into a printable two-piece paper-sphere sheet, reimplementing the behaviour of the defunct 360craft site. Output is a PNG or JPEG sheet, optionally with a cut outline as SVG or DXF.

## CLI

```sh
npm install
node cli.js <pano> -o out.png [options]
```

Key options:

- `--preset original-low|original-high`: 360craft's own sheet sizes.
- `--page letter|a4|a3|tabloid|<W>x<H>mm` and `--dpi N` (72–1200, default 300).
- `--bleed MM|auto|off` and `--marks silhouette` for printing.
- `--cut-file svg|dxf`: also write the cut path next to the output.

Run `node cli.js --help` for the full list.

## Web app

```sh
npm run serve
```

then open http://localhost:8080/web/ in a browser.

## Requirements

The package supports Node ≥ 20, but tests need Node ≥ 22 (`npm test` uses a glob that Node 20 cannot expand).
