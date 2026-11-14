import { Pentagon } from 'lucide-react';
import { useApp } from '../../store';
import { drawApi } from './MapView';

export function DrawBar() {
  const drawing = useApp((s) => s.drawing);
  const n = useApp((s) => s.drawCount);
  if (!drawing) {
    return (
      <button type="button" className="btn-secondary border-border-strong" onClick={() => drawApi.current?.start()}>
        <Pentagon size={14} strokeWidth={1.5} aria-hidden="true" />
        Draw an area
      </button>
    );
  }
  return (
    <div className="flex h-control items-center gap-1.5 rounded border border-border-strong bg-white pl-3 pr-1 text-sm coarse:h-touch" role="group" aria-label="Drawing an area">
      <span>Click the map to add corners</span>
      <span className="text-text-2" aria-live="polite">· {n}</span>
      <button type="button" className="btn-ghost" onClick={() => drawApi.current?.undo()} disabled={n === 0}>
        Undo
      </button>
      <button type="button" className="btn-ghost" onClick={() => drawApi.current?.cancel()}>
        Cancel
      </button>
      <button
        type="button"
        className="btn-primary h-6 rounded-sm px-2.5"
        disabled={n < 3}
        onClick={() => drawApi.current?.finish()}
      >
        Show answer
      </button>
    </div>
  );
}
