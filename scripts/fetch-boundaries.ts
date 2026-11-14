/**
 * Fetch the geoBoundaries KGZ ADM1 / ADM2 simplified GeoJSON once and store
 * them in public/data. The app never fetches boundaries at runtime.
 *
 *   npm run fetch-boundaries
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'wmgeolab/geoBoundaries/main/releaseData/gbOpen/KGZ';
const LEVELS = ['ADM1', 'ADM2'] as const;

function urls(level: (typeof LEVELS)[number]): string[] {
  const path = `${BASE}/${level}/geoBoundaries-KGZ-${level}_simplified.geojson`;
  return [
    `https://media.githubusercontent.com/media/${path}`,
    `https://raw.githubusercontent.com/${path}`,
  ];
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: { properties: Record<string, unknown> }[];
}

async function fetchFirst(list: string[]): Promise<FeatureCollection> {
  for (const u of list) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      // A Git LFS pointer is plain text, not JSON; skip it.
      const json = JSON.parse(text) as FeatureCollection;
      if (json.type === 'FeatureCollection' && json.features?.length) return json;
      throw new Error('no features');
    } catch (e) {
      console.warn(`  ${u}: ${(e as Error).message}`);
    }
  }
  throw new Error('All sources failed');
}

for (const level of LEVELS) {
  console.log(`Fetching ${level}…`);
  const fc = await fetchFirst(urls(level));
  const out = resolve(ROOT, `public/data/kgz-${level.toLowerCase()}.geojson`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(fc));
  const names = fc.features.map((f) => String(f.properties.shapeName)).join(', ');
  console.log(`  ${fc.features.length} features → ${out}\n  ${names}`);
}
