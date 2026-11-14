import { useApp } from '../store';
import { NavLink } from 'react-router-dom';
import { Play } from 'lucide-react';

const TABS = [
  { to: '/map', label: 'Map', short: 'Map' },
  { to: '/trends', label: 'Trends', short: 'Trends' },
  { to: '/queue', label: 'Inspection queue', short: 'Queue' },
  { to: '/methods', label: 'Methods & limits', short: 'Methods' },
];

function Tabs({ mobile }: { mobile?: boolean }) {
  return (
    <nav aria-label="Main" className={`flex gap-1 self-stretch ${mobile ? 'h-10 overflow-x-auto border-b border-hairline px-2 md:hidden' : 'hidden md:flex'}`}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
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

export function TopBar({ onTour }: { onTour?: () => void }) {
  const real = useApp((s) => s.real);
  return (
    <header className="z-30 flex flex-none flex-col bg-white">
      <div className="flex h-bar items-center gap-8 border-b border-hairline pl-5 pr-4">
        <NavLink to="/map" className="text-md font-semibold tracking-[-0.01em] text-text no-underline">
          TrendeX
        </NavLink>
        <Tabs />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-text-2 lg:inline">
            {real ? 'Naryn oblast · summer 2000–2025 · NASA MODIS' : 'Naryn oblast · peak season 2000–2025'}
          </span>
          {!real && <span className="tag">Sample data</span>}
          <button type="button" className="btn-secondary" onClick={onTour} data-tour="tour-button">
            <Play size={14} strokeWidth={1.5} aria-hidden="true" />
            Demo tour
          </button>
        </div>
      </div>
      <Tabs mobile />
    </header>
  );
}
