// Preset sphere sizes with a committed Silhouette Studio cut file (studio3/). A preset is a named
// page + Silhouette marks + a whole-mm diameter; the layout is mm-exact at any DPI and bleed, so
// one .studio3 per preset matches every render.

/** Page name → preset sphere diameters in mm. 62 is the largest whole mm that fits Letter with marks (max 62.71). */
export const SILHOUETTE_PRESETS = { letter: [40, 45, 50, 55, 60, 62] };

/** Repo-relative path of the cut file for a preset. */
export const studio3Path = (pageName, diameterMm) => `studio3/${pageName}-${diameterMm}mm.studio3`;
