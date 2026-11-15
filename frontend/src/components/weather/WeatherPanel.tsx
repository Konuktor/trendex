import { useId, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { ticks } from '../../lib/chart';
import { ord } from '../../lib/format';
import { pxScope, seasonLine, whatifScope, whatifValue, type PxExpected, type PxInfo, type PxWhatIf, type WhatIfEntry } from '../../lib/px';
import { useWidth } from '../../hooks/useWidth';
import { C } from '../../theme';

const MONTH_NAME: Record<number, string> = { 5: 'May', 6: 'June', 7: 'July', 8: 'August', 9: 'September' };
const DOT: Record<string, string> = { below: C.decStrong, above: C.incStrong, within: '#71717A' };

/** Y domain snapped to 0.05 that holds the observed series and the p10–p90 band. */
export function expectedDomain(e: PxExpected): [number, number] {
  const lo = Math.min(...e.p10, ...e.observed);
  const hi = Math.max(...e.p90, ...e.observed);
  return [Math.floor((lo - 0.005) * 20) / 20, Math.ceil((hi + 0.005) * 20) / 20];
}

/** Observed summer greenness against the weather-expected value and its 10th–90th percentile band. */
export function ExpectedChart({ e, width, height = 240, scopeName }: { e: PxExpected; width: number; height?: number; scopeName: string }) {
  const pl = 36;
  const pr = 12;
  const pt = 10;
  const pb = 26;
  const n = e.years.length;
  const d = expectedDomain(e);
  const X = scaleLinear().domain([e.years[0], e.years[n - 1]]).range([pl, width - pr]);
  const Y = scaleLinear().domain(d).range([height - pb, pt]);
  const idx = e.years.map((_, i) => i);
  const band = area<number>()
    .x((i) => X(e.years[i]))
    .y0((i) => Y(e.p10[i]))
    .y1((i) => Y(e.p90[i]))(idx)!;
  const obs = line<number>()
    .x((i) => X(e.years[i]))
    .y((i) => Y(e.observed[i]))(idx)!;
  const exp = line<number>()
    .x((i) => X(e.years[i]))
    .y((i) => Y(e.expected[i]))(idx)!;
  const yt = ticks(d, d[1] - d[0] > 0.25 ? 0.1 : 0.05);
  const xt = [2001, 2005, 2010, 2015, 2020, 2025].filter((y) => y >= e.years[0] && y <= e.years[n - 1]);
  const last = n - 1;
  const s = e.season;
  const label = `Observed and weather-expected summer greenness, ${scopeName}, ${e.years[0]} to ${e.years[last]}: ${e.years[last]} observed ${e.observed[last].toFixed(2)}, expected ${e.expected[last].toFixed(2)}${s ? `, ${s.class === 'within' ? 'within the usual range' : `${s.class} usual`} (${ord(Math.round(s.percentile))} percentile)` : ''}.`;
  const yObs = Y(e.observed[last]);
  const yExp = Y(e.expected[last]);
  const apart = Math.abs(yObs - yExp) >= 14;
  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="absolute left-0 top-0">
        <path d={yt.map((t) => `M${pl} ${Y(t).toFixed(1)}H${width - pr}`).join('')} stroke={C.grid} fill="none" />
        <path d={band} fill={C.nr} opacity={0.45} />
        <path d={exp} stroke="#525252" strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
        <path d={obs} stroke={C.text} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
        <circle cx={X(e.years[last])} cy={yObs} r={4} fill={s ? DOT[s.class] : C.text} stroke="#fff" strokeWidth={2} />
      </svg>
      {yt.map((t) => (
        <span key={t} aria-hidden="true" className="absolute left-0 text-xs text-text-3" style={{ top: Y(t) - 8 }}>
          {t.toFixed(2)}
        </span>
      ))}
      {xt.map((y) => (
        <span key={y} aria-hidden="true" className="absolute bottom-0 w-8 text-center text-xs text-text-3" style={{ left: X(y) - 16 }}>
          {y}
        </span>
      ))}
      <span aria-hidden="true" className="absolute bg-white px-0.5 text-xs font-medium" style={{ right: pr + 8, top: Math.max(0, yObs - (apart && yObs < yExp ? 22 : -6)) }}>
        Observed
      </span>
      {apart && (
        <span aria-hidden="true" className="absolute bg-white px-0.5 text-xs text-text-2" style={{ right: pr + 8, top: Math.max(0, yExp - (yExp < yObs ? 22 : -6)) }}>
          Expected from weather
        </span>
      )}
      <span aria-hidden="true" className="absolute text-2xs text-text-2" style={{ left: pl + 4, top: Math.max(2, Y(e.p90[1] ?? e.p90[0]) - 15) }}>
        {apart ? '10th–90th percentile of expected' : 'Dashed: expected from weather · band: 10th–90th percentile'}
      </span>
    </div>
  );
}

const signedNdvi = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(3)}`;

/** The meaning text without the sentence that repeats the label. */
export function meaningLines(meaning: string): string[] {
  return meaning
    .split(/(?<=\.)\s+/)
    .map((x) => x.trim())
    .filter((x) => x && !/not a causal effect/i.test(x));
}

/** What-if: expected NDVI for a month under changed precipitation and temperature (model sensitivity). */
export function WhatIfPanel({ w, e }: { w: PxWhatIf; e: WhatIfEntry }) {
  const [month, setMonth] = useState(w.months.includes(7) ? 7 : w.months[0]);
  const [precip, setPrecip] = useState(0);
  const [temp, setTemp] = useState(0);
  const id = useId();
  const v = whatifValue(w, e, month, precip, temp);
  const pMin = Math.min(...w.precip_pct);
  const pMax = Math.max(...w.precip_pct);
  const tMin = Math.min(...w.temp_c);
  const tMax = Math.max(...w.temp_c);
  const pStep = w.precip_pct.length > 1 ? w.precip_pct[1] - w.precip_pct[0] : 10;
  const tStep = w.temp_c.length > 1 ? w.temp_c[1] - w.temp_c[0] : 1;
  return (
    <div className="flex flex-col gap-4" data-testid="whatif">
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">What if the weather were different?</h2>
        <p className="text-sm font-medium">{w.label}</p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-m`} className="w-28 text-sm text-text-2">
          Month
        </label>
        <select
          id={`${id}-m`}
          value={month}
          onChange={(ev) => setMonth(Number(ev.target.value))}
          className="h-control flex-1 rounded border border-border-strong bg-white px-2 text-sm coarse:h-touch"
        >
          {w.months.map((m) => (
            <option key={m} value={m}>
              {MONTH_NAME[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-p`} className="w-28 text-sm text-text-2">
          Precipitation
        </label>
        <input
          id={`${id}-p`}
          type="range"
          min={pMin}
          max={pMax}
          step={pStep}
          value={precip}
          onChange={(ev) => setPrecip(Number(ev.target.value))}
          className="flex-1 accent-text"
          aria-valuetext={`${precip > 0 ? '+' : ''}${precip} percent`}
        />
        <output htmlFor={`${id}-p`} className="w-14 text-right text-sm">
          {precip > 0 ? '+' : precip < 0 ? '−' : ''}
          {Math.abs(precip)}%
        </output>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-t`} className="w-28 text-sm text-text-2">
          Temperature
        </label>
        <input
          id={`${id}-t`}
          type="range"
          min={tMin}
          max={tMax}
          step={tStep}
          value={temp}
          onChange={(ev) => setTemp(Number(ev.target.value))}
          className="flex-1 accent-text"
          aria-valuetext={`${temp > 0 ? '+' : ''}${temp} degrees`}
        />
        <output htmlFor={`${id}-t`} className="w-14 text-right text-sm">
          {temp > 0 ? '+' : temp < 0 ? '−' : ''}
          {Math.abs(temp)} °C
        </output>
      </div>
      {v ? (
        <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface p-3" aria-live="polite">
          <span className="text-sm text-text-2">Expected NDVI in {MONTH_NAME[month] ?? month}</span>
          <span className="text-lg font-semibold">{v.expected.toFixed(3)}</span>
          <span className="text-sm">
            {signedNdvi(v.change)} vs typical weather ({v.typical.toFixed(3)})
          </span>
        </div>
      ) : (
        <p className="text-sm text-text-2">No model value for this combination.</p>
      )}
      <div className="flex flex-col gap-1 text-xs text-text-2">
        {meaningLines(w.meaning).map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
    </div>
  );
}

/** The scope's weather-model view: observed vs expected chart, this summer's position and the what-if panel. */
export function WeatherSection({ px, district, country, scopeName }: { px: PxInfo; district: string | null; country: string | null; scopeName: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(700);
  const e = pxScope(px.regions, district, country)?.expected;
  const wi = whatifScope(px.whatif, district, country);
  if (!e && !wi) {
    return (
      <section id="weather" className="card scroll-mt-8 p-6 text-sm text-text-2">
        The weather model does not cover {scopeName}, so there is no weather-expected greenness here.
      </section>
    );
  }
  const line = seasonLine(e?.season);
  return (
    <section id="weather" className="grid scroll-mt-8 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-label="Weather model">
      <div className="card flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <h2 className="text-md font-semibold">Observed vs weather-expected (summer)</h2>
          <span className="text-xs text-text-2">May–Sep mean NDVI · {scopeName}</span>
        </div>
        {line && <p className="text-md font-medium">{line}.</p>}
        {e ? (
          <div ref={ref} className="w-full">
            <ExpectedChart e={e} width={Math.max(280, w)} scopeName={scopeName} />
          </div>
        ) : (
          <p className="text-sm text-text-2">No weather-expected series for this scope.</p>
        )}
        <p className="text-xs text-text-2">
          Expected: what the weather of each summer predicts{px.ml ? ` (${px.ml.model}, ${px.ml.version})` : ''}. The band holds the
          model’s 10th–90th percentile. A summer outside it differs from what the weather explains.
        </p>
      </div>
      {px.whatif && wi && (
        <div className="card p-4 md:p-6">
          <WhatIfPanel key={`${district ?? ''}|${country ?? ''}`} w={px.whatif} e={wi} />
        </div>
      )}
    </section>
  );
}
