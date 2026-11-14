import type { Feature, MultiPolygon, Polygon } from 'geojson';

export type District = 'NA' | 'AT' | 'JU' | 'KO' | 'AK' | 'SU';
export type Level = 'low' | 'moderate' | 'good';
export type Trend = 'dec' | 'nr' | 'inc'; // nr = not reliable
export type Kind = 'pasture' | 'excluded' | 'nodata';
export type Confidence = 'High' | 'Medium' | 'Low';
export type Layer = 'trend' | 'level';

export interface Cell {
  id: string;
  c: number;
  r: number;
  lon: number;
  lat: number;
  d: District;
  kind: Kind;
  why: string;
  water: boolean;
  pct: number;
  level: Level;
  slope: number;
  trend: Trend;
  strong: boolean;
  cov: number;
  seasons: number;
  conf: Confidence;
  /** Real data only: 26 yearly summer NDVI values 2000–2025 (gaps already filled). */
  series?: number[];
  /** Real data only: land-cover shares in the cell (MODIS MCD12Q1 2020). */
  landCover?: Partial<Record<'grassland' | 'cropland' | 'settlement' | 'water' | 'bare' | 'forest', number>>;
  /** Real data only: TrendeX level score 0–100, trend p and FDR q values. */
  score?: number;
  p_value?: number;
  q_value?: number | null;
}

export type BoundaryFeature = Feature<Polygon | MultiPolygon, { shapeName: string } & Record<string, unknown>>;

export interface StudyMask {
  /** cell id ("c,r") → district */
  m: Record<string, District>;
  oblast: BoundaryFeature | null;
  districts: BoundaryFeature[];
}

export interface DataSet {
  cells: Cell[];
  past: Cell[];
  byId: Record<string, Cell>;
  /** Suusamyr demo cell id */
  demo: string | null;
  /** Ak-Sai low-coverage cell id */
  low: string | null;
  /** Kochkor settlement (excluded) cell id */
  excl: string | null;
}

export interface MatrixFilter {
  level: Level;
  trend: Trend;
}

export interface ZoneFilter {
  matrix: MatrixFilter | null;
  district: District | null;
}

export type LonLat = [number, number];

export type Selection =
  | { mode: 'zone'; cells: Cell[]; anchor: string }
  | { mode: 'drawn'; cells: Cell[]; poly: LonLat[] };
