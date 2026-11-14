import { Navigate, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { Tour } from './components/Tour';
import { useApp } from './store';
import { MapRoute } from './routes/MapRoute';
import { TrendsRoute } from './routes/TrendsRoute';
import { QueueRoute } from './routes/QueueRoute';
import { MethodsRoute } from './routes/MethodsRoute';

export function App() {
  const setTour = useApp((s) => s.setTour);
  const loadError = useApp((s) => s.loadError);
  const retry = useApp((s) => s.retry);
  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden">
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
