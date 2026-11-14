import { isReal } from '../../data/info';
import { AlertTriangle, Check, ChevronRight, Info, Plus, X } from 'lucide-react';
import { nearKm, type Answer, type BetterRow, type NonPastureAnswer, type PastureAnswer } from '../../lib/answer';
import { LEVEL_NAME, NOT_ACCOUNTED, TREND_NAME } from '../../lib/labels';
import { relativeNote } from '../../lib/regions';
import { ord } from '../../lib/format';
import { ConfidenceBadge, LevelChip, Swatch, TrendChip } from '../ui/Chips';
import { TrendChart } from './TrendChart';
import { TREND_STROKE } from '../../theme';

export interface CardActions {
  onClose: () => void;
  onPick: (id: string) => void;
  onQueue: () => void;
  queued: boolean;
}

function Section({ label, children, gap = 'gap-2' }: { label: string; children: React.ReactNode; gap?: string }) {
  return (
    <section className={`flex flex-col ${gap}`}>
      <h3 className="label-caps">{label}</h3>
      {children}
    </section>
  );
}

function NearRows({ rows, onPick }: { rows: BetterRow[]; onPick: (id: string) => void }) {
  return (
    <ul className="flex flex-col">
      {rows.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            onClick={() => onPick(b.id)}
            className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded p-2 text-left transition-colors hover:bg-panel"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{b.name}</span>
              <span className="flex items-center gap-1.5 text-xs text-text-2">
                <Swatch level={b.level} />
                {LEVEL_NAME[b.level]} ·
                <Swatch trend={b.trend} strong={b.strong} />
                {TREND_NAME[b.trend]}
              </span>
            </span>
            <span className="text-sm text-text-2">{b.km} km</span>
            <ChevronRight size={14} strokeWidth={1.5} className="text-text-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function LowBanner({ text }: { text: string }) {
  return (
    <div role="note" className="flex gap-2.5 rounded-lg border border-border-strong bg-panel p-3 text-sm">
      <AlertTriangle size={16} strokeWidth={1.5} className="mt-px flex-none" aria-hidden="true" />
      <span>
        <b className="font-semibold">Low confidence.</b> {text}
      </span>
    </div>
  );
}

/** Name-level summary: banner, chips, takeaway. Shown in the collapsed mobile sheet too. */
export function PastureSummary({ a }: { a: PastureAnswer }) {
  return (
    <>
      {a.conf === 'Low' && <LowBanner text={a.lowTxt} />}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
            <span className="label-caps">Level</span>
            <LevelChip level={a.level} />
            <span className="text-xs text-text-2">{ord(a.pct)} percentile of pastures</span>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
            <span className="label-caps">Trend</span>
            <TrendChip trend={a.trend} strong={a.strong} />
            <span className="text-xs text-text-2">{a.trSub}</span>
          </div>
        </div>
        <span className="text-xs text-text-2">{relativeNote()}</span>
      </div>
      <p className="text-md">{a.takeaway}</p>
    </>
  );
}

function PastureDetails({ a, act, chartWidth }: { a: PastureAnswer; act: CardActions; chartWidth: number }) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">{isReal() ? 'Summer greenness (NDVI, May–Sep mean)' : 'Peak-season greenness (NDVI)'}</h3>
          <span className="text-xs text-text-2">{isReal() ? '2000–2025 · NASA MODIS MOD13A3' : '2000–2025 · Sample data'}</span>
        </div>
        <TrendChart model={a.chart} trend={a.trend} width={chartWidth} />
      </section>
      <Section label="Why">
        <ul className="flex flex-col gap-2">
          {a.why.map(([s, t]) => (
            <li key={t} className="flex gap-2.5 text-sm">
              <span
                className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-sm border border-border-strong font-semibold leading-none"
                aria-label={s === '+' ? 'For' : 'Against'}
              >
                {s}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section label="This season">
        <div className="relative h-4" aria-hidden="true">
          <span className="absolute inset-x-0 top-[5px] h-1.5 rounded-[3px] bg-grid" />
          <span className="absolute top-[5px] h-1.5 bg-border-strong" style={{ left: `${a.season.iqL}%`, width: `${a.season.iqW}%` }} />
          <span
            className="absolute top-0.5 -ml-1.5 h-3 w-3 rounded-full shadow-[0_0_0_2px_#fff]"
            style={{ left: `${a.season.cur}%`, background: TREND_STROKE[a.trend] }}
          />
        </div>
        <div className="flex justify-between text-xs text-text-3" aria-hidden="true">
          <span>{a.season.min.toFixed(2)}</span>
          <span>usual range 2000–2024</span>
          <span>{a.season.max.toFixed(2)}</span>
        </div>
        <span className="text-sm">{a.season.text}</span>
      </Section>
      <Section label="Better nearby" gap="gap-1">
        {a.better.length ? (
          <NearRows rows={a.better} onPick={act.onPick} />
        ) : (
          <span className="text-sm text-text-2">No higher-scoring areas without a decline within {nearKm()} km.</span>
        )}
      </Section>
    </>
  );
}

export function NonPastureSummary({ a }: { a: NonPastureAnswer }) {
  const swatch =
    a.kind === 'excluded' ? (a.water ? 'bg-[#D9D9D9]' : 'bg-excluded') : a.kind === 'nodata' ? 'dots' : 'bg-white';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-hairline p-3">
        <span aria-hidden="true" className={`h-8 w-8 flex-none rounded-lg border border-border-strong ${swatch}`} />
        <span className="flex flex-col">
          <span className="font-medium">{a.reason}</span>
          <span className="text-xs text-text-2">{a.detail}</span>
        </span>
      </div>
      <p className="text-md">{a.head}</p>
    </div>
  );
}

function NonPastureDetails({ a, act }: { a: NonPastureAnswer; act: CardActions }) {
  return (
    <>
      <p className="text-sm text-text-2">{a.expl}</p>
      {a.nearest.length > 0 && (
        <Section label="Nearest pastures" gap="gap-1">
          <NearRows rows={a.nearest} onPick={act.onPick} />
        </Section>
      )}
    </>
  );
}

export function AnswerSummary({ a }: { a: Answer }) {
  return a.kind === 'pasture' ? <PastureSummary a={a} /> : <NonPastureSummary a={a} />;
}

export function AnswerDetails({ a, act, chartWidth = 352 }: { a: Answer; act: CardActions; chartWidth?: number }) {
  return (
    <>
      {a.kind === 'pasture' ? <PastureDetails a={a} act={act} chartWidth={chartWidth} /> : <NonPastureDetails a={a} act={act} />}
      <NextStep a={a} act={act} />
    </>
  );
}

export function AnswerCardHeader({ a, onClose, compact = false }: { a: Answer; onClose?: () => void; compact?: boolean }) {
  return (
    <div className={`flex flex-none flex-col gap-1 border-b border-hairline px-6 ${compact ? 'pb-3 pt-2' : 'pb-4 pt-5'}`}>
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-lg font-semibold">{a.name}</h2>
        <span className="mt-0.5">
          <ConfidenceBadge conf={a.conf} label={a.badge} />
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close answer card"
            className="-mr-2 -mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded text-text-2 hover:bg-panel coarse:h-touch coarse:w-touch"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>
      <span className="text-sm text-text-2">{a.sub}</span>
      {!compact && <span className="text-xs text-text-2">{a.coord}</span>}
    </div>
  );
}

export function NextStep({ a, act }: { a: Answer; act: CardActions }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <h3 className="label-caps">Suggested next step for the agency</h3>
      <p>{a.next}</p>
      <div className="flex items-center gap-3">
        {act.queued ? (
          <button key="queued" type="button" className="btn-secondary" onClick={act.onQueue}>
            <Check size={14} strokeWidth={1.5} aria-hidden="true" />
            In queue · undo
          </button>
        ) : (
          <button key="add" type="button" className="btn-primary" onClick={act.onQueue}>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {a.actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export function NotAccounted() {
  return (
    <div className="flex flex-none items-start gap-2 border-t border-hairline px-6 py-3 text-xs text-text-2">
      <Info size={14} strokeWidth={1.5} className="mt-px flex-none" aria-hidden="true" />
      <span>{NOT_ACCOUNTED}</span>
    </div>
  );
}

export function AnswerBody({ a, act }: { a: Answer; act: CardActions }) {
  return (
    <>
      <AnswerSummary a={a} />
      <AnswerDetails a={a} act={act} />
    </>
  );
}

export function AnswerCard({ a, act }: { a: Answer; act: CardActions }) {
  return (
    <aside
      aria-label="Answer card"
      className="absolute bottom-0 right-0 top-0 z-20 flex w-drawer flex-col border-l border-hairline bg-white shadow-drawer"
    >
      <AnswerCardHeader a={a} onClose={act.onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-5">
        <AnswerBody a={a} act={act} />
      </div>
      <NotAccounted />
    </aside>
  );
}

export function CardSkeleton() {
  return (
    <aside
      aria-label="Answer card loading"
      aria-busy="true"
      data-testid="card-skeleton"
      className="absolute bottom-0 right-0 top-0 z-20 flex w-drawer flex-col border-l border-hairline bg-white shadow-drawer"
    >
      <div className="flex flex-col gap-2 border-b border-hairline px-6 pb-4 pt-5">
        <div className="h-6 w-48 animate-pulse rounded-sm bg-panel" />
        <div className="h-4 w-64 animate-pulse rounded-sm bg-panel" />
      </div>
      <div className="flex flex-col gap-6 px-6 pt-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 animate-pulse rounded-lg bg-panel" />
          <div className="h-24 animate-pulse rounded-lg bg-panel" />
        </div>
        <div className="h-12 animate-pulse rounded-sm bg-panel" />
        <div className="h-[168px] animate-pulse rounded-lg bg-panel" />
        <div className="h-16 animate-pulse rounded-sm bg-panel" />
      </div>
    </aside>
  );
}
