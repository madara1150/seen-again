export interface Person {
  id: number;
  name: string;
  thumb_path: string | null;
  created_at: string;
  last_seen: string;
}

export interface PersonStats extends Person {
  visit_count: number;
  first_visit: string | null;
}

export interface Visit {
  id: number;
  person_id: number;
  started_at: string;
  ended_at: string;
  reports: number;
  thumb_path: string | null;
  camera: string | null;
  visit_no: number;
  gap_seconds: number | null;
}

export interface SightingResult {
  visit_id: number;
  visit_no: number;
  is_new: boolean;
  gap_seconds: number | null;
}

export const displayName = (p: Pick<Person, 'id' | 'name'>) => p.name.trim() || `บุคคล #${p.id}`;

export interface Item {
  id: number;
  name: string;
  unit: string;
  emoji: string;
  sort: number;
  archived: boolean;
}

export interface Handout {
  id: number;
  person_id: number;
  item_id: number;
  qty: number;
  camera: string | null;
  created_at: string;
}

export const itemLabel = (item: Pick<Item, 'name' | 'unit'> | null | undefined, qty: number) =>
  `${item?.name ?? 'ของที่ถูกลบ'} ${qty}${item?.unit ? ` ${item.unit}` : ''}`;
