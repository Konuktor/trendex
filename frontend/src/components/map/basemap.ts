/**
 * Basemap tiles. CLAUDE.md asks for CARTO Positron (no labels) + CARTO labels.
 * Since 2026 CARTO serves a watermark ("API KEY REQUIRED") without a key, so:
 *  - with VITE_CARTO_KEY set, CARTO tiles are used with `?key=`;
 *  - without it, Esri's keyless World Light Gray Canvas (base + reference labels) is used.
 * Both are drawn in grayscale.
 */
const key = (import.meta.env.VITE_CARTO_KEY as string | undefined)?.trim();

export interface Basemap {
  base: string;
  labels: string;
  subdomains?: string;
  attribution: string;
}

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const GB = '<a href="https://www.geoboundaries.org">geoBoundaries</a>';

export const BASEMAP: Basemap = key
  ? {
      base: `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
      labels: `https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
      subdomains: 'abcd',
      attribution: `${OSM}, © <a href="https://carto.com/attributions">CARTO</a>, Esri, ${GB}`,
    }
  : {
      base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      attribution: `${OSM}, Esri, HERE, Garmin, ${GB}`,
    };

export const HILLSHADE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
