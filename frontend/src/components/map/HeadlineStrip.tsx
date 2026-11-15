import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../store';
import { headline, scopeCells } from '../../lib/stats';
import { countryName, regionLabel, regionName, studyTitle } from '../../lib/regions';
import { hasResid, inlineLabel, layerInlineLabel, pxScope, sharesFor, TIER_CODE, tierPercents, type PxInfo, type PxStats, type TierKey } from '../../lib/px';
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
  const country = useApp((s) => s.country);
  const setCountry = useApp((s) => s.setCountry);
  const h = useMemo(() => (data ? headline(scopeCells(data.past, district, country)) : null), [data, district, country]);
  const px = useApp((s) => s.px);
  const resid = useApp((s) => s.resid) && hasResid(px);
  const pxStats0 = pxScope(px?.regions, district, country);
  const pxStats = pxStats0 ? sharesFor(pxStats0, resid) : null;
  return (
    <div className="z-[4] flex h-strip flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-b border-hairline bg-white px-6 text-sm text-text-2">
      {h && !loading ? (
        <>
          {px && pxStats ? (
            // The share list gives way first, so the scope and the filter chips (with their clear buttons) stay visible.
            // Items wrap into a hidden second line instead of being cut mid-word; the remainders come last.
            <span className="flex h-5 min-w-0 shrink flex-wrap items-center gap-x-4 overflow-hidden">
              {resid && <span className="flex h-5 flex-none items-center font-medium text-text">Beyond weather:</span>}
              <PxShares px={px} st={pxStats} resid={resid} />
            </span>
          ) : (
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
            </>
          )}
          {px && pxStats ? (
            // A chip already names a chosen country or region: the label then only gives the area.
            <span className="flex-none text-text-2">
              {district || country ? '' : `${studyTitle()} · `}
              {num(Math.round(pxStats.pasture_km2))} km² of pasture
            </span>
          ) : (
            <span className="text-text-2">
              {district ? regionName(district) : country ? countryName(country) : studyTitle()} · {num(h.km2)} km² of pasture
            </span>
          )}
          {country && <FilterChip label={countryName(country)} clearLabel="Show all countries" onClear={() => setCountry(null)} />}
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

/** Display order of the tiers in the strip; "not enough data" only when it covers any area. */
const STRIP: TierKey[] = ['decline', 'early_decline', 'early_growth', 'growth', 'stable', 'insufficient'];

/** Shares of pasture area by trend tier, from the 1 km pixels (px/regions.json). */
function PxShares({ px, st, resid = false }: { px: PxInfo; st: PxStats; resid?: boolean }) {
  const pc = tierPercents(st);
  const keys = STRIP.filter((k) => k !== 'insufficient' || st.trend.insufficient > 0);
  return (
    <>
      {keys.map((k) => (
        <span key={k} className="flex h-5 items-center">
          <span>
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] border border-hairline align-[-1px]"
              style={{ background: px.meta.codes[String(TIER_CODE[k])]?.color }}
            />
            <b className="font-medium text-text">{pc[k]}%</b> {layerInlineLabel(px.meta, TIER_CODE[k], resid)}
          </span>
        </span>
      ))}
    </>
  );
}

/** Compact headline for the mobile Layers sheet. */
export function HeadlineSummary() {
  const data = useApp((s) => s.data);
  const district = useApp((s) => s.district);
  const country = useApp((s) => s.country);
  const px = useApp((s) => s.px);
  const resid = useApp((s) => s.resid) && hasResid(px);
  const h = useMemo(() => (data ? headline(scopeCells(data.past, district, country)) : null), [data, district, country]);
  if (!h) return null;
  const st0 = pxScope(px?.regions, district, country);
  const st = st0 ? sharesFor(st0, resid) : null;
  if (px && st) {
    const pc = tierPercents(st);
    const l = (k: TierKey) => inlineLabel(px.meta, TIER_CODE[k]);
    return (
      <p className="text-sm text-text-2">
        {resid ? 'Beyond weather: ' : ''}
        <b className="font-medium text-text">{pc.decline}%</b> {l('decline')} · <b className="font-medium text-text">{pc.early_decline}%</b> {l('early_decline')} ·{' '}
        <b className="font-medium text-text">{pc.early_growth}%</b> {l('early_growth')} · <b className="font-medium text-text">{pc.growth}%</b> {l('growth')}.{' '}
        {district ? regionName(district) : country ? countryName(country) : studyTitle()} · {num(Math.round(st.pasture_km2))} km² of pasture (1 km pixels).
      </p>
    );
  }
  return (
    <p className="text-sm text-text-2">
      <b className="font-medium text-text">{h.dec}%</b> reliable decline · <b className="font-medium text-text">{h.inc}%</b>{' '}
      reliable growth · <b className="font-medium text-text">{h.nr}%</b> not reliable. {district ? regionName(district) : country ? countryName(country) : studyTitle()} ·{' '}
      {num(h.km2)} km² of pasture.
    </p>
  );
}
