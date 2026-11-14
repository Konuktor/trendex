import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Download, Info } from 'lucide-react';
import { useApp } from '../store';
import { buildQueue, EMPTY_FILTER, filterQueue, queueCsv, SCORE_FORMULA, type QueueFilter } from '../lib/queue';
import { DISTRICT_NAMES, DISTRICT_ORDER } from '../lib/mask';
import { LEVEL_NAME, QUEUE_BANNER } from '../lib/labels';
import { downloadText } from '../lib/trends';
import { num, signed } from '../lib/format';
import type { District, Level } from '../lib/types';
import { ConfidenceBars, LevelChip, TrendChip } from '../components/ui/Chips';

const LEVELS: Level[] = ['low', 'moderate', 'good'];

export function QueueRoute() {
  const data = useApp((s) => s.data);
  const load = useApp((s) => s.load);
  const queue = useApp((s) => s.queue);
  const [f, setF] = useState<QueueFilter>(EMPTY_FILTER);
  const distId = useId();

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (data ? buildQueue(data, queue) : []), [data, queue]);
  const shown = useMemo(() => filterQueue(rows, f), [rows, f]);
  const addedCount = rows.filter((r) => r.fromMap).length;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <header className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-xl font-semibold">Inspection queue</h1>
            <p className="text-sm text-text-2">Areas with a reliable decline, ranked for field checks in the 2026 season. Sample data.</p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={!shown.length}
            onClick={() => downloadText('trendex-inspection-queue.csv', queueCsv(shown))}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            Export CSV
          </button>
        </header>

        <div role="note" className="flex items-center gap-2.5 rounded-lg border border-border-strong bg-panel px-4 py-3 text-sm">
          <Info size={16} strokeWidth={1.5} className="flex-none" aria-hidden="true" />
          {QUEUE_BANNER}
        </div>

        <div className="flex flex-wrap items-center gap-4" role="group" aria-label="Filters">
          <div role="group" aria-label="Show" className="grid h-control grid-cols-2 gap-0.5 rounded border border-hairline bg-seg p-0.5 coarse:h-touch">
            {[
              { v: false, label: 'All candidates' },
              { v: true, label: `Added from map (${addedCount})` },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={f.addedOnly === o.v}
                onClick={() => setF({ ...f, addedOnly: o.v })}
                className={`rounded-sm px-3 text-sm font-medium transition-colors ${f.addedOnly === o.v ? 'bg-white text-text shadow-hair' : 'text-text-2 hover:text-text'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor={distId} className="text-sm text-text-2">District</label>
            <select
              id={distId}
              value={f.district ?? ''}
              onChange={(e) => setF({ ...f, district: (e.target.value || null) as District | null })}
              className="h-control rounded border border-border-strong bg-white px-2 text-sm coarse:h-touch"
            >
              <option value="">All districts</option>
              {DISTRICT_ORDER.map((d) => (
                <option key={d} value={d}>{DISTRICT_NAMES[d]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Level">
            <span className="mr-1 text-sm text-text-2">Level</span>
            {LEVELS.map((l) => {
              const on = f.levels.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setF({ ...f, levels: on ? f.levels.filter((x) => x !== l) : [...f.levels, l] })}
                  className={`h-7 rounded border px-2.5 text-sm transition-colors coarse:h-touch ${on ? 'border-text bg-white font-medium text-text' : 'border-hairline bg-white text-text-2 hover:text-text'}`}
                >
                  {LEVEL_NAME[l]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Confidence">
            <span className="mr-1 text-sm text-text-2">Confidence</span>
            {[
              { v: false, label: 'Any' },
              { v: true, label: 'High only' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={f.highOnly === o.v}
                onClick={() => setF({ ...f, highOnly: o.v })}
                className={`h-7 rounded border px-2.5 text-sm transition-colors coarse:h-touch ${f.highOnly === o.v ? 'border-text bg-white font-medium text-text' : 'border-hairline bg-white text-text-2 hover:text-text'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-text-2" aria-live="polite">
            {shown.length} {shown.length === 1 ? 'area' : 'areas'}
          </span>
        </div>

        {!data ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-panel" />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="card flex flex-col items-start gap-3 p-8">
            {f.addedOnly && !addedCount ? (
              <>
                <h2 className="text-md font-semibold">Nothing in the queue yet</h2>
                <p className="text-sm text-text-2">
                  Open an area on the map and choose “Add to queue”. Added areas are kept in this browser.
                </p>
                <Link to="/map" className="btn-secondary">Open the map</Link>
              </>
            ) : (
              <>
                <h2 className="text-md font-semibold">No areas match these filters</h2>
                <p className="text-sm text-text-2">Try another district or level, or allow medium confidence.</p>
                <button type="button" className="btn-secondary" onClick={() => setF({ ...EMPTY_FILTER, addedOnly: f.addedOnly })}>
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <caption className="sr-only-label">Inspection queue, ranked by score</caption>
              <thead className="border-b border-hairline bg-surface text-left">
                <tr className="text-xs text-text-2">
                  <th scope="col" className="w-12 px-4 py-2.5 font-medium">Rank</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Area</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Level</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Trend</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">Pasture km²</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Confidence</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Reason</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only-label">Open on map</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.key} className="border-b border-hairline last:border-0 hover:bg-surface">
                    <td className="px-4 py-3 align-top font-medium">{i + 1}</td>
                    <td className="px-2 py-3 align-top">
                      <div className="flex flex-col">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-xs text-text-2">
                          {r.id === 'drawn' ? 'Drawn outline' : `Cell ${r.id}`} · {r.districtName}
                        </span>
                        {r.fromMap && <span className="mt-1 self-start rounded-sm border border-border-strong px-1.5 text-xs text-text-2">added from map</span>}
                      </div>
                    </td>
                    <td className="px-2 py-3 align-top">{r.level ? <LevelChip level={r.level} size="sm" /> : <span className="text-text-2">—</span>}</td>
                    <td className="px-2 py-3 align-top">
                      {r.trend ? (
                        <TrendChip trend={r.trend} strong={r.strong} size="sm" label={`${r.trend === 'dec' ? 'Decline' : r.trend === 'inc' ? 'Growth' : 'Not reliable'} ${signed(r.slope ?? 0)}%`} />
                      ) : (
                        <span className="text-text-2">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-right align-top">{num(r.km2)}</td>
                    <td className="px-2 py-3 align-top">
                      {r.conf ? (
                        <span className="flex items-center gap-1.5">
                          <ConfidenceBars conf={r.conf} />
                          {r.conf}
                        </span>
                      ) : (
                        <span className="text-text-2">—</span>
                      )}
                    </td>
                    <td className="max-w-[320px] px-2 py-3 align-top text-text-2">{r.reason}</td>
                    <td className="px-4 py-3 text-right align-top">
                      <Link to={r.href} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-text underline-offset-2 hover:underline">
                        Open on map
                        <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-text-2">{SCORE_FORMULA} Areas without a reliable decline score 0.</p>
      </div>
    </main>
  );
}
