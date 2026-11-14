import { answer, type Answer } from './answer';
import { selectDrawn, selectZone } from './zones';
import type { DataSet, Layer, LonLat, Selection } from './types';

export type SelectionInput = { type: 'zone'; id: string } | { type: 'drawn'; poly: LonLat[] } | null;

export function resolveSelection(data: DataSet, ref: SelectionInput, layer: Layer): Selection | null {
  if (!ref) return null;
  if (ref.type === 'zone') return selectZone(data, ref.id, layer);
  if (ref.poly.length < 3) return null;
  return selectDrawn(data, ref.poly);
}

export function resolveAnswer(data: DataSet, ref: SelectionInput, layer: Layer): { sel: Selection; card: Answer } | null {
  const sel = resolveSelection(data, ref, layer);
  return sel ? { sel, card: answer(sel, data) } : null;
}
