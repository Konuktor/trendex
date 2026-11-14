import { useCallback, useEffect, useState } from 'react';

/**
 * Width of an element, kept current with a ResizeObserver.
 * Returns a callback ref, so it also works for elements that mount later.
 */
export function useWidth<T extends HTMLElement>(initial = 600) {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(initial);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w] as const;
}
