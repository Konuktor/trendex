import { NavLink } from 'react-router-dom';
import { Play } from 'lucide-react';

const TABS = [
  { to: '/map', label: 'Map' },
  { to: '/trends', label: 'Trends' },
  { to: '/queue', label: 'Inspection queue' },
  { to: '/methods', label: 'Methods & limits' },
];

export function TopBar({ onTour }: { onTour?: () => void }) {
  return (
    <header className="z-30 flex h-bar flex-none items-center gap-8 border-b border-hairline bg-white pl-5 pr-4">
      <NavLink to="/map" className="text-md font-semibold tracking-[-0.01em] text-text no-underline">
        TrendeX
      </NavLink>
      <nav aria-label="Main" className="flex gap-1 self-stretch">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `flex items-center px-3 text-base font-medium transition-colors ${
                isActive ? 'text-text shadow-[inset_0_-2px_0_#171717]' : 'text-text-2 hover:text-text'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-sm text-text-2">Naryn oblast · peak season 2000–2025</span>
        <span className="tag">Sample data</span>
        <button type="button" className="btn-secondary" onClick={onTour}>
          <Play size={14} strokeWidth={1.5} aria-hidden="true" />
          Demo tour
        </button>
      </div>
    </header>
  );
}
