import {
  chunkOf,
  decodePixel,
  emptyOutlineStats,
  isPxMeta,
  Lru,
  pixelRowCol,
  ringWindow,
  tallyChunk,
  windowChunks,
  type OutlineStats,
  type PixelInfo,
  type PxInfo,
  type PxRegions,
} from '../lib/px';
import { ringHas } from '../lib/geo';

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null; // missing file, or an HTML fallback page instead of JSON
  }
}

/** The dataset's 1 km layer, or null when its export has no px/ folder yet (the map then draws the 10/20 km zones). */
export async function loadPx(base: string): Promise<PxInfo | null> {
  const [meta, regions] = await Promise.all([json<unknown>(`${base}/px/meta.json`), json<PxRegions>(`${base}/px/regions.json`)]);
  if (!isPxMeta(meta)) return null;
  return { base, meta, regions: regions && regions.all ? regions : null };
}

/** Recently used chunks (~140 KB each; 64 ≈ 9 MB). A missing chunk is cached as null. */
const chunks = new Lru<string, Promise<ArrayBuffer | null>>(64);

function loadChunk(px: PxInfo, key: string): Promise<ArrayBuffer | null> {
  const url = `${px.base}/px/chunks/${key}.bin`;
  let p = chunks.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      // A static host may answer a missing file with its HTML page: only a full chunk counts.
      .then((b) => (b && b.byteLength === px.meta.chunkBytes ? b : null))
      .catch(() => {
        chunks.delete(url);
        return null;
      });
    chunks.set(url, p);
  }
  return p;
}

/** The 1 km pixel under a point; null outside the 1 km grid or the study area. */
export async function getPixel(px: PxInfo, lat: number, lon: number): Promise<PixelInfo | null> {
  const rc = pixelRowCol(px.meta.grid, lat, lon);
  if (!rc) return null;
  const { key, i } = chunkOf(rc.row, rc.col, px.meta.chunk);
  const buf = await loadChunk(px, key);
  if (!buf) return null;
  const p = decodePixel(buf, i, px.meta);
  return p.code === 0 ? null : p;
}

export const chunkCacheSize = () => chunks.size;

/** At most this many chunks are read for one outline (64 ≈ 9 MB, an area of about 500 × 500 km). */
export const MAX_OUTLINE_CHUNKS = 64;

/**
 * Shares of 1 km pixels inside a drawn outline, from the chunks it covers. 'too-large' when the outline
 * needs more than MAX_OUTLINE_CHUNKS chunks; null when it misses the 1 km grid.
 */
export async function outlineStats(px: PxInfo, poly: readonly [number, number][]): Promise<OutlineStats | 'too-large' | null> {
  const w = ringWindow(px.meta.grid, poly);
  if (!w) return null;
  const keys = windowChunks(w, px.meta.chunk);
  if (keys.length > MAX_OUTLINE_CHUNKS) return 'too-large';
  const acc = emptyOutlineStats(px.meta);
  const ring = poly.map((p) => [p[0], p[1]]);
  const inside = (lon: number, lat: number) => ringHas(ring, lon, lat);
  const bufs = await Promise.all(keys.map((k) => loadChunk(px, k)));
  bufs.forEach((b, i) => b && tallyChunk(acc, b, px.meta, keys[i], w, inside));
  return acc;
}
