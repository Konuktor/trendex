import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../store';
import { headline, scopeCells } from '../../lib/stats';
import { regionLabel, regionName, studyTitle } from '../../lib/regions';
import { LEVEL_NAME, TREND_SHORT } from '../../lib/labels';
import { num } from '../../lib/format';

function FilterChip({ label, onClear, clearLabel }: { label: string; onClear: () => void; clearLabel: string }) {
  return (
    <span className="flex h-6 items-center gap-1.5 rounded border border-border-strong pl-2 pr-1 text-text">
      {label}
      <button
        type="button"
        aria-label={clearLabel}
        onClick={onClear}
        className="flex h-[18px] w-[18px] items-center justify-center rounded-sm text-text-2 hover:bg-panel hover:text-text"
      >
        <X size={12} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </span>
  );
}

export function HeadlineStrip({ loading = false }: { loading?: boolean }) {
  const data = useApp((s) => s.data);
  const district = useApp((s) => s.district);
  const matrix = useApp((s) => s.matrix);
  const toggleMatrix = useApp((s) => s.toggleMatrix);
  const toggleDistrict = useApp((s) => s.toggleDistrict);
  const h = useMemo(() => (data ? headline(scopeCells(data.past, district)) : null), [data, district]);
  return (
    <div className="z-[4] flex h-strip flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-b border-hairline bg-white px-6 text-sm text-text-2">
      {h && !loading ? (
        <>
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-trend-dec-strong align-[-1px]" />
            <b className="font-medium text-text">{h.dec}%</b> reliable decline
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span aria-hidden="true" className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-trend-inc-strong align-[-1px]" />
            <b className="font-medium text-text">{h.inc}%</b> reliable growth
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span aria-hidden="true" className="hatch mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" />
            <b className="font-medium text-text">{h.nr}%</b> not reliable
          </span>
          <span className="text-text-2">
            {district ? regionName(district) : studyTitle()} · {num(h.km2)} km² of pasture
          </span>
          {matrix && (
            <FilterChip
              label={`${LEVEL_NAME[matrix.level]} level × ${TREND_SHORT[matrix.trend]}`}
              clearLabel="Clear level × trend filter"
              onClear={() => toggleMatrix(matrix)}
            />
          )}
          {district && (
            <FilterChip
              label={regionName(district)}
              clearLabel={`Clear ${regionLabel().toLowerCase()} filter`}
              onClear={() => toggleDistrict(district)}
            />
          )}
        </>
      ) : (
        <span className="h-4 w-96 animate-pulse rounded-sm bg-panel" aria-hidden="true" />
      )}
    </div>
  );
}

/** Compact headline for the mobile Layers sheet. */
export function HeadlineSummary() {
  const data = useApp((s) => s.data);
  const district = useApp((s) => s.district);
  const h = useMemo(() => (data ? headline(scopeCells(data.past, district)) : null), [data, district]);
  if (!h) return null;
  return (
    <p className="text-sm text-text-2">
      <b className="font-medium text-text">{h.dec}%</b> reliable decline · <b className="font-medium text-text">{h.inc}%</b>{' '}
      reliable growth · <b className="font-medium text-text">{h.nr}%</b> not reliable. {district ? regionName(district) : studyTitle()} ·{' '}
      {num(h.km2)} km² of pasture.
    </p>
  );
}
