import { isReal } from '../data/info';
import { useEffect, useId, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WeatherSection } from '../components/weather/WeatherPanel';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { useApp } from '../store';
import { countryName, countryOf, countryOfRegion, isRegion, regionGroups, regionLabelPlural, regionName, regionOrder, studyTitle } from '../lib/regions';
import { cellsCsv, districtPanels, downloadText, matrixTable, scopeTrend, trendShares, type DistrictPanel } from '../lib/trends';
import { unionDomain, yDomain } from '../lib/chart';
import { num, signed } from '../lib/format';
import { LEVEL_NAME, NO_TREND_RESULT, TREND_NAME } from '../lib/labels';
import type { Cell, District, Level, Trend } from '../lib/types';
import { inlineLabel, pxScope, shortLabel, TIER_CODE, TIER_KEYS, tierPercents, type PxInfo, type PxStats as PxStatsT, type TierKey } from '../lib/px';
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
  const country = useApp((s) => s.country);
  const setCountry = useApp((s) => s.setCountry);
  const px = useApp((s) => s.px);
  const location = useLocation();
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

  // Links from the map open the weather section (#weather) once the data is on the page.
  useEffect(() => {
    if (location.hash === '#weather' && data && px) document.getElementById('weather')?.scrollIntoView({ block: 'start' });
  }, [location.hash, data, px]);

  const setScope = (d: District | null) => {
    const next = new URLSearchParams(params);
    if (d) next.set('scope', d);
    else next.delete('scope');
    setParams(next, { replace: true });
  };

  const v = useMemo(() => {
    if (!data) return null;
    // Scope: one region, else the chosen country (Central Asia), else everything.
    const inCountry = (x: Cell) => !country || countryOf(x) === country;
    const inScope = (x: Cell) => (scope ? x.d === scope : inCountry(x));
    const past = data.past.filter(inScope);
    const all = data.cells.filter(inScope);
    const t = scopeTrend(past.length ? past : data.past)!;
    // Panels: the chosen country's regions only, else every region.
    const panels = districtPanels(country ? data.past.filter(inCountry) : data.past);
    const shared = unionDomain(panels.map((p) => yDomain(p.model)));
    // Several countries: one group per country, each sorted by slope like the flat list.
    const byD = new Map(panels.map((p) => [p.d, p] as const));
    const groups = regionGroups().map((g) => ({
      ...g,
      panels: g.codes.map((d) => byD.get(d)).filter((p): p is DistrictPanel => !!p).sort((a, b) => a.slope - b.slope || a.d.localeCompare(b.d)),
    }));
    return { past, all, t, shares: trendShares(past), matrix: matrixTable(past), panels, shared, groups };
  }, [data, scope, country]);

  const title = data ? studyTitle() : dataset === 'ca' ? 'Central Asia' : 'Naryn oblast';
  const scopeName = scope ? regionName(scope) : country ? countryName(country) : title;
  const multi = !!v && v.groups.length > 1;
  // 1 km pixel shares for the scope (region, else country, else all), as on the map; cells when the export has none.
  const pst = data ? pxScope(px?.regions, scope, scope ? null : country) : null;
  /** panels grouped by country: several countries and none chosen */
  const grouped = multi && !country;
  const pickScope = (value: string) => {
    if (value.startsWith('country:')) {
      setCountry(value.slice('country:'.length));
      setScope(null);
    } else if (isRegion(value)) {
      if (multi) setCountry(countryOfRegion(value));
      setScope(value);
    } else {
      if (multi) setCountry(null);
      setScope(null);
    }
  };

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
              value={scope ?? (multi && country ? `country:${country}` : '')}
              onChange={(e) => pickScope(e.target.value)}
              className="h-control max-w-[260px] rounded border border-border-strong bg-white px-2 text-sm coarse:h-touch"
            >
              <option value="">{title}</option>
              {data && multi
                ? v!.groups.map((g) => (
                    <optgroup key={g.key} label={g.countryName}>
                      <option value={`country:${g.key}`}>All of {g.countryName}</option>
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
              onClick={() => v && downloadText(`trendex-${scope ?? country ?? dataset}-cells.csv`, cellsCsv(v.all))}
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
              {px && pst ? (
                <PxStats px={px} st={pst} />
              ) : (
                <>
              <Stat label="Reliable decline" value={`${v.shares[0].pct}%`} sub={`${num(v.shares[0].km2)} km² of pasture`} />
              <Stat label="Reliable growth" value={`${v.shares[2].pct}%`} sub={`${num(v.shares[2].km2)} km² of pasture`} />
              <Stat label="Not reliable" value={`${v.shares[1].pct}%`} sub={`${num(v.shares[1].km2)} km² of pasture`} />
                </>
              )}
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

            {px && (px.whatif || px.regions?.all.expected) && (
              <WeatherSection px={px} district={scope} country={scope ? null : country} scopeName={scopeName} />
            )}

            <div className={`grid gap-6 ${px && pst?.matrix ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'lg:grid-cols-2'}`}>
              {px && pst ? (
                <PxShareCard px={px} st={pst} />
              ) : (
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
              )}

              {px && pst?.matrix ? (
                <PxMatrixCard px={px} st={pst} title={title} />
              ) : (
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
              )}
            </div>

            <section ref={gridRef} className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-md font-semibold">
                  {regionLabelPlural()}
                  {grouped ? ', by country, sorted by slope' : country && multi ? ` of ${countryName(country)}, sorted by slope` : ', sorted by slope'}
                </h2>
                <span className="text-xs text-text-2">All panels share one y-scale{isReal() ? '' : ' · Sample data'}</span>
              </div>
              {grouped ? (
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

/** Tiers in display order; "not enough data" only when it covers any area. */
function tiersOf(st: PxStatsT): TierKey[] {
  return TIER_KEYS.filter((k) => k !== 'insufficient' || (st.trend.insufficient ?? 0) > 0);
}

const kmOf = (st: PxStatsT, share: number) => num(Math.round(share * st.pasture_km2));

/** Summary cards from the 1 km pixels: reliable decline and growth (with the possible share), no reliable trend. */
function PxStats({ px, st }: { px: PxInfo; st: PxStatsT }) {
  const pc = tierPercents(st);
  return (
    <>
      <Stat
        label={shortLabel(px.meta, 1)}
        value={`${pc.decline}%`}
        sub={`${kmOf(st, st.trend.decline)} km² · ${pc.early_decline}% ${inlineLabel(px.meta, 2)}`}
      />
      <Stat
        label={shortLabel(px.meta, 5)}
        value={`${pc.growth}%`}
        sub={`${kmOf(st, st.trend.growth)} km² · ${pc.early_growth}% ${inlineLabel(px.meta, 4)}`}
      />
      <Stat label={shortLabel(px.meta, 3)} value={`${pc.stable}%`} sub={`${kmOf(st, st.trend.stable)} km² of pasture`} />
    </>
  );
}

/** "Area share by trend class" from the 1 km pixels: the five tiers with the map's labels and colours. */
function PxShareCard({ px, st }: { px: PxInfo; st: PxStatsT }) {
  const pc = tierPercents(st);
  return (
    <section className="card flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h2 className="text-md font-semibold">Area share by trend class</h2>
        <span className="text-xs text-text-2">1 km pixels · {num(Math.round(st.pasture_km2))} km² of pasture</span>
      </div>
      <ul className="flex flex-col gap-3">
        {tiersOf(st).map((k) => (
          <li key={k} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm md:grid-cols-[150px_1fr_150px]">
            <span>{shortLabel(px.meta, TIER_CODE[k])}</span>
            <span className="h-3 rounded-xs bg-panel" aria-hidden="true">
              <span
                className="block h-3 rounded-xs border border-hairline"
                style={{ width: `${100 * (st.trend[k] ?? 0)}%`, background: px.meta.codes[String(TIER_CODE[k])]?.color }}
              />
            </span>
            <span className="text-right">
              <b className="font-medium">{pc[k]}%</b> <span className="text-text-2">· {kmOf(st, st.trend[k] ?? 0)} km²</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-md font-medium">{NO_TREND_RESULT}</p>
      <p className="text-sm text-text-2">
        Reliable: the trend passes the correction for testing every pasture pixel. {shortLabel(px.meta, 2)} or{' '}
        {inlineLabel(px.meta, 4)}: the pixel’s own test passes (p &lt; 0.05), but not that correction. Elsewhere year-to-year
        swings from weather are larger than any change over time; these areas are still checked and compared, they are
        not missing data.
      </p>
    </section>
  );
}

/** Level × trend from the joint 1 km shares: one column per tier, coloured as on the map. */
function PxMatrixCard({ px, st, title }: { px: PxInfo; st: PxStatsT; title: string }) {
  const keys = tiersOf(st);
  const levels: Level[] = ['good', 'moderate', 'low'];
  return (
    <section className="card flex flex-col gap-3 p-6">
      <h2 className="text-md font-semibold">Level × trend</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-1 text-sm">
          <caption className="sr-only-label">Share of pasture area by level and trend tier (1 km pixels), with area in km²</caption>
          <thead>
            <tr className="text-xs text-text-2">
              <th scope="col" className="w-16 font-normal" />
              {keys.map((k) => (
                <th key={k} scope="col" className="font-normal leading-tight">
                  {shortLabel(px.meta, TIER_CODE[k])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels.map((lv) => (
              <tr key={lv}>
                <th scope="row" className="text-left text-xs font-normal text-text-2">
                  {LEVEL_NAME[lv]}
                </th>
                {keys.map((k) => {
                  const v = st.matrix?.[lv]?.[k] ?? 0;
                  return (
                    <td key={k} className="h-14 rounded-sm text-center" style={{ background: px.meta.codes[String(TIER_CODE[k])]?.color }}>
                      <span className="inline-flex flex-col rounded-[3px] bg-white px-1.5 py-0.5 leading-tight">
                        <span className="text-sm font-medium">{Math.round(100 * v)}%</span>
                        <span className="whitespace-nowrap text-xs text-text-2">{kmOf(st, v)} km²</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-2">
        Share of pasture area in the scope (1 km pixels). Level is relative to other pastures in {title}.
      </p>
    </section>
  );
}
