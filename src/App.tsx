import { Navigate, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { MapRoute } from './routes/MapRoute';
import { TrendsRoute } from './routes/TrendsRoute';
import { QueueRoute } from './routes/QueueRoute';
import { MethodsRoute } from './routes/MethodsRoute';

export function App() {
  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapRoute />} />
          <Route path="/trends" element={<TrendsRoute />} />
          <Route path="/queue" element={<QueueRoute />} />
          <Route path="/methods" element={<MethodsRoute />} />
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
    </div>
  );
}
