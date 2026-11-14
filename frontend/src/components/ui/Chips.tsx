import type { Confidence, Level, Trend } from '../../lib/types';
import { LEVEL_NAME, TREND_NAME } from '../../lib/labels';
import { LEVEL_BG, LEVEL_FG, trendColor } from '../../theme';

export function LevelChip({ level, size = 'md' }: { level: Level; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex items-center self-start whitespace-nowrap rounded font-medium ${size === 'sm' ? 'h-5 px-1.5 text-xs' : 'h-6 px-2 text-sm'}`}
      style={{ background: LEVEL_BG[level], color: LEVEL_FG[level] }}
    >
      {LEVEL_NAME[level]}
    </span>
  );
}

export function TrendChip({
  trend,
  strong,
  size = 'md',
  label,
}: {
  trend: Trend;
  strong: boolean;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const fg = trend !== 'nr' && strong ? '#FFFFFF' : '#171717';
  return (
    <span
      className={`inline-flex items-center gap-1.5 self-start whitespace-nowrap rounded font-medium ${size === 'sm' ? 'h-5 px-1.5 text-xs' : 'h-6 px-2 text-sm'}`}
      style={{ background: trendColor(trend, strong), color: fg }}
    >
      {trend === 'nr' && <span aria-hidden="true" className="hatch-light h-2.5 w-2.5 rounded-xs shadow-[0_0_0_1px_#A1A1AA]" />}
      {label ?? TREND_NAME[trend]}
    </span>
  );
}

export function ConfidenceBars({ conf }: { conf: Confidence | 'none' }) {
  const n = conf === 'High' ? 3 : conf === 'Medium' ? 2 : conf === 'Low' ? 1 : 0;
  return (
    <span className="flex h-2.5 items-end gap-0.5" aria-hidden="true">
      {[4, 7, 10].map((h, i) => (
        <i key={h} className={`block w-[3px] rounded-[1px] ${n > i ? 'bg-text' : 'bg-border-strong'}`} style={{ height: h }} />
      ))}
    </span>
  );
}

export function ConfidenceBadge({ conf, label }: { conf: Confidence | 'none'; label: string }) {
  return (
    <span className="flex h-6 flex-none items-center gap-1.5 rounded border border-border-strong px-2 text-xs font-medium">
      <ConfidenceBars conf={conf} />
      {label}
    </span>
  );
}

/** Small square swatch used in rows and legends. */
export function Swatch({ trend, strong, level, size = 8 }: { trend?: Trend; strong?: boolean; level?: Level; size?: number }) {
  const style = { width: size, height: size };
  if (level) return <span aria-hidden="true" className="inline-block flex-none rounded-xs shadow-[0_0_0_1px_rgba(0,0,0,.08)]" style={{ ...style, background: LEVEL_BG[level] }} />;
  if (trend === 'nr') return <span aria-hidden="true" className="hatch inline-block flex-none rounded-xs" style={style} />;
  return <span aria-hidden="true" className="inline-block flex-none rounded-xs" style={{ ...style, background: trendColor(trend!, !!strong) }} />;
}
