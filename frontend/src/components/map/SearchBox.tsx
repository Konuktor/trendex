import { useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../../store';
import { noMatchText, parseSearch, searchPlaceholder, type Suggestion } from '../../lib/places';
import { DLON, toCell } from '../../lib/geo';

/** Select the zone under a point, or a small outline around it when no data cell is near. */
export function goTo(lon: number, lat: number) {
  const s = useApp.getState();
  if (!s.data) return;
  const k = toCell(lon, lat);
  let best = null;
  let bd = 1e9;
  for (const x of s.data.cells) {
    const dx = x.c + 0.5 - k.c;
    const dy = x.r + 0.5 - k.r;
    const dd = dx * dx + dy * dy;
    if (dd < bd) {
      bd = dd;
      best = x;
    }
  }
  if (s.drawing) s.setDrawing(false);
  if (best && bd < 9) {
    s.selectZone(best.id, true);
    if (s.px) s.setPixel({ lat, lon });
  }
  else {
    const e = 0.08 * (DLON / 0.12); // 0.08° on the Naryn grid, scaled with the cell size
    s.selectDrawn(
      [
        [lon - e, lat + e * 0.75],
        [lon + e, lat + e * 0.75],
        [lon + e, lat - e * 0.75],
        [lon - e, lat - e * 0.75],
      ],
      true,
    );
  }
}

export function SearchBox({ className = 'w-80' }: { className?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const meta = useApp((s) => s.meta); // places and copy follow the active dataset
  const list = useMemo(() => parseSearch(q), [q, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (s: Suggestion) => {
    setQ('');
    setOpen(false);
    goTo(s.lon, s.lat);
  };

  return (
    <form
      role="search"
      className={`relative ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (list[0]) pick(list[0]);
      }}
    >
      <label htmlFor={`${id}-q`} className="sr-only-label">
        Search a place or coordinates
      </label>
      <Search size={14} strokeWidth={1.5} className="pointer-events-none absolute left-2.5 top-[9px] text-text-2 coarse:top-[15px]" aria-hidden="true" />
      <input
        ref={inputRef}
        id={`${id}-q`}
        type="text"
        autoComplete="off"
        placeholder={searchPlaceholder()}
        value={q}
        aria-controls={`${id}-list`}
        aria-expanded={open && !!q.trim()}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            listRef.current?.querySelector('button')?.focus();
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-control w-full rounded border border-border-strong bg-white px-8 text-sm text-text placeholder:text-text-2 coarse:h-touch"
      />
      {open && q.trim() && (
        <div
          id={`${id}-list`}
          ref={listRef}
          className="absolute inset-x-0 top-9 z-10 flex flex-col rounded-lg border border-hairline bg-white p-1 shadow-float coarse:top-12"
          onKeyDown={(e) => {
            const btns = [...(listRef.current?.querySelectorAll('button') ?? [])];
            const i = btns.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              btns[Math.min(btns.length - 1, i + 1)]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (i <= 0) inputRef.current?.focus();
              else btns[i - 1]?.focus();
            } else if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.focus();
            }
          }}
        >
          {list.length ? (
            list.map((s) => (
              <button
                key={s.label + s.sub}
                type="button"
                onClick={() => pick(s)}
                className="flex h-9 items-center justify-between gap-3 rounded px-2 text-left text-sm hover:bg-panel focus-visible:bg-panel coarse:h-touch"
              >
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-text-2">{s.sub}</span>
              </button>
            ))
          ) : (
            <span className="p-2 text-sm text-text-2">{noMatchText()}</span>
          )}
        </div>
      )}
    </form>
  );
}
