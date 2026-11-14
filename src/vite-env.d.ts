/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Folder or URL with the backend export (cells.json, meta.json, oblast.geojson, districts.geojson). Unset = sample data. */
  readonly VITE_API_URL?: string;
  readonly VITE_CARTO_KEY?: string;
}
