import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMask } from '../lib/mask';
import { buildData } from '../lib/mock';
import type { BoundaryFeature, DataSet, StudyMask } from '../lib/types';

const ROOT = resolve(__dirname, '../..');

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as T;
}

type FC = { features: BoundaryFeature[] };
export const ADM1 = readJson<FC>('public/data/kgz-adm1.geojson');
export const ADM2 = readJson<FC>('public/data/kgz-adm2.geojson');

let memo: { mask: StudyMask; data: DataSet } | null = null;
export function fixture(): { mask: StudyMask; data: DataSet } {
  if (!memo) {
    const mask = buildMask(ADM1, ADM2)!;
    memo = { mask, data: buildData(mask) };
  }
  return memo;
}

/** The reference prototype's pure functions, evaluated from reference/trendex-map-prototype.html. */
export function loadReference() {
  const html = readFileSync(resolve(ROOT, 'reference/trendex-map-prototype.html'), 'utf8');
  const start = html.indexOf('var LON0=');
  const end = html.indexOf('/* ---------- zone raster');
  if (start < 0 || end < 0 || html.indexOf('function suggestions(') < 0) throw new Error('reference markers not found');
  const s0 = html.indexOf('function suggestions(');
  const s1 = html.indexOf('var SUG=[];');
  const body =
    html.slice(start, end) +
    html.slice(s0, s1) +
    '\nreturn {realMask:realMask,buildData:buildData,answer:answer,zoneOf:zoneOf,selection:selection,series:series,fit:fit,placeName:placeName,suggestions:suggestions,S:S,setD:function(d){D=d;},cellKeyOf:cellKeyOf};';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(body)() as RefApi;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RefApi {
  realMask(a1: any, a2: any): any;
  buildData(m: any): any;
  answer(sel: any): any;
  zoneOf(a: any): any[];
  selection(): any;
  series(x: any): number[];
  fit(v: number[]): { sp: number; ci: number; dir: string };
  placeName(cx: number, cy: number, always?: boolean): string;
  suggestions(q: string): { label: string; sub: string; lon: number; lat: number }[];
  S: { layer: string; sel: string | null; poly: number[][] | null };
  setD(d: any): void;
  cellKeyOf(lat: number, lon: number): string;
}
