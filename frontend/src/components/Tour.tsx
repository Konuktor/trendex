import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import { mapApi } from './map/MapView';
import { useIsMobile } from '../hooks/useIsMobile';
import { NO_TREND_RESULT } from '../lib/labels';

interface Step {
  title: string;
  text: string;
  /** desktop position inside the app body */
  pos: React.CSSProperties;
}

export const TOUR: Step[] = [
  {
    title: 'Read the map',
    text: `Coloured zones show the 2000–2025 trend of pasture greenness. Hatched zones have no reliable trend. ${NO_TREND_RESULT}`,
    pos: { left: 300, top: 156 },
  },
  {
    title: 'Pick an area',
    text: 'Click a zone, search a village or coordinates, or draw your own outline. The card gives a plain answer relative to other pastures.',
    pos: { right: 416, top: 104 },
  },
  {
    title: 'Filter with the matrix',
    text: 'The level × trend matrix is the legend and a filter. Here the map shows only moderate pastures with a reliable decline.',
    pos: { left: 296, top: 220 },
  },
  {
    title: 'How it is built',
    text: 'Every answer comes from one documented method. See how it works, how it was checked and what it does not know.',
    pos: { left: 392, top: 8 },
  },
];

/** Apply the app state for a tour step. */
export function applyStep(n: number, prev: number) {
  const s = useApp.getState();
  if (n === 1) {
    s.clearSelection();
    s.clearFilters();
    s.setLayer('trend');
    mapApi.current?.fitOblast();
  } else if (n === 2) {
    if (prev === 3) s.clearFilters();
    if (s.data?.demo) s.selectZone(s.data.demo, true);
  } else if (n === 3) {
    s.setLayer('trend');
    s.setDistrict(null);
    if (!s.matrix || s.matrix.level !== 'moderate' || s.matrix.trend !== 'dec') s.toggleMatrix({ level: 'moderate', trend: 'dec' });
    mapApi.current?.fitOblast();
  }
}

export function Tour() {
  const step = useApp((s) => s.tour);
  const setTour = useApp((s) => s.setTour);
  const navigate = useNavigate();
  const loc = useLocation();
  const mobile = useIsMobile();
  const headRef = useRef<HTMLHeadingElement>(null);
  const prev = useRef(0);

  useEffect(() => {
    if (!step) {
      prev.current = 0;
      return;
    }
    if (loc.pathname !== '/map') navigate('/map');
    // Wait a tick so the map route is mounted before applying state.
    const from = prev.current;
    const t = setTimeout(() => applyStep(step, from), loc.pathname === '/map' ? 0 : 200);
    prev.current = step;
    headRef.current?.focus();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!step) return null;
  const s = TOUR[step - 1];
  const end = () => {
    setTour(0);
    useApp.getState().clearFilters();
  };
  const style: React.CSSProperties = mobile ? { left: 12, right: 12, top: 100 } : { ...s.pos, width: 296 };
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      data-testid="tour"
      className="absolute z-[2000] flex flex-col gap-2 rounded-lg border border-hairline bg-white p-4 shadow-float"
      style={style}
      onKeyDown={(e) => e.key === 'Escape' && end()}
    >
      <span className="text-xs text-text-2">Step {step} of {TOUR.length}</span>
      <h2 id="tour-title" ref={headRef} tabIndex={-1} className="text-md font-semibold focus:outline-none">
        {s.title}
      </h2>
      <p className="text-sm">{s.text}</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-ghost -ml-2 mr-auto" onClick={end}>
          End tour
        </button>
        {step > 1 && (
          <button type="button" className="btn-secondary" onClick={() => setTour(step - 1)}>
            Back
          </button>
        )}
        {step < TOUR.length ? (
          <button type="button" className="btn-primary" onClick={() => setTour(step + 1)}>
            Next
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              end();
              navigate('/methods');
            }}
          >
            Open Methods
          </button>
        )}
      </div>
    </div>
  );
}
