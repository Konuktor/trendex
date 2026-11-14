import { useMemo } from 'react';
import { useApp } from '../../store';
import { DISTRICT_NAMES, DISTRICT_ORDER } from '../../lib/mask';
import { LEVEL_NAME, TREND_SHORT } from '../../lib/labels';
import { districtRow, matrixShare, scopeCells } from '../../lib/stats';
import { num } from '../../lib/format';
import type { Answer } from '../../lib/answer';
import type { Level, Trend } from '../../lib/types';
import { C, LEVEL_BG } from '../../theme';

const LEVELS: Level[] = ['good', 'moderate', 'low'];
const TRENDS: Trend[] = ['dec', 'nr', 'inc'];
const TREND_COL: Record<Trend, string> = { dec: 'Decline', nr: 'Not reliable', inc: 'Growth' };

export function LayerSwitch() {
  const layer = useApp((s) => s.layer);
  const setLayer = useApp((s) => s.setLayer);
  return (
    <div role="group" aria-label="Map layer" className="grid h-control grid-cols-2 gap-0.5 rounded border border-hairline bg-seg p-0.5">
      {(['trend', 'level'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={layer === l}
          onClick={() => setLayer(l)}
          className={`rounded-sm text-sm font-medium transition-colors ${
            layer === l ? 'bg-white text-text shadow-hair' : 'text-text-2 hover:text-text'
          }`}
        >
          {l === 'trend' ? 'Trend' : 'Level'}
        </button>
      ))}
    </div>
  );
}

export function Legend() {
  const layer = useApp((s) => s.layer);
  return (
    <div className="flex flex-col gap-2">
      {layer === 'trend' ? (
        <>
          <div className="mt-1 grid h-3 grid-cols-5 gap-0.5" aria-hidden="true">
            <span className="rounded-l-xs bg-trend-dec-strong" />
            <span className="bg-trend-dec" />
            <span className="hatch" />
            <span className="bg-trend-inc" />
            <span className="rounded-r-xs bg-trend-inc-strong" />
          </div>
          <div className="flex justify-between text-xs text-text-2">
            <span>Reliable decline</span>
            <span>Not reliable</span>
            <span>Reliable growth</span>
          </div>
          <div className="text-xs text-text-2">Darker = steeper slope</div>
        </>
      ) : (
        <>
          <div className="mt-1 grid h-3 grid-cols-3 gap-0.5" aria-hidden="true">
            <span className="rounded-l-xs bg-level-low" />
            <span className="bg-level-moderate" />
            <span className="rounded-r-xs bg-level-good" />
          </div>
          <div className="flex justify-between text-xs text-text-2">
            <span>Low</span>
            <span>Moderate</span>
            <span>Good</span>
          </div>
          <div className="text-xs text-text-2">Thirds of pasture area, relative to the oblast</div>
        </>
      )}
      <div className="flex gap-4 text-xs text-text-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-excluded" />
          Excluded
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="dots h-3 w-3 rounded-[3px] border border-border-strong" />
          Not enough data
        </span>
      </div>
    </div>
  );
}

export function Matrix({ card, loading = false }: { card: Answer | null; loading?: boolean }) {
  const data = useApp((s) => s.data);
  const layer = useApp((s) => s.layer);
  const matrix = useApp((s) => s.matrix);
  const district = useApp((s) => s.district);
  const toggleMatrix = useApp((s) => s.toggleMatrix);
  const clear = useApp((s) => s.toggleMatrix);
  const scope = useMemo(() => (data ? scopeCells(data.past, district) : []), [data, district]);
  if (!data || loading) return <MatrixSkeleton />;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="mx-label">
      <div className="flex items-baseline justify-between">
        <h2 id="mx-label" className="label-caps">Level × trend</h2>
        {matrix && (
          <button type="button" className="text-xs text-text underline" onClick={() => clear(matrix)}>
            Clear filter
          </button>
        )}
      </div>
      <div className="grid grid-cols-[64px_repeat(3,minmax(0,1fr))] items-center gap-1 text-center text-xs text-text-2">
        <span />
        {TRENDS.map((t) => (
          <span key={t}>{TREND_COL[t]}</span>
        ))}
      </div>
      {LEVELS.map((lv) => (
        <div key={lv} className="grid grid-cols-[64px_repeat(3,minmax(0,1fr))] items-center gap-1">
          <span className="text-xs text-text-2">{LEVEL_NAME[lv]}</span>
          {TRENDS.map((tr) => {
            const on = !!matrix && matrix.level === lv && matrix.trend === tr;
            const p = matrixShare(scope, lv, tr);
            const here = card?.kind === 'pasture' && card.level === lv && card.trend === tr;
            const bg = layer === 'trend' ? (tr === 'dec' ? C.dec : tr === 'inc' ? C.inc : undefined) : LEVEL_BG[lv];
            return (
              <button
                key={tr}
                type="button"
                aria-pressed={on}
                aria-label={`${LEVEL_NAME[lv]} level, ${TREND_SHORT[tr]}: ${p}% of pasture area${here ? ', selected area' : ''}`}
                onClick={() => toggleMatrix({ level: lv, trend: tr })}
                className={`relative flex h-10 items-center justify-center rounded-sm transition-[box-shadow,opacity] hover:shadow-[0_0_0_1px_#171717] ${
                  layer === 'trend' && tr === 'nr' ? 'hatch' : ''
                }`}
                style={{
                  background: bg,
                  opacity: matrix && !on ? 0.4 : 1,
                  boxShadow: on ? '0 0 0 2px #171717' : undefined,
                }}
              >
                <span className="rounded-[3px] bg-white px-1 text-xs font-medium">{p}%</span>
                {here && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-text shadow-[0_0_0_1.5px_#fff]"
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
      <p className="text-xs text-text-2">
        Share of pasture area. Click a cell to filter the map. The black dot marks the selected area.
      </p>
    </section>
  );
}

export function MatrixSkeleton() {
  return (
    <section className="flex flex-col gap-2" aria-hidden="true" data-testid="matrix-skeleton">
      <div className="h-4 w-24 animate-pulse rounded-sm bg-panel" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[64px_repeat(3,minmax(0,1fr))] gap-1">
          <span className="h-10 animate-pulse rounded-sm bg-panel" />
          <span className="h-10 animate-pulse rounded-sm bg-panel" />
          <span className="h-10 animate-pulse rounded-sm bg-panel" />
          <span className="h-10 animate-pulse rounded-sm bg-panel" />
        </div>
      ))}
    </section>
  );
}

export function DistrictList({ loading = false }: { loading?: boolean }) {
  const data = useApp((s) => s.data);
  const district = useApp((s) => s.district);
  const toggle = useApp((s) => s.toggleDistrict);
  if (!data || loading) {
    return (
      <section className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-4 w-20 animate-pulse rounded-sm bg-panel" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-panel" />
        ))}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-1" aria-labelledby="dist-label">
      <h2 id="dist-label" className="label-caps mb-1">Districts</h2>
      {DISTRICT_ORDER.map((d) => {
        const row = districtRow(data.past, d);
        if (!row) return null;
        const on = district === d;
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(d)}
            className={`flex w-full items-center gap-3 rounded border p-2 text-left transition-colors ${
              on ? 'border-border-strong bg-white' : 'border-transparent hover:bg-panel'
            }`}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{DISTRICT_NAMES[d]}</span>
              <span className="text-xs text-text-2">
                {num(row.km2)} km² · {row.dec}% decline
              </span>
            </span>
            <span className="flex h-2 w-16 flex-none gap-px overflow-hidden rounded-xs" aria-hidden="true">
              <span className="bg-trend-dec-strong" style={{ width: `${row.dec}%` }} />
              <span className="hatch" style={{ width: `${row.nr}%` }} />
              <span className="bg-trend-inc-strong" style={{ width: `${row.inc}%` }} />
            </span>
          </button>
        );
      })}
    </section>
  );
}

export function Rail({ card, loading = false }: { card: Answer | null; loading?: boolean }) {
  return (
    <aside
      aria-label="Layers and filters"
      className="z-[5] flex w-rail flex-none flex-col gap-6 overflow-y-auto border-r border-hairline bg-surface p-4"
    >
      <section className="flex flex-col gap-2">
        <h2 className="label-caps">Layer</h2>
        <LayerSwitch />
        <Legend />
      </section>
      <Matrix card={card} loading={loading} />
      <DistrictList loading={loading} />
    </aside>
  );
}
