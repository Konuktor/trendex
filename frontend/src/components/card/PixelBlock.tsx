import { useEffect, useState } from 'react';
import { useApp } from '../../store';
import { getPixel, outlineStats } from '../../data/px';
import {
  fillGaps,
  isMaskCode,
  isPastureCode,
  shortLabel,
  TIER_CODE,
  TIER_KEYS,
  tierPercents,
  tierTrend,
  type OutlineStats,
  type PixelInfo,
  type PxInfo,
  type PxMeta,
  type TierKey,
} from '../../lib/px';
import { fit } from '../../lib/series';
import { avg, num, signed } from '../../lib/format';
import { regionName } from '../../lib/regions';
import { TrendChart } from './TrendChart';
import { useWidth } from '../../hooks/useWidth';
import type { ChartModel } from '../../lib/chart';
import type { LonLat, Trend } from '../../lib/types';

/** Chart model for a pixel's own series: its Theil–Sen slope, with the OLS interval of the series as the band. */
export function pixelChart(p: PixelInfo): { model: ChartModel; trend: Trend } | null {
  const values = fillGaps(p.series);
  if (!values) return null;
  const f = fit(values);
  const known = p.series.filter((x) => x !== null).length;
  const slope = p.slopeDecade !== null ? Math.round(p.slopeDecade) / 10 : Math.round(f.sp * 10) / 10;
  return {
    model: { values, base: avg(values, (x) => x), slope, w: Math.max(0.1, Math.round(f.ci * 10) / 10), cov: known / p.series.length },
    trend: tierTrend(p.code),
  };
}

const fmtP = (v: number | null) => (v === null ? '' : v === 0 ? 'p < 0.004' : `p = ${v.toFixed(3)}`);
const fmtQ = (v: number | null) => (v === null ? '' : v === 0 ? 'q < 0.004' : `q = ${v.toFixed(2)}`);

/** One sentence on the pixel's trend tier; tiers 2 and 4 use the export's label ("Possible decline") and say why. */
export function tierSentence(p: PixelInfo, meta?: PxMeta): string {
  const slope = p.slopeDecade === null ? '' : `${signed(p.slopeDecade)}% per decade`;
  const stat = [slope, fmtP(p.p)].filter(Boolean).join(', ');
  switch (p.code) {
    case 1:
    case 5:
      return `${p.code === 1 ? 'Reliable decline' : 'Reliable growth'}: ${stat}. It passes the correction for testing every pixel${p.q !== null ? ` (${fmtQ(p.q)})` : ''}.`;
    case 2:
    case 4:
      return `${(meta && shortLabel(meta, p.code)) || (p.code === 2 ? 'Possible decline' : 'Possible growth')}: ${stat}. Not yet reliable: it does not pass the correction for testing every pixel${p.q !== null ? ` (${fmtQ(p.q)})` : ''}.`;
    case 3:
      return `No reliable trend${stat ? `: ${stat}` : ''}. Year-to-year swings are larger than any direction.`;
    case 6:
      return 'Not enough clear seasons for a trend at this pixel.';
    default:
      return '';
  }
}

function Swatch({ color }: { color?: string }) {
  return <span aria-hidden="true" className="h-3 w-3 flex-none rounded-[3px] border border-hairline" style={{ background: color }} />;
}

function Body({ px, p, width }: { px: PxInfo; p: PixelInfo; width: number }) {
  const code = (c: number) => px.meta.codes[String(c)];
  if (p.code === 47 || p.code === 6) {
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Swatch color={code(p.code)?.color} />
          {code(p.code)?.label ?? 'Not enough data'}
        </span>
        <span className="text-xs text-text-2">
          Too few clear seasons at this pixel to give a level or trend{p.region ? ` · ${regionName(p.region)}` : ''}.
        </span>
      </div>
    );
  }
  if (isMaskCode(p.code)) {
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Swatch color={code(p.code)?.color} />
          Not pasture: {code(p.code)?.label ?? 'masked'}
        </span>
        <span className="text-xs text-text-2">Masked pixels have no level or trend{p.region ? ` · ${regionName(p.region)}` : ''}.</span>
      </div>
    );
  }
  if (!isPastureCode(p.code)) return null;
  const chart = pixelChart(p);
  const lv = code(p.levelCode);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Swatch color={code(p.code)?.color} />
          {code(p.code)?.label}
        </span>
        {lv && p.levelCode >= 21 && p.levelCode <= 23 && (
          <span className="flex items-center gap-1.5">
            <Swatch color={lv.color} />
            {lv.label}
          </span>
        )}
      </div>
      <span className="text-xs text-text-2">
        {p.score !== null ? `Score ${p.score} of 100` : 'No score'}
        {p.region ? ` · ${regionName(p.region)}` : ''}
      </span>
      <p className="text-sm">{tierSentence(p, px.meta)}</p>
      {chart && (
        <TrendChart
          model={chart.model}
          trend={chart.trend}
          width={width}
          height={132}
          labels={false}
          title="Summer greenness (NDVI) of this 1 km pixel"
        />
      )}
    </div>
  );
}

/** Shares of the 1 km pixels inside a drawn outline (counted from the chunks it covers). */
function OutlineBlock({ px, poly }: { px: PxInfo; poly: LonLat[] }) {
  const [got, setGot] = useState<{ poly: LonLat[]; r: OutlineStats | 'too-large' | null } | null>(null);
  useEffect(() => {
    let live = true;
    outlineStats(px, poly).then(
      (r) => live && setGot({ poly, r }),
      () => live && setGot({ poly, r: null }),
    );
    return () => {
      live = false;
    };
  }, [px, poly]);
  const r = got?.poly === poly ? got.r : undefined;
  const km = (n: number) => num(Math.round(n * (r && r !== 'too-large' ? r.pixelKm2 : 0)));
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-hairline p-3" aria-labelledby="px-outline" data-testid="outline-pixels">
      <h3 id="px-outline" className="label-caps">1 km pixels inside the outline</h3>
      {r === undefined ? (
        <div className="h-10 animate-pulse rounded-sm bg-panel" aria-busy="true" />
      ) : r === 'too-large' ? (
        <p className="text-sm text-text-2">The outline is too large to count single pixels here. Draw an area smaller than about 500 × 500 km.</p>
      ) : !r || !r.pasture ? (
        <p className="text-sm text-text-2">No 1 km pasture pixels inside the outline.</p>
      ) : (
        (() => {
          const pc = tierPercents({ trend: Object.fromEntries(TIER_KEYS.map((k) => [k, r.tiers[k] / r.pasture])) as Record<TierKey, number> });
          const keys = TIER_KEYS.filter((k) => k !== 'insufficient' || r.tiers.insufficient > 0);
          // "Not enough data" outside pasture (code 47) is no data, not a land-cover mask: listed on its own.
          const masked = Object.entries(r.masked).filter(([k, n]) => n > 0 && k !== 'insufficient').sort((a, b) => b[1] - a[1]);
          const nodata = r.masked.insufficient ?? 0;
          const label = (key: string) => Object.values(px.meta.codes).find((c) => c.key === key)?.label ?? key;
          return (
            <>
              <span className="text-sm">
                {num(r.pasture)} pasture pixels · {km(r.pasture)} km² of pasture
              </span>
              <span className="flex h-2 w-full gap-px overflow-hidden rounded-xs" aria-hidden="true">
                {keys.map((k) => (
                  <span key={k} style={{ width: `${(100 * r.tiers[k]) / r.pasture}%`, background: px.meta.codes[String(TIER_CODE[k])]?.color }} />
                ))}
              </span>
              <ul className="flex flex-col gap-1">
                {keys.map((k) => (
                  <li key={k} className="flex items-center gap-2 text-xs text-text-2">
                    <Swatch color={px.meta.codes[String(TIER_CODE[k])]?.color} />
                    <span className="flex-1">{shortLabel(px.meta, TIER_CODE[k])}</span>
                    <b className="font-medium text-text">{pc[k]}%</b>
                  </li>
                ))}
              </ul>
              {masked.length > 0 && (
                <span className="text-xs text-text-2">
                  Not pasture inside: {masked.map(([k, n]) => `${label(k).toLowerCase()} ${km(n)} km²`).join(', ')}.
                  {nodata > 0 ? ` Not enough data: ${km(nodata)} km².` : ''}
                </span>
              )}
            </>
          );
        })()
      )}
    </section>
  );
}

/** "This 1 km pixel": the clicked pixel's own class, score, slope, p and 26-year series (from its chunk). */
export function PixelBlock() {
  const px = useApp((s) => s.px);
  const pt = useApp((s) => s.pixel);
  const sel = useApp((s) => s.sel);
  const [got, setGot] = useState<{ key: string; p: PixelInfo | null } | null>(null);
  const [ref, w] = useWidth<HTMLElement>(326);
  const key = pt ? `${pt.lat},${pt.lon}` : '';
  useEffect(() => {
    if (!px || !pt) return;
    let live = true;
    getPixel(px, pt.lat, pt.lon).then(
      (p) => live && setGot({ key: `${pt.lat},${pt.lon}`, p }),
      () => live && setGot({ key: `${pt.lat},${pt.lon}`, p: null }),
    );
    return () => {
      live = false;
    };
  }, [px, pt]);
  if (!px) return null;
  if (sel?.type === 'drawn' && sel.poly.length >= 3) return <OutlineBlock px={px} poly={sel.poly} />;
  return (
    <section ref={ref} className="flex flex-col gap-2 rounded-lg border border-hairline p-3" aria-labelledby="px-block" data-testid="pixel-block">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="px-block" className="label-caps">This 1 km pixel</h3>
        {pt && (
          <span className="text-xs text-text-2">
            {pt.lat.toFixed(3)}°N, {pt.lon.toFixed(3)}°E
          </span>
        )}
      </div>
      {!pt ? (
        <p className="text-sm text-text-2">Click the map to see a single 1 km pixel: its trend tier, level and its own 2000–2025 series.</p>
      ) : !got || got.key !== key ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-4 w-48 animate-pulse rounded-sm bg-panel" />
          <div className="h-24 animate-pulse rounded-sm bg-panel" />
        </div>
      ) : got.p ? (
        <Body px={px} p={got.p} width={Math.max(220, w - 26)} />
      ) : (
        <p className="text-sm text-text-2">No 1 km pixel here: the point is outside the 1 km layer.</p>
      )}
    </section>
  );
}
