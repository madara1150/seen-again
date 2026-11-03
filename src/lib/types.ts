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
