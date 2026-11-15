import { useEffect, useRef } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { FeatureCollection, MultiLineString, MultiPolygon } from 'geojson';
import { useApp } from '../../store';
import { cellAt, type ZoneFeature } from '../../lib/zones';
import { DLON } from '../../lib/geo';
import type { BoundaryFeature, DatasetMeta, LonLat, StudyMask } from '../../lib/types';
import { choroplethBin, CHORO_OPACITY, sharesFor, type OverviewKind, type PxRegions } from '../../lib/px';
import { countryOfRegion } from '../../lib/regions';
import { C, DOTS_ID, HATCH_ID, zoneFill } from '../../theme';

import { BASEMAP, HILLSHADE_URL } from './basemap';

/** Initial view before the oblast bounds are known. */
const START_BOUNDS = L.latLngBounds([40.45, 73.4], [42.7, 78.6]);

export interface DrawApi {
  start: () => void;
  undo: () => void;
  cancel: () => void;
  finish: () => void;
}

/** Set by the map once ready; used by the draw bar. */
export const drawApi: { current: DrawApi | null } = { current: null };

/** Imperative map actions used by the demo tour. */
export const mapApi: { current: { fitOblast: () => void } | null } = { current: null };

/** Right padding used when fitting or flying, so the drawer does not hide the target. */
export const DRAWER_PAD = 400;

const PANES: [string, number][] = [
  ['base', 200],
  ['px', 395],
  ['zones', 400],
  ['hillshade', 410],
  ['bounds', 420],
  ['sel', 430],
  ['labels', 450],
];

function Panes() {
  const map = useMap();
  for (const [name, z] of PANES) {
    if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z);
  }
  return null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function ensurePatterns(svg: SVGSVGElement) {
  if (svg.querySelector(`#${HATCH_ID}`)) return;
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <pattern id="${HATCH_ID}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
      <rect width="5" height="5" fill="${C.nr}"/>
      <rect width="1.2" height="5" fill="${C.nrHatch}"/>
    </pattern>
    <pattern id="${DOTS_ID}" patternUnits="userSpaceOnUse" width="5" height="5">
      <rect width="5" height="5" fill="#FFFFFF"/>
      <circle cx="2.5" cy="2.5" r="0.95" fill="${C.nrHatch}"/>
    </pattern>`;
  svg.insertBefore(defs, svg.firstChild);
}

function Zones({ zones, grey }: { zones: FeatureCollection<MultiPolygon, ZoneFeature['properties']> | null; grey: boolean }) {
  const map = useMap();
  const renderer = useRef<L.SVG | null>(null);
  useEffect(() => {
    if (!zones) return;
    if (!renderer.current) renderer.current = L.svg({ pane: 'zones', padding: 0.5 });
    const layer = L.geoJSON(zones, {
      pane: 'zones',
      renderer: renderer.current,
      interactive: false,
      style: (f) => {
        const { fill, opacity } = grey ? { fill: C.dim, opacity: 0.9 } : zoneFill((f as ZoneFeature).properties.cls);
        return { stroke: false, fillColor: fill, fillOpacity: opacity, className: `zone zone-${(f as ZoneFeature).properties.cls}` };
      },
    } as L.GeoJSONOptions).addTo(map);
    const svg = (renderer.current as unknown as { _container?: SVGSVGElement })._container;
    if (svg) ensurePatterns(svg);
    return () => {
      layer.remove();
    };
  }, [map, zones, grey]);
  return null;
}

/** A country to focus on (Central Asia): the map fits it and draws its border. */
export interface MapFocus {
  key: string;
  bounds: [[number, number], [number, number]] | null;
  border: MultiLineString | null;
}

/*
 * Guards for view changes. A map whose container has no size (a link opened in a hidden tab or a collapsed
 * frame) gets a NaN zoom from fitBounds with padding, and every later view call can then throw. View calls
 * run only on a map with panes and a container larger than the padding, inside try/catch; a fit that could
 * not run is retried when the container gets a size or the page becomes visible.
 */
type LeafletInternals = { _mapPane?: HTMLElement; _loaded?: boolean };

/** True when the map has its panes, a finite zoom and a container of at least `minW` × `minH` px. */
export function mapReady(map: L.Map, minW = 1, minH = 1): boolean {
  try {
    const m = map as unknown as LeafletInternals;
    if (!m._mapPane) return false;
    const c = map.getContainer();
    if (c.clientWidth < minW || c.clientHeight < minH) return false;
    return !m._loaded || Number.isFinite(map.getZoom());
  } catch {
    return false;
  }
}

/** setMinZoom / setMaxZoom without view side effects on a map that is not ready. */
function setZoomLimit(map: L.Map, which: 'minZoom' | 'maxZoom', z: number) {
  if (mapReady(map) && (map as unknown as LeafletInternals)._loaded) {
    try {
      if (which === 'minZoom') map.setMinZoom(z);
      else map.setMaxZoom(z);
      return;
    } catch {
      /* fall through: set the option only */
    }
  }
  map.options[which] = z;
}

/**
 * Calls `retry` whenever the map container changes size or the page becomes visible, after telling
 * Leaflet about the new size. Returns a cleanup function.
 */
function onBecomeUsable(map: L.Map, retry: () => void): () => void {
  const kick = () => {
    if (!mapReady(map)) return;
    try {
      map.invalidateSize({ pan: false });
    } catch {
      /* not ready yet */
    }
    retry();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(kick) : null;
  ro?.observe(map.getContainer());
  const vis = () => document.visibilityState === 'visible' && kick();
  document.addEventListener('visibilitychange', vis);
  map.on('resize load', retry);
  return () => {
    ro?.disconnect();
    document.removeEventListener('visibilitychange', vis);
    map.off('resize load', retry);
  };
}

function Boundaries({ mask, meta, focus }: { mask: StudyMask | null; meta: DatasetMeta | null; focus: MapFocus | null }) {
  const map = useMap();
  /** dataset the view was last fitted to (fit once per dataset per mount) */
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!mask) return;
    const ds = meta?.dataset ?? 'naryn';
    // Central Asia spans ~40° of longitude: allow zooming out far enough to see all of it.
    setZoomLimit(map, 'minZoom', ds === 'ca' ? 3 : 5);
    const group = L.layerGroup().addTo(map);
    let pending: (() => boolean) | null = null;
    if (mask.districts.length) {
      L.geoJSON({ type: 'FeatureCollection', features: mask.districts } as GeoJSON.FeatureCollection, {
        pane: 'bounds',
        interactive: false,
        style: { color: C.district, weight: 0.8, dashArray: '3 2', fill: false, opacity: 0.8 },
      }).addTo(group);
    }
    if (mask.oblast) {
      const style = { pane: 'bounds', interactive: false } as const;
      L.geoJSON(mask.oblast, { ...style, style: { color: '#FFFFFF', weight: 3.5, fill: false, opacity: 0.9 } }).addTo(group);
      const line = L.geoJSON(mask.oblast, { ...style, style: { color: C.boundary, weight: 1.4, fill: false } }).addTo(group);
      // Central Asia fits meta.view.bounds. Naryn keeps its original fit to the oblast outline (its
      // view.bounds is padded 0.9° to the west and would open the pilot 0.3 zoom levels further out).
      const whole = meta?.bounds && ds !== 'naryn' ? L.latLngBounds(meta.bounds) : line.getBounds();
      if (focus?.border) {
        L.geoJSON(focus.border, { ...style, style: { color: '#FFFFFF', weight: 3.5, opacity: 0.9 } }).addTo(group);
        L.geoJSON(focus.border, { ...style, style: { color: C.boundary, weight: 1.4 } }).addTo(group);
      }
      const target = focus?.bounds ? L.latLngBounds(focus.bounds) : whole;
      /** Fit the target; false (and kept for later) when the container is too small for the padding. */
      const fit = (animate: boolean): boolean => {
        const run = () => {
          if (!mapReady(map)) return false;
          try {
            // Measure the container now: Leaflet caches its size at creation, which can be stale.
            map.invalidateSize({ pan: false, animate: false });
          } catch {
            return false;
          }
          const size = map.getSize();
          const narrow = size.x < 768;
          const tl: [number, number] = [narrow ? 12 : 24, narrow ? 116 : 64];
          const br: [number, number] = [narrow ? 12 : DRAWER_PAD + 24, narrow ? Math.round(size.y * 0.45) : 24];
          if (size.x <= tl[0] + br[0] + 40 || size.y <= tl[1] + br[1] + 40) return false;
          try {
            map.fitBounds(target, { paddingTopLeft: tl, paddingBottomRight: br, animate });
            return true;
          } catch {
            return false;
          }
        };
        if (run()) {
          pending = null;
          return true;
        }
        pending = () => run();
        return false;
      };
      mapApi.current = { fitOblast: () => fit(true) };
      // Fit once per dataset and country; moving between countries of one dataset animates.
      const key = `${ds}|${focus?.key ?? ''}`;
      if (fitted.current !== key) {
        const sameDataset = fitted.current?.split('|')[0] === ds;
        fitted.current = key;
        fit(sameDataset);
      }
    }
    // A fit skipped while the map had no usable size runs once the container gets one.
    const stop = onBecomeUsable(map, () => {
      if (pending && pending()) pending = null;
    });
    return () => {
      stop();
      group.remove();
      mapApi.current = null;
    };
  }, [map, mask, meta, focus]);
  return null;
}

function Selection({ outline, poly, footprint, outlineOnly }: { outline: MultiPolygon | null; poly: LonLat[] | null; footprint: LonLat[] | null; outlineOnly: boolean }) {
  const map = useMap();
  const drawing = useApp((s) => s.drawing);
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    if (outline) {
      L.geoJSON(outline, {
        pane: 'sel',
        interactive: false,
        style: { color: C.text, weight: 2, fill: false, className: 'zone-selected' },
      }).addTo(group);
    }
    if (poly && poly.length >= 3 && !drawing) {
      L.polygon(
        poly.map(([lon, lat]) => [lat, lon] as [number, number]),
        { pane: 'sel', interactive: false, color: C.text, weight: 2, fillColor: C.text, fillOpacity: outlineOnly ? 0 : 0.08, className: 'drawn-outline' },
      ).addTo(group);
    }
    if (footprint) {
      // The clicked 1 km pixel: a white halo under a thin dark square.
      const ll = footprint.map(([lon, lat]) => [lat, lon] as [number, number]);
      L.polygon(ll, { pane: 'sel', interactive: false, color: '#FFFFFF', weight: 3.5, fill: false }).addTo(group);
      L.polygon(ll, { pane: 'sel', interactive: false, color: C.text, weight: 1.5, fill: false, className: 'pixel-footprint' }).addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [map, outline, poly, drawing, footprint, outlineOnly]);

  return null;
}

/** The native 1 km layer as the main data layer (palette tiles, one layer at a time). */
function PxTiles({ url, bounds, minZoom, maxNativeZoom }: { url: string; bounds: [[number, number], [number, number]]; minZoom: number; maxNativeZoom: number }) {
  const map = useMap();
  useEffect(() => {
    setZoomLimit(map, 'maxZoom', 12);
    return () => {
      // The map may already be removed (route change): only touch it while it still has its panes.
      if ((map as unknown as LeafletInternals)._mapPane) setZoomLimit(map, 'maxZoom', 11);
    };
  }, [map]);
  // A new layer per URL: Leaflet's setUrl() redraw takes the fractional map zoom (zoomSnap 0.1) as the
  // tile zoom and requests tiles like 7.8/158/82; a fresh layer rounds it.
  return (
    <TileLayer
      key={url}
      url={url}
      pane="px"
      bounds={L.latLngBounds(bounds)}
      minZoom={minZoom}
      maxNativeZoom={maxNativeZoom}
      maxZoom={12}
      className="px-tiles"
      keepBuffer={2}
    />
  );
}

/** Keeps the store's map zoom current (the Central Asia overview depends on it). */
function ZoomWatch() {
  const map = useMap();
  useEffect(() => {
    const on = () => useApp.getState().setMapZoom(map.getZoom());
    on();
    map.on('zoomend', on);
    return () => {
      map.off('zoomend', on);
    };
  }, [map]);
  return null;
}

export interface Overview {
  features: BoundaryFeature[];
  stats: PxRegions;
  kind: OverviewKind;
  /** only this country's regions (Central Asia country choice) */
  country: string | null;
  /** shade by the beyond-weather shares instead of the trend shares */
  resid?: boolean;
}

/**
 * Central Asia overview: at low zoom the mode-downsampled tiles read as mostly "no reliable trend", so each
 * region is shaded by its share of pasture with a reliable or possible decline (or growth), over the tiles.
 */
function Choropleth({ overview }: { overview: Overview | null }) {
  const map = useMap();
  useEffect(() => {
    if (!overview) return;
    const color = overview.kind === 'decline' ? C.decStrong : C.incStrong;
    const layer = L.geoJSON({ type: 'FeatureCollection', features: overview.features } as GeoJSON.FeatureCollection, {
      pane: 'zones',
      interactive: false,
      style: (f) => {
        const code = String((f?.properties as { code?: string } | undefined)?.code ?? '');
        const inside = !overview.country || countryOfRegion(code) === overview.country;
        const st = overview.stats.regions[code];
        const bin = inside && st ? choroplethBin(sharesFor(st, !!overview.resid), overview.kind) : null;
        return bin === null
          ? { stroke: false, fill: false }
          : { stroke: false, fillColor: color, fillOpacity: CHORO_OPACITY[bin], className: 'choropleth' };
      },
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, overview]);
  return null;
}

type PmPolygonDraw = { _removeLastVertex?: () => void; _finishShape?: () => void; _layer?: L.Polyline };

function Interaction() {
  const map = useMap();
  useEffect(() => {
    map.pm.setGlobalOptions({ panes: { layerPane: 'sel', vertexPane: 'markerPane', markerPane: 'markerPane' } } as never);
    const count = () => {
      const d = (map.pm.Draw as unknown as { Polygon: PmPolygonDraw }).Polygon;
      const n = d._layer ? (d._layer.getLatLngs() as L.LatLng[]).length : 0;
      useApp.getState().setDrawCount(n);
    };
    const onClick = (e: L.LeafletMouseEvent) => {
      const s = useApp.getState();
      if (s.drawing || !s.data) return;
      const c = cellAt(s.data, e.latlng.lng, e.latlng.lat);
      if (c) {
        s.selectZone(c.id);
        // With the 1 km layer the card also describes the clicked pixel itself.
        if (s.px) s.setPixel({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    };
    const onDrawStart = (e: { workingLayer: L.Layer }) => {
      e.workingLayer.on('pm:vertexadded', count);
    };
    const onCreate = (e: { layer: L.Polygon }) => {
      const ring = (e.layer.getLatLngs() as L.LatLng[][])[0] ?? [];
      const poly: LonLat[] = ring.map((ll) => [ll.lng, ll.lat]);
      e.layer.remove();
      map.getContainer().classList.remove('tx-drawing');
      if (poly.length >= 3) useApp.getState().selectDrawn(poly);
      else useApp.getState().setDrawing(false);
    };
    map.on('click', onClick);
    map.on('pm:drawstart', onDrawStart as never);
    map.on('pm:create', onCreate as never);
    drawApi.current = {
      start() {
        useApp.getState().setDrawing(true);
        map.getContainer().classList.add('tx-drawing');
        map.pm.enableDraw('Polygon', {
          snappable: false,
          tooltips: false,
          continueDrawing: false,
          templineStyle: { color: C.text, weight: 2, dashArray: '6 4' },
          hintlineStyle: { color: C.text, weight: 1.5, dashArray: '4 4' },
          pathOptions: { color: C.text, weight: 2, fillColor: C.text, fillOpacity: 0.08 },
        } as never);
      },
      undo() {
        const d = (map.pm.Draw as unknown as { Polygon: PmPolygonDraw }).Polygon;
        d._removeLastVertex?.();
        count();
      },
      cancel() {
        map.pm.disableDraw();
        map.getContainer().classList.remove('tx-drawing');
        useApp.getState().setDrawing(false);
      },
      finish() {
        const d = (map.pm.Draw as unknown as { Polygon: PmPolygonDraw }).Polygon;
        d._finishShape?.();
      },
    };
    return () => {
      map.off('click', onClick);
      map.off('pm:drawstart', onDrawStart as never);
      map.off('pm:create', onCreate as never);
      drawApi.current = null;
    };
  }, [map]);
  return null;
}

function Fly() {
  const map = useMap();
  const fly = useApp((s) => s.fly);
  useEffect(() => {
    if (!fly || !mapReady(map, 50, 50)) return;
    try {
      // 8.6 on the Naryn grid; one step out per doubling of the cell size (7.6 for 0.24° cells).
      const zoom = Math.max(map.getZoom(), 8.6 - Math.log2(DLON / 0.12));
      const narrow = map.getSize().x < 768;
      // Shift the target so it lands in the middle of the part of the map the drawer leaves visible.
      const p = map.project([fly.lat, fly.lon], zoom).add(narrow ? [0, map.getSize().y * 0.22] : [DRAWER_PAD / 2, 0]);
      map.flyTo(map.unproject(p, zoom), zoom, { duration: 0.9 });
    } catch {
      /* hidden or resized mid-flight: the selection still shows, the view just stays */
    }
  }, [map, fly]);
  return null;
}

/** Exposes the Leaflet map on window for end-to-end tests. */
function TestHook() {
  const map = useMap();
  useEffect(() => {
    (window as unknown as { __txMap?: L.Map }).__txMap = map;
  }, [map]);
  return null;
}

export interface MapViewProps {
  zones: FeatureCollection<MultiPolygon, ZoneFeature['properties']> | null;
  grey?: boolean;
  mask: StudyMask | null;
  meta?: DatasetMeta | null;
  /** "Naryn oblast" | "Central Asia" */
  title?: string;
  /** Central Asia: the chosen country */
  focus?: MapFocus | null;
  /** native 1 km tiles; when set they are the data layer and zones are drawn as outlines only */
  tiles?: { url: string; bounds: [[number, number], [number, number]]; minZoom: number; maxNativeZoom: number } | null;
  /** footprint of the clicked 1 km pixel */
  footprint?: LonLat[] | null;
  /** Central Asia overview shading (low zoom) */
  overview?: Overview | null;
  outline: MultiPolygon | null;
  poly: LonLat[] | null;
}

export function MapView({ zones, grey = false, mask, meta = null, title = 'Naryn oblast', focus = null, tiles = null, footprint = null, overview = null, outline, poly }: MapViewProps) {
  return (
    <MapContainer
      // A fixed first view (no padded fit at mount, which yields a NaN zoom in a container without size);
      // Boundaries fits the study area as soon as the outline is loaded and the container has a size.
      center={(meta?.bounds && meta.dataset !== 'naryn' ? L.latLngBounds(meta.bounds) : START_BOUNDS).getCenter()}
      zoom={meta?.dataset === 'ca' ? 4 : 7}
      minZoom={5}
      maxZoom={11}
      zoomSnap={0.1}
      zoomControl={false}
      attributionControl={false}
      className="absolute inset-0 z-0"
      aria-label={`Map of ${title} pastures`}
    >
      <Panes />
      <TileLayer url={BASEMAP.base} pane="base" subdomains={BASEMAP.subdomains ?? 'abc'} maxNativeZoom={16} />
      <TileLayer url={HILLSHADE_URL} pane="hillshade" maxNativeZoom={13} />
      <TileLayer url={BASEMAP.labels} pane="labels" subdomains={BASEMAP.subdomains ?? 'abc'} maxNativeZoom={16} />
      <Controls />
      {tiles && <PxTiles url={tiles.url} bounds={tiles.bounds} minZoom={tiles.minZoom} maxNativeZoom={tiles.maxNativeZoom} />}
      <Zones zones={zones} grey={grey} />
      <Choropleth overview={overview} />
      <ZoomWatch />
      <Boundaries mask={mask} meta={meta} focus={focus} />
      <Selection outline={outline} poly={poly} footprint={footprint} outlineOnly={!!tiles} />
      <Interaction />
      <Fly />
      <TestHook />
    </MapContainer>
  );
}

function Controls() {
  const map = useMap();
  useEffect(() => {
    const att = L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution(BASEMAP.attribution).addTo(map);
    const scale = L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map);
    const zoom = L.control.zoom({ position: 'bottomleft' }).addTo(map);
    return () => {
      zoom.remove();
      scale.remove();
      att.remove();
    };
  }, [map]);
  return null;
}
