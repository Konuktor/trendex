import { isReal } from '../data/info';
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { useApp } from '../store';
import { isRegion, regionGroups, regionLabelPlural, regionName, regionOrder, studyTitle } from '../lib/regions';
import { cellsCsv, districtPanels, downloadText, matrixTable, scopeTrend, trendShares, type DistrictPanel } from '../lib/trends';
import { unionDomain, yDomain } from '../lib/chart';
import { num, signed } from '../lib/format';
import { LEVEL_NAME, NO_TREND_RESULT, TREND_NAME } from '../lib/labels';
import type { District, Trend } from '../lib/types';
import { TrendChart } from '../components/card/TrendChart';
import { useWidth } from '../hooks/useWidth';
import { C } from '../theme';

const TREND_BAR: Record<Trend, string> = { dec: 'bg-trend-dec-strong', nr: 'hatch', inc: 'bg-trend-inc-strong' };
const MATRIX_BG: Record<Trend, string> = { dec: C.dec, nr: '', inc: C.inc };


function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="label-caps">{label}</span>
      <span className="text-lg font-semibold md:text-xl">{value}</span>
      <span className="text-sm text-text-2">{sub}</span>
    </div>
  );
}

export function TrendsRoute() {
  const data = useApp((s) => s.data);
  const load = useApp((s) => s.load);
  const dataset = useApp((s) => s.dataset);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get('scope');
  const scope: District | null = data && isRegion(raw) ? raw : null;
  /** collapsed country groups of the region panels (Central Asia) */
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const selectId = useId();
  const [chartRef, chartW] = useWidth<HTMLDivElement>(900);
  const [gridRef, gridW] = useWidth<HTMLElement>(900);

  useEffect(() => {
    void load();
  }, [load]);

  const setScope = (d: District | null) => {
    const next = new URLSearchParams(params);
    if (d) next.set('scope', d);
    else next.delete('scope');
    setParams(next, { replace: true });
  };

  const v = useMemo(() => {
    if (!data) return null;
    const past = data.past.filter((x) => !scope || x.d === scope);
    const all = data.cells.filter((x) => !scope || x.d === scope);
    const t = scopeTrend(past)!;
    const panels = districtPanels(data.past);
    const shared = unionDomain(panels.map((p) => yDomain(p.model)));
    // Several countries: one group per country, each sorted by slope like the flat list.
    const byD = new Map(panels.map((p) => [p.d, p] as const));
    const groups = regionGroups().map((g) => ({
      ...g,
      panels: g.codes.map((d) => byD.get(d)).filter((p): p is DistrictPanel => !!p).sort((a, b) => a.slope - b.slope || a.d.localeCompare(b.d)),
    }));
    return { past, all, t, shares: trendShares(past), matrix: matrixTable(past), panels, shared, groups };
  }, [data, scope]);

  const title = data ? studyTitle() : dataset === 'ca' ? 'Central Asia' : 'Naryn oblast';
  const scopeName = scope ? regionName(scope) : title;
  const multi = !!v && v.groups.length > 1;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
        <header className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-xl font-semibold">Trends</h1>
            <p className="text-sm text-text-2">
              {isReal() ? 'Summer (May–Sep) greenness (NDVI), 2000–2025, NASA MODIS,' : 'Peak-season greenness (NDVI), 2000–2025,'} for pastures in {scopeName}.{isReal() ? '' : ' Sample data.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={selectId} className="text-sm text-text-2">
              Scope
            </label>
            <select
              id={selectId}
              value={scope ?? ''}
              onChange={(e) => setScope(isRegion(e.target.value) ? e.target.value : null)}
              className="h-control max-w-[260px] rounded border border-border-strong bg-white px-2 text-sm coarse:h-touch"
            >
              <option value="">{title}</option>
              {data && multi
                ? v!.groups.map((g) => (
                    <optgroup key={g.key} label={g.countryName}>
                      {g.codes.map((d) => (
                        <option key={d} value={d}>
                          {regionName(d)}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : data &&
                  regionOrder().map((d) => (
                    <option key={d} value={d}>
                      {regionName(d)}
                    </option>
                  ))}
            </select>
            <button
              type="button"
              className="btn-secondary"
              disabled={!v}
              onClick={() => v && downloadText(`trendex-${scope ?? dataset}-cells.csv`, cellsCsv(v.all))}
            >
              <Download size={14} strokeWidth={1.5} aria-hidden="true" />
              Download CSV
            </button>
          </div>
        </header>

        {!v ? (
          <div className="grid grid-cols-4 gap-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg bg-panel" />
            ))}
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Summary">
              <Stat label="Reliable decline" value={`${v.shares[0].pct}%`} sub={`${num(v.shares[0].km2)} km² of pasture`} />
              <Stat label="Reliable growth" value={`${v.shares[2].pct}%`} sub={`${num(v.shares[2].km2)} km² of pasture`} />
              <Stat label="Not reliable" value={`${v.shares[1].pct}%`} sub={`${num(v.shares[1].km2)} km² of pasture`} />
              <Stat
                label="Trend of the average"
                value={`${signed(v.t.slope)}% / yr`}
                sub={`95% interval ${signed(v.t.lo)} to ${signed(v.t.hi)} · ${v.t.trend === 'nr' ? 'not reliable' : 'reliable'}`}
              />
            </section>

            <section className="card flex flex-col gap-3 p-4 md:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <h2 className="text-md font-semibold">Average {isReal() ? 'summer' : 'peak-season'} greenness, {scopeName}</h2>
                <span className="text-xs text-text-2">Mean of {num(v.t.cells)} pasture cells · 2000–2025{isReal() ? '' : ' · Sample data'}</span>
              </div>
              <div ref={chartRef} className="w-full">
                <TrendChart model={v.t.model} trend={v.t.trend} width={chartW} height={280} title={`Average ${isReal() ? 'summer' : 'peak-season'} greenness, ${scopeName},`} />
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="card flex flex-col gap-4 p-6">
                <h2 className="text-md font-semibold">Area share by trend class</h2>
                <ul className="flex flex-col gap-3">
                  {v.shares.map((s) => (
                    <li key={s.trend} className="grid grid-cols-[104px_1fr_auto] items-center gap-3 text-sm md:grid-cols-[120px_1fr_150px]">
                      <span>{TREND_NAME[s.trend]}</span>
                      <span className="h-3 rounded-xs bg-panel" aria-hidden="true">
                        <span className={`block h-3 rounded-xs ${TREND_BAR[s.trend]}`} style={{ width: `${s.pct}%` }} />
                      </span>
                      <span className="text-right">
                        <b className="font-medium">{s.pct}%</b> <span className="text-text-2">· {num(s.km2)} km²</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-md font-medium">{NO_TREND_RESULT}</p>
                <p className="text-sm text-text-2">
                  Where the 95% interval of the slope includes zero, or fewer than 16 of 26 seasons were clear, the
                  record does not show a direction. Year-to-year swings from weather are larger than any change over
                  time. These areas are still checked and compared; they are not missing data.
                </p>
              </section>

              <section className="card flex flex-col gap-3 p-6">
                <h2 className="text-md font-semibold">Level × trend</h2>
                <table className="w-full min-w-[300px] border-separate border-spacing-1 text-sm">
                  <caption className="sr-only-label">Share of pasture area by level and trend, with area in km²</caption>
                  <thead>
                    <tr className="text-xs text-text-2">
                      <th scope="col" className="w-20 font-normal" />
                      <th scope="col" className="font-normal">Decline</th>
                      <th scope="col" className="font-normal">Not reliable</th>
                      <th scope="col" className="font-normal">Growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.matrix.map((row) => (
                      <tr key={row[0].level}>
                        <th scope="row" className="text-left text-xs font-normal text-text-2">
                          {LEVEL_NAME[row[0].level]}
                        </th>
                        {row.map((m) => (
                          <td
                            key={m.trend}
                            className={`h-14 rounded-sm text-center ${m.trend === 'nr' ? 'hatch' : ''}`}
                            style={{ background: MATRIX_BG[m.trend] || undefined }}
                          >
                            <span className="inline-flex flex-col rounded-[3px] bg-white px-1.5 py-0.5 leading-tight">
                              <span className="text-sm font-medium">{m.pct}%</span>
                              <span className="text-xs text-text-2">{num(m.km2)} km²</span>
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-text-2">Share of pasture area in the scope. Level is relative to other pastures in {title}.</p>
              </section>
            </div>

            <section ref={gridRef} className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-md font-semibold">
                  {regionLabelPlural()}, {multi ? 'by country, sorted by slope' : 'sorted by slope'}
                </h2>
                <span className="text-xs text-text-2">All panels share one y-scale{isReal() ? '' : ' · Sample data'}</span>
              </div>
              {multi ? (
                v.groups.map((g) => {
                  if (!g.panels.length) return null;
                  const open = !closed[g.key];
                  const Icon = open ? ChevronDown : ChevronRight;
                  return (
                    <div key={g.key} className="flex flex-col gap-3">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`trend-group-${g.key}`}
                        onClick={() => setClosed({ ...closed, [g.key]: open })}
                        className="-ml-2 flex items-center gap-2 self-start rounded px-2 py-1 text-left transition-colors hover:bg-panel"
                      >
                        <Icon size={14} strokeWidth={1.5} className="text-text-2" aria-hidden="true" />
                        <h3 className="text-sm font-semibold">{g.countryName}</h3>
                        <span className="text-xs text-text-2">
                          {g.panels.length} {g.panels.length === 1 ? 'region' : 'regions'}
                        </span>
                      </button>
                      {open && (
                        <div id={`trend-group-${g.key}`}>
                          <PanelGrid panels={g.panels} gridW={gridW} domain={v.shared} scope={scope} setScope={setScope} onMap={(d) => { useApp.getState().setDistrict(d); navigate('/map'); }} />
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <PanelGrid panels={v.panels} gridW={gridW} domain={v.shared} scope={scope} setScope={setScope} onMap={(d) => { useApp.getState().setDistrict(d); navigate('/map'); }} />
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function PanelGrid({
  panels,
  gridW,
  domain,
  scope,
  setScope,
  onMap,
}: {
  panels: DistrictPanel[];
  gridW: number;
  domain: [number, number];
  scope: District | null;
  setScope: (d: District | null) => void;
  onMap: (d: District) => void;
}) {
  const cols = gridW >= 1024 ? 3 : gridW >= 640 ? 2 : 1;
  const pw = Math.floor((gridW - (cols - 1) * 16) / cols) - 34;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {panels.map((p) => (
        <article key={p.d} className={`card flex flex-col gap-2 p-4 ${scope === p.d ? 'border-text' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <span className="text-xs text-text-2">
                {signed(p.slope)}% / yr · {num(p.km2)} km²
              </span>
            </div>
            <span className={`rounded-sm border px-1.5 text-xs ${p.reliable ? 'border-text text-text' : 'border-border-strong text-text-2'}`}>
              {p.reliable ? 'Reliable' : 'Not reliable'}
            </span>
          </div>
          <TrendChart
            model={p.model}
            trend={p.trend}
            width={Math.max(200, pw)}
            height={128}
            domain={domain}
            labels={false}
            xTicks={[0, 25]}
            title={`${p.name} average ${isReal() ? 'summer' : 'peak-season'} greenness`}
          />
          <div>
            <button
              type="button"
              className="btn-ghost -ml-2"
              aria-pressed={scope === p.d}
              onClick={() => setScope(scope === p.d ? null : p.d)}
            >
              {scope === p.d ? 'Clear scope' : 'Set as scope'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => onMap(p.d)}>
              Show on map
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
