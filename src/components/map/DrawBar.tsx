import { Pentagon } from 'lucide-react';
import { useApp } from '../../store';
import { drawApi } from './MapView';

export function DrawBar({ compact = false }: { compact?: boolean }) {
  const drawing = useApp((s) => s.drawing);
  const n = useApp((s) => s.drawCount);
  if (!drawing) {
    return (
      <button
        type="button"
        className="btn-secondary border-border-strong"
        aria-label={compact ? 'Draw an area' : undefined}
        onClick={() => drawApi.current?.start()}
      >
        <Pentagon size={compact ? 16 : 14} strokeWidth={1.5} aria-hidden="true" />
        {compact ? <span aria-hidden="true">Draw</span> : 'Draw an area'}
      </button>
    );
  }
  return (
    <div className={`flex h-control items-center gap-1.5 rounded border border-border-strong bg-white pl-3 pr-1 text-sm coarse:h-touch ${compact ? 'w-full' : ''}`} role="group" aria-label="Drawing an area">
      <span className={compact ? 'min-w-0 flex-1 truncate' : ''}>{compact ? 'Tap to add corners' : 'Click the map to add corners'}</span>
      <span className="text-text-2" aria-live="polite">· {n}</span>
      <button type="button" className="btn-ghost" onClick={() => drawApi.current?.undo()} disabled={n === 0}>
        Undo
      </button>
      <button type="button" className="btn-ghost" onClick={() => drawApi.current?.cancel()}>
        Cancel
      </button>
      <button
        type="button"
        className="btn-primary h-6 rounded-sm px-2.5 coarse:min-h-[36px]"
        disabled={n < 3}
        onClick={() => drawApi.current?.finish()}
      >
        Show answer
      </button>
    </div>
  );
}
