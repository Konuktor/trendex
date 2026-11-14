import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, selectionKey } from '../store';
import { resolveAnswer } from '../lib/selection';
import { buildZoneGeoJSON, smoothPolygon } from '../lib/zones';
import { Rail } from '../components/map/Rail';
import { HeadlineStrip } from '../components/map/HeadlineStrip';
import { MapView } from '../components/map/MapView';
import { SearchBox } from '../components/map/SearchBox';
import { DrawBar } from '../components/map/DrawBar';
import { AnswerCard, CardSkeleton } from '../components/card/AnswerCard';
import type { LonLat } from '../lib/types';

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
  const load = useApp((s) => s.load);
  const layer = useApp((s) => s.layer);
  const matrix = useApp((s) => s.matrix);
  const district = useApp((s) => s.district);
  const sel = useApp((s) => s.sel);
  const queue = useApp((s) => s.queue);
  const [params] = useSearchParams();
  const forced = params.get('state');

  useEffect(() => {
    void load();
  }, [load]);

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
  const zones = useMemo(
    () => (data ? buildZoneGeoJSON(data.cells, layer, { matrix, district }) : null),
    [data, layer, matrix, district],
  );
  const res = useMemo(() => (data ? resolveAnswer(data, sel, layer) : null), [data, sel, layer]);
  const outline = useMemo(() => (res?.sel.mode === 'zone' ? smoothPolygon(res.sel.cells) : null), [res]);
  const card = res?.card ?? null;
  const key = selectionKey(sel);
  const queued = !!key && queue.some((q) => q.key === key);

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

  return (
    <div className="flex min-h-0 flex-1">
      <Rail card={loading ? null : card} loading={loading} />
      <main className="relative flex min-w-0 flex-1 flex-col" data-state={forced ?? 'ready'}>
        <HeadlineStrip loading={loading} />
        <div className="relative min-h-0 flex-1 bg-[#F3F3F3]">
          <MapView
            zones={zones}
            grey={loading}
            mask={mask}
            outline={loading ? null : outline}
            poly={!loading && sel?.type === 'drawn' ? sel.poly : null}
          />
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
