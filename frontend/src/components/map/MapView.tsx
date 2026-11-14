import { useEffect, useRef } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { FeatureCollection, MultiLineString, MultiPolygon } from 'geojson';
import { useApp } from '../../store';
import { cellAt, type ZoneFeature } from '../../lib/zones';
import { DLON } from '../../lib/geo';
import type { DatasetMeta, LonLat, StudyMask } from '../../lib/types';
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

function Boundaries({ mask, meta, focus }: { mask: StudyMask | null; meta: DatasetMeta | null; focus: MapFocus | null }) {
  const map = useMap();
  /** dataset the view was last fitted to (fit once per dataset per mount) */
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!mask) return;
    const ds = meta?.dataset ?? 'naryn';
    // Central Asia spans ~40° of longitude: allow zooming out far enough to see all of it.
    map.setMinZoom(ds === 'ca' ? 3 : 5);
    const group = L.layerGroup().addTo(map);
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
      const fit = (animate: boolean) => {
        const narrow = map.getSize().x < 768;
        const h = map.getSize().y;
        map.fitBounds(target, {
          paddingTopLeft: [narrow ? 12 : 24, narrow ? 116 : 64],
          paddingBottomRight: [narrow ? 12 : DRAWER_PAD + 24, narrow ? Math.round(h * 0.45) : 24],
          animate,
        });
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
    return () => {
      group.remove();
      mapApi.current = null;
    };
  }, [map, mask, meta, focus]);
  return null;
}

function Selection({ outline, poly }: { outline: MultiPolygon | null; poly: LonLat[] | null }) {
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
        { pane: 'sel', interactive: false, color: C.text, weight: 2, fillColor: C.text, fillOpacity: 0.08, className: 'drawn-outline' },
      ).addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [map, outline, poly, drawing]);
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
      if (c) s.selectZone(c.id);
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
    if (!fly) return;
    // 8.6 on the Naryn grid; one step out per doubling of the cell size (7.6 for 0.24° cells).
    const zoom = Math.max(map.getZoom(), 8.6 - Math.log2(DLON / 0.12));
    const narrow = map.getSize().x < 768;
    // Shift the target so it lands in the middle of the part of the map the drawer leaves visible.
    const p = map.project([fly.lat, fly.lon], zoom).add(narrow ? [0, map.getSize().y * 0.22] : [DRAWER_PAD / 2, 0]);
    map.flyTo(map.unproject(p, zoom), zoom, { duration: 0.9 });
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
  outline: MultiPolygon | null;
  poly: LonLat[] | null;
}

export function MapView({ zones, grey = false, mask, meta = null, title = 'Naryn oblast', focus = null, outline, poly }: MapViewProps) {
  return (
    <MapContainer
      bounds={meta?.bounds && meta.dataset !== 'naryn' ? L.latLngBounds(meta.bounds) : START_BOUNDS}
      boundsOptions={{ paddingBottomRight: [DRAWER_PAD, 0] }}
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
      <Zones zones={zones} grey={grey} />
      <Boundaries mask={mask} meta={meta} focus={focus} />
      <Selection outline={outline} poly={poly} />
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
