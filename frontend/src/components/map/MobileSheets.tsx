import { useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { Answer } from '../../lib/answer';
import { AnswerCardHeader, AnswerDetails, AnswerSummary, NotAccounted, type CardActions } from '../card/AnswerCard';
import { CountrySelect, DistrictList, LayerSwitch, Legend, Matrix } from './Rail';
import { HeadlineSummary } from './HeadlineStrip';
import { useWidth } from '../../hooks/useWidth';

export function LayersButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button type="button" className="btn-secondary border-border-strong" aria-expanded={open} aria-controls="layers-sheet" onClick={onClick}>
      <Layers size={16} strokeWidth={1.5} aria-hidden="true" />
      Layers
    </button>
  );
}

export function LayersSheet({ card, onClose }: { card: Answer | null; onClose: () => void }) {
  return (
    <section
      id="layers-sheet"
      aria-label="Layers and filters"
      className="absolute inset-x-0 bottom-0 z-[1000] flex max-h-[85%] flex-col rounded-t-xl border-t border-hairline bg-surface shadow-float"
    >
      <div className="flex flex-none items-center justify-between border-b border-hairline px-4 py-1">
        <h2 className="text-md font-semibold">Layers and filters</h2>
        <button type="button" aria-label="Close layers" onClick={onClose} className="flex h-touch w-touch items-center justify-center rounded text-text-2 hover:bg-panel">
          <X size={18} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4">
        <CountrySelect />
        <HeadlineSummary />
        <section className="flex flex-col gap-2">
          <h2 className="label-caps">Layer</h2>
          <LayerSwitch />
          <Legend />
        </section>
        <Matrix card={card} />
        <DistrictList />
      </div>
    </section>
  );
}

export function AnswerSheet({ a, act }: { a: Answer; act: CardActions }) {
  const [expanded, setExpanded] = useState(false);
  const [ref, w] = useWidth<HTMLDivElement>(340);
  return (
    <section
      aria-label="Answer card"
      className={`absolute inset-x-0 bottom-0 z-[900] flex flex-col rounded-t-xl border-t border-hairline bg-white shadow-float transition-[max-height] ${
        expanded ? 'max-h-[88%]' : 'max-h-[56%]'
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex h-touch w-full flex-none items-center justify-center"
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-border-strong" />
        <span className="sr-only-label">{expanded ? 'Collapse answer card' : 'Expand answer card'}</span>
      </button>
      <div className="-mt-3">
        <AnswerCardHeader a={a} onClose={act.onClose} compact={!expanded} />
      </div>
      <div ref={ref} className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 ${expanded ? 'gap-6 pt-5' : 'gap-4 pt-4'}`}>
        <AnswerSummary a={a} />
        {expanded ? (
          <AnswerDetails a={a} act={act} chartWidth={Math.max(260, w - 48)} />
        ) : (
          <button type="button" className="btn-secondary self-start" onClick={() => setExpanded(true)}>
            Show chart, reasons and next step
          </button>
        )}
      </div>
      <NotAccounted />
    </section>
  );
}
