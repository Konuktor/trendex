import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { HAS_DATASETS, parseDataset } from './data/dataset';
import { TopBar } from './components/TopBar';
import { Tour } from './components/Tour';
import { useApp } from './store';
import { MapRoute } from './routes/MapRoute';
import { TrendsRoute } from './routes/TrendsRoute';
import { QueueRoute } from './routes/QueueRoute';
import { MethodsRoute } from './routes/MethodsRoute';

/**
 * Keeps ?ds= and the store in step. The store is the source of truth; an explicit change of the URL
 * (back/forward, an edited or shared link) switches the dataset, and a link that drops the parameter
 * gets it back.
 */
function DatasetSync() {
  const ds = useApp((s) => s.dataset);
  const setDataset = useApp((s) => s.setDataset);
  const [params, setParams] = useSearchParams();
  const urlDs = params.get('ds');
  const written = useRef<string | null>(urlDs);
  useEffect(() => {
    if (!HAS_DATASETS) return;
    const want = ds === 'naryn' ? null : ds;
    if (urlDs !== null && urlDs !== want && urlDs !== written.current) {
      written.current = urlDs;
      setDataset(parseDataset(urlDs));
      return;
    }
    written.current = want;
    if (urlDs !== want) {
      const next = new URLSearchParams(params);
      if (want) next.set('ds', want);
      else next.delete('ds');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, urlDs]);
  return null;
}

export function App() {
  const setTour = useApp((s) => s.setTour);
  const loadError = useApp((s) => s.loadError);
  const retry = useApp((s) => s.retry);
  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden">
      <DatasetSync />
      <TopBar onTour={() => setTour(1)} />
      <div className="relative flex min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapRoute />} />
          <Route path="/trends" element={<TrendsRoute />} />
          <Route path="/queue" element={<QueueRoute />} />
          <Route path="/methods" element={<MethodsRoute />} />
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
        <Tour />
        {loadError && (
          <div role="alert" className="absolute inset-0 z-40 flex items-center justify-center bg-white/90">
            <div className="card flex max-w-sm flex-col items-center gap-3 p-6 text-center">
              <h2 className="text-md font-semibold">Could not load data</h2>
              <p className="text-sm text-text-2">{loadError}</p>
              <button type="button" className="btn-secondary" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
