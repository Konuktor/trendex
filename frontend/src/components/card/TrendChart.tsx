import { isReal } from '../../data/info';
import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { bandAt, ticks, trendAt, yDomain, type ChartModel } from '../../lib/chart';
import { signed } from '../../lib/format';
import { FIRST_YEAR, YEARS } from '../../lib/noise';
import type { Trend } from '../../lib/types';
import { C, TREND_BAND, TREND_STROKE, TREND_TEXT } from '../../theme';

interface Props {
  model: ChartModel;
  trend: Trend;
  width?: number;
  height?: number;
  domain?: [number, number];
  /** direct labels: trend, 2025 value, interval */
  labels?: boolean;
  xTicks?: number[];
  title?: string;
}

const IDX = Array.from({ length: YEARS }, (_, i) => i);

export function TrendChart({
  model,
  trend,
  width = 352,
  height = 168,
  domain,
  labels = true,
  xTicks = [0, 5, 10, 15, 20, 25],
  title = isReal() ? 'Summer greenness' : 'Peak-season greenness',
}: Props) {
  const pl = 36;
  const pr = 10;
  const pt = 10;
  const pb = 26;
  const d = domain ?? yDomain(model);
  const X = scaleLinear().domain([0, YEARS - 1]).range([pl, width - pr]);
  const Y = scaleLinear().domain(d).range([height - pb, pt]);
  const stroke = TREND_STROKE[trend];
  const cur = model.values[YEARS - 1];
  const band = area<number>()
    .x((i) => X(i))
    .y0((i) => Y(trendAt(model, i) - bandAt(model, i)))
    .y1((i) => Y(trendAt(model, i) + bandAt(model, i)))(IDX)!;
  const series = line<number>()
    .x((i) => X(i))
    .y((i) => Y(model.values[i]))(IDX)!;
  const yt = ticks(d, height < 160 ? 0.1 : 0.05);
  const label = `${title} ${FIRST_YEAR} to ${FIRST_YEAR + YEARS - 1}: trend ${signed(model.slope)} percent per year; ${
    FIRST_YEAR + YEARS - 1
  } value ${cur.toFixed(2)}.`;
  const curY = Y(cur);
  const up = trend === 'inc';
  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="absolute left-0 top-0">
        <path d={yt.map((t) => `M${pl} ${Y(t).toFixed(1)}H${width - pr}`).join('')} stroke={C.grid} fill="none" />
        <path d={band} fill={TREND_BAND[trend]} opacity={0.45} />
        <path
          d={`M${X(0)} ${Y(trendAt(model, 0))}L${X(YEARS - 1)} ${Y(trendAt(model, YEARS - 1))}`}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="none"
        />
        <path d={series} stroke={C.text} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
        <circle cx={X(YEARS - 1)} cy={curY} r={4} fill={stroke} stroke="#fff" strokeWidth={2} />
      </svg>
      {yt.map((t) => (
        <span key={t} aria-hidden="true" className="absolute left-0 text-xs text-text-3" style={{ top: Y(t) - 8 }}>
          {t.toFixed(2)}
        </span>
      ))}
      {xTicks.map((i) => (
        <span key={i} aria-hidden="true" className="absolute bottom-0 w-8 text-center text-xs text-text-3" style={{ left: X(i) - 16 }}>
          {FIRST_YEAR + i}
        </span>
      ))}
      {labels && (
        <>
          <span
            aria-hidden="true"
            className="absolute right-2.5 bg-white px-0.5 text-xs font-medium"
            style={{ top: up ? height - pb - 20 : 2, color: TREND_TEXT[trend] }}
          >
            Trend {signed(model.slope)}% / yr
          </span>
          <span
            aria-hidden="true"
            className="absolute bg-white px-0.5 text-xs"
            style={{
              left: X(YEARS - 1) - 74,
              top: up ? Math.max(2, curY - 26) : Math.min(height - pb - 18, curY + 8),
            }}
          >
            2025: {cur.toFixed(2)}
          </span>
          <span
            aria-hidden="true"
            className="absolute text-2xs normal-case tracking-normal text-text-2"
            style={{
              left: pl + 4,
              top: Math.max(2, Math.min(height - pb - 16, Y(trendAt(model, 1) + bandAt(model, 1)) - 15)),
            }}
          >
            95% interval
          </span>
        </>
      )}
    </div>
  );
}
