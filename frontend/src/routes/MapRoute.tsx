import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, queueFor, selectionKey } from '../store';
import { resolveAnswer } from '../lib/selection';
import { buildDimGeoJSON, buildZoneGeoJSON, smoothPolygon } from '../lib/zones';
import { hasResid, overviewActive, pixelCorners, pixelRowCol, tileUrl } from '../lib/px';
import { Rail } from '../components/map/Rail';
import { HeadlineStrip } from '../components/map/HeadlineStrip';
import { MapView, type MapFocus, type Overview } from '../components/map/MapView';
import { countryCellBounds, countryShape, multiCountry } from '../lib/regions';
import { DLAT, DLON } from '../lib/geo';
import { SearchBox } from '../components/map/SearchBox';
import { DrawBar } from '../components/map/DrawBar';
import { AnswerCard, CardSkeleton } from '../components/card/AnswerCard';
import { AnswerSheet, LayersButton, LayersSheet } from '../components/map/MobileSheets';
import { useIsMobile } from '../hooks/useIsMobile';
import { useState } from 'react';
import type { LonLat } from '../lib/types';
import { parseOutline } from '../lib/queue';

/** Preview states for screenshots: /map?state=excluded|lowConfidence|noData|outside|loading */
export type PreviewState = 'excluded' | 'lowConfidence' | 'noData' | 'outside' | 'loading';

const OUTSIDE_POLY: LonLat[] = [
  [77.1, 42.42],
  [77.3, 42.42],
  [77.3, 42.3],
  [77.1, 42.3],
];

export function MapRoute() {
  const data = useApp((s) => s.data);
  const mask = useApp((s) => s.mask);
  const meta = useApp((s) => s.meta);
  const dataset = useApp((s) => s.dataset);
  const country = useApp((s) => s.country);
  const px = useApp((s) => s.px);
  const pixel = useApp((s) => s.pixel);
  const load = useApp((s) => s.load);
  const layer = useApp((s) => s.layer);
  const matrix = useApp((s) => s.matrix);
  const district = useApp((s) => s.district);
  const sel = useApp((s) => s.sel);
  const queue = useApp((s) => s.queue);
  const [params] = useSearchParams();
  const mobile = useIsMobile();
  const [layersOpen, setLayersOpen] = useState(false);
  const drawing = useApp((s) => s.drawing);
  const forced = params.get('state');

  useEffect(() => {
    void load();
  }, [load]);

  const area = params.get('area');
  const outlineParam = params.get('outline');
  useEffect(() => {
    if (!data) return;
    const s = useApp.getState();
    if (area && data.byId[area]) s.selectZone(area, true);
    const poly = parseOutline(outlineParam);
    if (poly) s.selectDrawn(poly, true);
  }, [data, area, outlineParam]);

  useEffect(() => {
    if (!data || !forced) return;
    const s = useApp.getState();
    if (forced === 'excluded' && data.excl) s.selectZone(data.excl, true);
    else if (forced === 'lowConfidence' && data.low) s.selectZone(data.low, true);
    else if (forced === 'noData') {
      const nd = data.cells.find((x) => x.kind === 'nodata');
      if (nd) s.selectZone(nd.id, true);
    } else if (forced === 'outside') s.selectDrawn(OUTSIDE_POLY, true);
  }, [data, forced]);
  const loading = forced === 'loading' || !data;

  // Zones rebuild only when the data, layer or filter change.
  // With the 1 km layer the tiles carry the data; zones only dim what is outside a filter.
  const zones = useMemo(
    () =>
      data
        ? px
          ? buildDimGeoJSON(data.cells, { matrix, district, country })
          : buildZoneGeoJSON(data.cells, layer, { matrix, district, country })
        : null,
    [data, px, layer, matrix, district, country],
  );
  const resid = useApp((s) => s.resid) && hasResid(px);
  const tiles = useMemo(
    () =>
      px
        ? { url: tileUrl(px, resid ? 'resid' : layer), bounds: px.meta.tiles.bounds, minZoom: px.meta.tiles.minZoom, maxNativeZoom: px.meta.tiles.maxNativeZoom }
        : null,
    [px, layer, resid],
  );
  const mapZoom = useApp((s) => s.mapZoom);
  const overviewKind = useApp((s) => s.overviewKind);
  const showOverview = overviewActive({
    hasStats: !!px?.regions,
    multi: !!data && multiCountry(),
    layer,
    zoom: mapZoom,
    filtered: !!matrix || !!district,
  });
  const overview = useMemo<Overview | null>(
    () => (showOverview && px?.regions && mask ? { features: mask.districts, stats: px.regions, kind: overviewKind, country, resid } : null),
    [showOverview, px, mask, overviewKind, country, resid],
  );
  const footprint = useMemo(() => {
    if (!px || !pixel) return null;
    const rc = pixelRowCol(px.meta.grid, pixel.lat, pixel.lon);
    return rc ? pixelCorners(px.meta.grid, rc.row, rc.col) : null;
  }, [px, pixel]);
  // Central Asia: fit and outline the chosen country (bounds from its region polygons, else its cells).
  const focus = useMemo<MapFocus | null>(() => {
    if (!country || !mask || !data) return null;
    const shape = countryShape(mask.districts, country);
    return { key: country, bounds: shape.bounds ?? countryCellBounds(data.cells, country, DLON, DLAT), border: shape.border };
  }, [country, mask, data]);
  const res = useMemo(() => (data ? resolveAnswer(data, sel, layer) : null), [data, sel, layer]);
  const outline = useMemo(() => (res?.sel.mode === 'zone' ? smoothPolygon(res.sel.cells) : null), [res]);
  const card = res?.card ?? null;
  const key = selectionKey(sel);
  const queued = !!key && queueFor(queue, dataset).some((q) => q.key === key);

  const act = {
    queued,
    onClose: () => useApp.getState().clearSelection(),
    onPick: (id: string) => useApp.getState().selectZone(id, true),
    onQueue: () => {
      if (!card || !key || !sel) return;
      useApp.getState().toggleQueue({
        key,
        type: sel.type,
        cellId: sel.type === 'zone' ? sel.id : undefined,
        poly: sel.type === 'drawn' ? sel.poly : undefined,
        name: card.name,
        flag: card.kind === 'excluded',
      });
    },
  };

  const mapView = (
    <MapView
      zones={zones}
      grey={loading}
      mask={mask}
      meta={meta}
      title={meta?.title}
      focus={focus}
      tiles={tiles}
      footprint={loading ? null : footprint}
      overview={loading ? null : overview}
      outline={loading ? null : outline}
      poly={!loading && sel?.type === 'drawn' ? sel.poly : null}
    />
  );

  if (mobile) {
    return (
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-state={forced ?? 'ready'}>
        <div className="relative min-h-0 flex-1 bg-[#F3F3F3]">
          {mapView}
          <div className="absolute inset-x-3 top-3 z-[800] flex flex-col gap-2">
            <div className="flex items-start gap-2">
              {!drawing && <SearchBox className="min-w-0 flex-1" />}
              <DrawBar compact />
            </div>
            {!drawing && (
              <div>
                <LayersButton open={layersOpen} onClick={() => setLayersOpen(!layersOpen)} />
              </div>
            )}
          </div>
          {layersOpen ? (
            <LayersSheet card={loading ? null : card} onClose={() => setLayersOpen(false)} />
          ) : loading ? null : (
            card && !drawing && <AnswerSheet key={key ?? 'none'} a={card} act={act} />
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <Rail card={loading ? null : card} loading={loading} />
      <main className="relative flex min-w-0 flex-1 flex-col" data-state={forced ?? 'ready'}>
        <HeadlineStrip loading={loading} />
        <div className="relative min-h-0 flex-1 bg-[#F3F3F3]">
          {mapView}
          <div className="absolute left-4 top-4 z-[800] flex items-start gap-2">
            <SearchBox />
            <DrawBar />
          </div>
          {!card && !loading && (
            <div className="absolute right-4 top-4 z-[800] rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-text-2 shadow-float">
              Click a zone, search a place, or draw an area
            </div>
          )}
          {(loading || card) && (
            <div className="absolute inset-y-0 right-0 z-[900] w-drawer">
              {loading ? <CardSkeleton /> : card && <AnswerCard a={card} act={act} />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
