import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../../store';
import { Link } from 'react-router-dom';
import { useDatasetSearch } from '../TopBar';
import { LEVEL_NAME, TREND_SHORT } from '../../lib/labels';
import { areaNoun, countries, multiCountry, regionGroups, regionLabelPlural, regionName, regionOrder, regionsOf, studyTitle } from '../../lib/regions';
import { countryRow, districtRows, matrixShare, scopeCells, type DistrictRow } from '../../lib/stats';
import {
  CHORO_LABELS,
  CHORO_OPACITY,
  inlineLabel,
  legendCodes,
  OVERVIEW_MAX_ZOOM,
  hasResid,
  layerLabel,
  overviewActive,
  pxMatrixShare,
  seasonLine,
  sharesFor,
  pxScope,
  shortLabel,
  TIER_CODE,
  TIER_KEYS,
  tierPercents,
  type PxInfo,
  type PxStats,
} from '../../lib/px';
import { CELL_KM } from '../../lib/geo';
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
  const resid = useApp((s) => s.resid);
  const setResid = useApp((s) => s.setResid);
  const px = useApp((s) => s.px);
  // With the weather model in the 1 km export: a third view, the trend beyond weather.
  const three = hasResid(px);
  const opts: { key: string; label: string; on: boolean; pick: () => void }[] = [
    { key: 'trend', label: 'Trend', on: layer === 'trend' && !(three && resid), pick: () => setLayer('trend') },
    { key: 'level', label: 'Level', on: layer === 'level', pick: () => setLayer('level') },
    ...(three ? [{ key: 'resid', label: 'Beyond weather', on: resid, pick: setResid }] : []),
  ];
  return (
    <div
      role="group"
      aria-label="Map layer"
      className={`grid h-control gap-0.5 rounded border border-hairline bg-seg p-0.5 ${three ? 'grid-cols-[1fr_1fr_1.7fr]' : 'grid-cols-2'}`}
    >
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.on}
          onClick={o.pick}
          className={`whitespace-nowrap rounded-sm text-sm font-medium transition-colors ${
            o.on ? 'bg-white text-text shadow-hair' : 'text-text-2 hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Central Asia at low zoom: what the region shading means, with a decline / growth toggle. */
function OverviewLegend() {
  const kind = useApp((s) => s.overviewKind);
  const resid = useApp((s) => s.resid);
  const setKind = useApp((s) => s.setOverviewKind);
  const color = kind === 'decline' ? C.decStrong : C.incStrong;
  return (
    <div className="flex flex-col gap-2 rounded border border-hairline bg-white p-2" data-testid="overview-legend">
      <span className="text-xs font-medium text-text">Regions at this zoom</span>
      <div role="group" aria-label="Shade regions by" className="grid h-control grid-cols-2 gap-0.5 rounded border border-hairline bg-seg p-0.5">
        {(['decline', 'growth'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-sm text-sm font-medium transition-colors ${kind === k ? 'bg-white text-text shadow-hair' : 'text-text-2 hover:text-text'}`}
          >
            {k === 'decline' ? 'Decline' : 'Growth'}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {CHORO_LABELS.map((label, i) => (
          <li key={label} className="flex items-center gap-1.5 text-xs text-text-2">
            <span aria-hidden="true" className="h-3 w-3 flex-none rounded-[3px] border border-hairline bg-white">
              <span className="block h-full w-full rounded-[2px]" style={{ background: color, opacity: CHORO_OPACITY[i] }} />
            </span>
            {label}
          </li>
        ))}
      </ul>
      <span className="text-xs text-text-2">
        Share of pasture with {kind === 'decline' ? 'a reliable or possible decline' : 'reliable or possible growth'}
        {resid ? ' beyond weather' : ''}. Zoom in past level{' '}
        {OVERVIEW_MAX_ZOOM} for the 1 km pixels.
      </span>
    </div>
  );
}

/** Legend of the 1 km layer: real class labels and colours from px/meta.json; masks that cover no area are left out. */
function PxLegend({ px }: { px: PxInfo }) {
  const layer = useApp((s) => s.layer);
  const resid = useApp((s) => s.resid) && hasResid(px);
  const data = useApp((s) => s.data);
  const zoom = useApp((s) => s.mapZoom);
  const district = useApp((s) => s.district);
  const country = useApp((s) => s.country);
  const filtered = useApp((s) => !!s.matrix || !!s.district);
  const search = useDatasetSearch();
  const showOverview = overviewActive({ hasStats: !!px.regions, multi: !!data && multiCountry(), layer, zoom, filtered });
  const codes = legendCodes(px.meta, resid ? 'resid' : layer, px.regions?.all ?? null);
  const item = (code: number) => {
    const c = px.meta.codes[String(code)];
    return (
      <li key={code} className="flex items-center gap-1.5 text-xs text-text-2">
        <span aria-hidden="true" className="h-3 w-3 flex-none rounded-[3px] border border-hairline" style={{ background: c.color }} />
        {layerLabel(px.meta, code, resid)}
      </li>
    );
  };
  const season = seasonLine(pxScope(px.regions, district, country)?.expected?.season);
  const weatherHref = `/trends${search}${district ? `${search ? '&' : '?'}scope=${encodeURIComponent(district)}` : ''}#weather`;
  const dataCodes = codes.filter((c) => c < 40);
  const masks = codes.filter((c) => c >= 40);
  return (
    <div className="flex flex-col gap-2" data-testid="px-legend">
      {showOverview && <OverviewLegend />}
      <ul className="flex flex-col gap-1">{dataCodes.map(item)}</ul>
      {resid && (
        <div className="flex flex-col gap-1 text-xs text-text-2">
          <span className="font-medium text-text">Beyond weather (Jun–Aug)</span>
          <span>
            Trend of June–August greenness minus the greenness expected from that summer’s weather:{' '}
            {(px.ml?.wording ?? 'change not explained by precipitation, air temperature, snow and soil moisture').replace(/^./, (c) => c.toLowerCase())}.
          </span>
          {season && <span className="text-text">{season}.</span>}
          {px.whatif && (
            <Link to={weatherHref} className="font-medium text-text underline underline-offset-2">
              Observed vs expected and what-if
            </Link>
          )}
        </div>
      )}
      {layer === 'trend' ? (
        <div className="text-xs text-text-2">
          {shortLabel(px.meta, 2)} or {inlineLabel(px.meta, 4)}: the pixel’s own test passes (p &lt; 0.05), but not the
          correction for testing every pixel.
        </div>
      ) : (
        <div className="text-xs text-text-2">Relative to other pastures in {studyTitle()}</div>
      )}
      {masks.length > 0 && (
        <>
          <div className="text-xs font-medium text-text-2">Not pasture</div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">{masks.map(item)}</ul>
        </>
      )}
      <div className="text-xs text-text-2">1 km pixels, NASA MODIS 2000–2025</div>
    </div>
  );
}

export function Legend() {
  const layer = useApp((s) => s.layer);
  const px = useApp((s) => s.px);
  useApp((s) => s.meta); // re-render on dataset switch (copy depends on it)
  if (px) return <PxLegend px={px} />;
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
          <div className="text-xs text-text-2">Thirds of pasture area, relative to {areaNoun()}</div>
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
  const country = useApp((s) => s.country);
  const px = useApp((s) => s.px);
  const scope = useMemo(() => (data ? scopeCells(data.past, district, country) : []), [data, district, country]);
  // 1 km pixel shares when the export has the joint level × trend table for this scope.
  const pxStats = pxScope(px?.regions, district, country);
  const fromPx = pxMatrixShare(pxStats, 'low', 'dec') !== null;
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
            const p = fromPx ? pxMatrixShare(pxStats, lv, tr)! : matrixShare(scope, lv, tr);
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
        {fromPx
          ? `Share of pasture area (1 km pixels); ${inlineLabel(px!.meta, 2).split(' ')[0]} trends count as not reliable. Click a cell to filter the map by ${Math.round(CELL_KM)} km cells. The black dot marks the selected area.`
          : 'Share of pasture area. Click a cell to filter the map. The black dot marks the selected area.'}
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

interface BarSeg {
  pct: number;
  cls?: string;
  color?: string;
}

function ShareBar({ segs }: { segs: BarSeg[] }) {
  return (
    <span className="flex h-2 w-16 flex-none gap-px overflow-hidden rounded-xs" aria-hidden="true">
      {segs.map((g, i) => (
        <span key={i} className={g.cls} style={{ width: `${g.pct}%`, background: g.color }} />
      ))}
    </span>
  );
}

/** Bar and summary of a row: 1 km pixel shares (five tiers) when available, else 10/20 km cell counts. */
interface RowView {
  km2: number;
  sub: string;
  segs: BarSeg[];
}

function cellView(row: Pick<DistrictRow, 'km2' | 'dec' | 'nr' | 'inc'>, extra = ''): RowView {
  return {
    km2: row.km2,
    sub: `${extra}${num(row.km2)} km² · ${row.dec}% decline`,
    segs: [
      { cls: 'bg-trend-dec-strong', pct: row.dec },
      { cls: 'hatch', pct: row.nr },
      { cls: 'bg-trend-inc-strong', pct: row.inc },
    ],
  };
}

function pxView(st0: PxStats, px: PxInfo, resid = false, extra = ''): RowView {
  const st = sharesFor(st0, resid);
  const pc = tierPercents(st);
  const keys = TIER_KEYS.filter((k) => k !== 'insufficient' || st.trend.insufficient > 0);
  return {
    km2: st.pasture_km2,
    sub: `${extra}${num(Math.round(st.pasture_km2))} km² · ${pc.decline}% decline · ${pc.early_decline}% ${inlineLabel(px.meta, 2).split(' ')[0]}`,
    segs: keys.map((k) => ({ pct: 100 * (st.trend[k] ?? 0), color: px.meta.codes[String(TIER_CODE[k])]?.color })),
  };
}

function RegionRow({ name, view, on, onToggle, indent = false }: { name: string; view: RowView; on: boolean; onToggle: () => void; indent?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded border p-2 text-left transition-colors ${indent ? 'pl-7' : ''} ${
        on ? 'border-border-strong bg-white' : 'border-transparent hover:bg-panel'
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-text-2">{view.sub}</span>
      </span>
      <ShareBar segs={view.segs} />
    </button>
  );
}

export function DistrictList({ loading = false }: { loading?: boolean }) {
  const data = useApp((s) => s.data);
  const district = useApp((s) => s.district);
  const country = useApp((s) => s.country);
  const toggle = useApp((s) => s.toggleDistrict);
  const px = useApp((s) => s.px);
  const resid = useApp((s) => s.resid) && hasResid(px);
  const rows = useMemo(() => (data ? districtRows(data.past) : null), [data]);
  /** a region's row: 1 km pixel shares when px/regions.json has it, else its 10/20 km cells */
  const viewOf = (d: string): RowView | null => {
    const st = px?.regions?.regions[d];
    if (px && st) return pxView(st, px, resid);
    const row = rows?.get(d);
    return row ? cellView(row) : null;
  };
  /** expanded state per country, by group key (Central Asia only) */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!data || !rows || loading) {
    return (
      <section className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-4 w-20 animate-pulse rounded-sm bg-panel" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-panel" />
        ))}
      </section>
    );
  }
  const groups = regionGroups();
  // One country (Naryn, or a chosen Central Asian country): a flat list of its regions.
  if (groups.length <= 1 || country) {
    return (
      <section className="flex flex-col gap-1" aria-labelledby="dist-label">
        <h2 id="dist-label" className="label-caps mb-1">{regionLabelPlural()}</h2>
        {(country ? regionsOf(country) : regionOrder()).map((d) => {
          const view = viewOf(d);
          if (!view) return null;
          return <RegionRow key={d} name={regionName(d)} view={view} on={district === d} onToggle={() => toggle(d)} />;
        })}
      </section>
    );
  }
  // Several countries: one collapsible group per country; the group of the active filter opens itself.
  return (
    <section className="flex flex-col gap-1" aria-labelledby="dist-label">
      <h2 id="dist-label" className="label-caps mb-1">{regionLabelPlural()}</h2>
      {groups.map((g) => {
        const list = g.codes.map((d) => rows.get(d)).filter((r): r is DistrictRow => !!r);
        if (!list.length) return null;
        const cst = px?.regions?.countries?.[g.key];
        const total = px && cst ? pxView(cst, px, resid) : cellView(countryRow(list));
        const pc = px && cst ? tierPercents(sharesFor(cst, resid)) : null;
        const expanded = open[g.key] ?? (!!district && g.codes.includes(district));
        const Icon = expanded ? ChevronDown : ChevronRight;
        const listId = `regions-${g.key}`;
        return (
          <div key={g.key} className="flex flex-col gap-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setOpen({ ...open, [g.key]: !expanded })}
              className="flex w-full items-center gap-2 rounded p-2 text-left transition-colors hover:bg-panel"
            >
              <Icon size={14} strokeWidth={1.5} className="flex-none text-text-2" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{g.countryName}</span>
                <span className="text-xs text-text-2">
                  {list.length} {list.length === 1 ? 'region' : 'regions'} · {pc && px ? `${pc.decline}% decline · ${pc.early_decline}% ${inlineLabel(px.meta, 2).split(' ')[0]}` : `${countryRow(list).dec}% decline`}
                </span>
              </span>
              <ShareBar segs={total.segs} />
            </button>
            {expanded && (
              <div id={listId} className="flex flex-col gap-1">
                {list.map((row) => (
                  <RegionRow key={row.d} name={regionName(row.d)} view={viewOf(row.d)!} on={district === row.d} onToggle={() => toggle(row.d)} indent />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Central Asia: "All Central Asia" or one country. Renders nothing for single-country datasets (Naryn). */
export function CountrySelect() {
  const data = useApp((s) => s.data);
  const country = useApp((s) => s.country);
  const setCountry = useApp((s) => s.setCountry);
  const id = useId();
  if (!data || !multiCountry()) return null;
  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={id} className="label-caps">
        Country
      </label>
      <select
        id={id}
        value={country ?? ''}
        onChange={(e) => setCountry(e.target.value || null)}
        className="h-control w-full rounded border border-border-strong bg-white px-2 text-sm coarse:h-touch"
        data-testid="country-select"
      >
        <option value="">All {studyTitle()}</option>
        {countries().map((g) => (
          <option key={g.key} value={g.key}>
            {g.countryName}
          </option>
        ))}
      </select>
    </section>
  );
}

export function Rail({ card, loading = false }: { card: Answer | null; loading?: boolean }) {
  return (
    <aside
      aria-label="Layers and filters"
      className="z-[5] flex w-rail flex-none flex-col gap-6 overflow-y-auto border-r border-hairline bg-surface p-4"
    >
      {!loading && <CountrySelect />}
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
