import { useApp } from '../store';
import { NavLink, useSearchParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { DATASETS, DATASET_LABEL, DATASET_SHORT, HAS_DATASETS } from '../data/dataset';
import { drawApi } from './map/MapView';
import type { DatasetId } from '../lib/types';

const TABS = [
  { to: '/map', label: 'Map', short: 'Map' },
  { to: '/trends', label: 'Trends', short: 'Trends' },
  { to: '/queue', label: 'Inspection queue', short: 'Queue' },
  { to: '/methods', label: 'Methods & limits', short: 'Methods' },
];

/** ?ds=ca&country=KAZ for links, so moving between pages keeps the dataset and the country. */
export function useDatasetSearch(): string {
  const dataset = useApp((s) => s.dataset);
  const country = useApp((s) => s.country);
  if (!HAS_DATASETS || dataset === 'naryn') return '';
  return `?ds=${dataset}${country ? `&country=${encodeURIComponent(country)}` : ''}`;
}

function Tabs({ mobile }: { mobile?: boolean }) {
  const search = useDatasetSearch();
  return (
    <nav aria-label="Main" className={`flex gap-1 self-stretch ${mobile ? 'h-10 overflow-x-auto border-b border-hairline px-2 md:hidden' : 'hidden md:flex'}`}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={{ pathname: t.to, search }}
          className={({ isActive }) =>
            `flex flex-none items-center px-3 text-base font-medium transition-colors ${
              isActive ? 'text-text shadow-[inset_0_-2px_0_#171717]' : 'text-text-2 hover:text-text'
            }`
          }
        >
          {mobile ? t.short : t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Params that point into one dataset and are dropped when switching. */
const DATASET_PARAMS = ['area', 'outline', 'scope', 'state', 'country'];

/** Segmented control: Naryn pilot / Central Asia. Shown only on real data. */
export function DatasetSwitch() {
  const dataset = useApp((s) => s.dataset);
  const setDataset = useApp((s) => s.setDataset);
  const [params, setParams] = useSearchParams();
  if (!HAS_DATASETS) return null;
  const pick = (ds: DatasetId) => {
    if (ds === dataset) return;
    if (useApp.getState().drawing) drawApi.current?.cancel();
    const next = new URLSearchParams(params);
    DATASET_PARAMS.forEach((k) => next.delete(k));
    if (ds === 'naryn') next.delete('ds');
    else next.set('ds', ds);
    // URL and store change in the same tick, so no page reads a stale ?area= against the new data.
    setParams(next, { replace: true });
    setDataset(ds);
  };
  return (
    <>
      {/* Phones: a compact select, so the bar keeps room for the Sample data tag. */}
      <label className="md:hidden">
        <span className="sr-only-label">Dataset</span>
        <select
          value={dataset}
          onChange={(e) => pick(e.target.value === 'ca' ? 'ca' : 'naryn')}
          className="h-control rounded border border-border-strong bg-white px-2 text-sm coarse:h-touch"
        >
          {DATASETS.map((ds) => (
            <option key={ds} value={ds}>
              {DATASET_SHORT[ds]}
            </option>
          ))}
        </select>
      </label>
    <div role="group" aria-label="Dataset" className="hidden h-control flex-none grid-cols-2 gap-0.5 rounded border border-hairline bg-seg p-0.5 md:grid" data-testid="dataset-switch">
      {DATASETS.map((ds) => (
        <button
          key={ds}
          type="button"
          aria-pressed={dataset === ds}
          onClick={() => pick(ds)}
          className={`whitespace-nowrap rounded-sm px-2.5 text-sm font-medium transition-colors ${
            dataset === ds ? 'bg-white text-text shadow-hair' : 'text-text-2 hover:text-text'
          }`}
        >
          {DATASET_LABEL[ds]}
        </button>
      ))}
    </div>
    </>
  );
}

export function TopBar({ onTour }: { onTour?: () => void }) {
  const real = useApp((s) => s.real);
  const dataset = useApp((s) => s.dataset);
  const meta = useApp((s) => s.meta);
  const title = meta?.title ?? (dataset === 'ca' ? 'Central Asia' : 'Naryn oblast');
  const search = useDatasetSearch();
  return (
    <header className="z-30 flex flex-none flex-col bg-white">
      <div className="flex h-bar items-center gap-8 border-b border-hairline pl-5 pr-4">
        <NavLink to={{ pathname: '/map', search }} className="text-md font-semibold tracking-[-0.01em] text-text no-underline">
          TrendeX
        </NavLink>
        <Tabs />
        <div className="ml-auto flex items-center gap-3">
          <DatasetSwitch />
          <span className={`hidden text-sm text-text-2 ${HAS_DATASETS ? 'xl:inline' : 'lg:inline'}`}>
            {real ? `${title} · summer 2000–2025 · NASA MODIS` : `${title} · peak season 2000–2025`}
          </span>
          {!real && <span className="tag">Sample data</span>}
          {dataset === 'naryn' && (
            <button type="button" className="btn-secondary" onClick={onTour} data-tour="tour-button">
              <Play size={14} strokeWidth={1.5} aria-hidden="true" />
              Demo tour
            </button>
          )}
        </div>
      </div>
      <Tabs mobile />
    </header>
  );
}
