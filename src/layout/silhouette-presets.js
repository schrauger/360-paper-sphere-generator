// Preset sphere sizes with a committed Silhouette Studio cut file (studio3/). A preset is a named
// page + Silhouette marks + a whole-mm diameter; the layout is mm-exact at any DPI and bleed, so
// one .studio3 per preset matches every render.

/** Page name → preset sphere diameters in mm. 62 is the largest whole mm that fits Letter with marks (max 62.71). */
export const SILHOUETTE_PRESETS = { letter: [40, 45, 50, 55, 60, 62] };

/** Repo-relative path of the cut file for a preset. */
export const studio3Path = (pageName, diameterMm) => `studio3/${pageName}-${diameterMm}mm.studio3`;

/** The fixed diameters (mm) offered in the web app: every preset size on any page, ascending. */
export const DIAMETER_CHOICES_MM = [...new Set(Object.values(SILHOUETTE_PRESETS).flat())].sort((a, b) => a - b);

/**
 * Why a sheet cannot use a Silhouette cut file: a list of the fields at fault, any of 'page' (no
 * presets for this page), 'diameter' (not a preset size for this page; Largest is null, and a
 * custom number counts only when it equals a preset size), 'copies' (not 'max') and 'marks' (not
 * 'silhouette'). Empty when a committed-size cut file applies.
 */
export function studio3Problems({ pageName, diameterMm, copies, marks }) {
  const sizes = SILHOUETTE_PRESETS[pageName];
  const problems = [];
  if (!sizes) problems.push('page');
  if (!sizes || !sizes.includes(diameterMm)) problems.push('diameter');
  if (copies !== 'max') problems.push('copies');
  if (marks !== 'silhouette') problems.push('marks');
  return problems;
}
