import { itemLabel, type Handout, type Item } from './types';

/** taps for the same person closer together than this are one hand-over (one "round") */
export const ROUND_GAP_MS = 5 * 60 * 1000;

/** Sum quantities per item, in item order: "ข้าวกล่อง 2 กล่อง · น้ำ 1 ขวด". */
export function summarize(rows: Pick<Handout, 'item_id' | 'qty'>[], items: Item[]) {
  const totals = new Map<number, number>();
  for (const r of rows) totals.set(r.item_id, (totals.get(r.item_id) ?? 0) + r.qty);
  const byId = new Map(items.map((i) => [i.id, i]));
  return [...totals]
    .sort(([a], [b]) => items.findIndex((i) => i.id === a) - items.findIndex((i) => i.id === b))
    .map(([id, qty]) => itemLabel(byId.get(id), qty))
    .join(' · ');
}

/** Group one person's handouts into rounds, oldest first. */
export function rounds<T extends Pick<Handout, 'created_at'>>(rows: T[]): { at: string; rows: T[] }[] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: { at: string; rows: T[] }[] = [];
  let lastTs = -Infinity;
  for (const r of sorted) {
    const ts = new Date(r.created_at).getTime();
    if (ts - lastTs > ROUND_GAP_MS) out.push({ at: r.created_at, rows: [] });
    out[out.length - 1].rows.push(r);
    lastTs = ts;
  }
  return out;
}
