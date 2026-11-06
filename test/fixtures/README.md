# Test fixtures

Two shareable equirectangular panoramas for the golden tests (`test/golden.test.js`). Both were
downscaled to 2048×1024 and re-encoded as JPEG (quality 90). No credit is burned into them: they
are golden inputs. `expected/` holds the committed renders; regenerate with
`node tools/update-golden.mjs`.

| File | Title | Source | Credit | License |
|---|---|---|---|---|
| `blue-marble.jpg` | Blue Marble 2002 (3840 px thumbnail of the 43200 px original) | https://en.wikipedia.org/wiki/File:Blue_Marble_2002.png | NASA (Terra/MODIS), combined by Wikimedia user Meow | Public domain |
| `pxhere-461435.jpg` | Forest and fence, equirectangular panorama (PxHere photo 461435) | https://pxhere.com/en/photo/461435 | "CC0-Photographers" (as listed on PxHere) | CC0 1.0 |
