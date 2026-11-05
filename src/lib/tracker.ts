'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FaceApi } from './faceapi';
import type { Settings } from './settings';
import { uploadThumb } from './thumbs';
import { displayName, type SightingResult } from './types';

const REPORT_INTERVAL = 3000;   // ms between sighting reports per person while in view
const PROMOTE_HITS = 3;         // frames an unknown face must appear in before it is registered
const PENDING_TTL = 3000;       // ms before an unconfirmed unknown face is dropped
const MAX_DESCRIPTORS = 20;     // reference samples kept per person
const REFRESH_INTERVAL = 20000; // ms between reloads of known faces (picks up other cameras / renames)
const REDESCRIBE_MS = 1000;     // re-check identity of an already-recognised face this often
const TRACK_IOU = 0.3;          // min box overlap to treat a detection as the same face as last frame
const MAX_MISSES = 2;           // frames a face may be missed before its track is dropped
const PAGE = 1000;

interface Box { x: number; y: number; width: number; height: number }

export interface Detection { box: Box; score: number }

export interface FaceResult {
  detection: Detection;
  descriptor: Float32Array;
}

/** a face followed across frames by box overlap, so it only needs a descriptor now and then */
interface Track {
  box: Box;
  personId: number | null;
  /** a face on the block list: never registered, reported or photographed */
  blocked: boolean;
  text: string;
  lastDescribed: number;
  misses: number;
}

export interface FaceLabel { box: Box; known: boolean; text: string; personId?: number; blocked?: boolean }

export interface PresentPerson { id: number; name: string; thumbPath: string | null }

export interface TrackerEvent {
  key: string;
  personId: number;
  name: string;
  visitNo: number;
  gapSeconds: number | null;
  thumbUrl?: string;
  thumbPath?: string | null;
  at: number;
}

interface Known {
  id: number;
  name: string;
  thumbPath: string | null;
  descriptors: Float32Array[];
  visitNo: number;
  lastReport: number;
  reporting: boolean;
  addingDescriptor: boolean;
}

interface Pending {
  descriptors: Float32Array[];
  hits: number;
  lastTs: number;
  score: number;
  canvas: HTMLCanvasElement | null;
  promoting: boolean;
}

const toVector = (d: ArrayLike<number>) => JSON.stringify(Array.from(d));

export class FaceTracker {
  private known = new Map<number, Known>();
  private blocked: Float32Array[] = [];
  private pending: Pending[] = [];
  private lastRefresh = 0;
  private tracks: Track[] = [];
  inView = new Set<number>();
  /** recognised people in the current frame, largest (closest) face first */
  present: PresentPerson[] = [];

  constructor(
    private faceapi: FaceApi,
    private supabase: SupabaseClient,
    private userId: string,
    /** the current video frame; detections and thumbnails are taken from it */
    private frame: HTMLCanvasElement,
    private settings: () => Settings,
    private onEvent: (e: TrackerEvent) => void,
    private onError: (message: string) => void
  ) {}

  /** Reload known people and their descriptors from the database. */
  async refresh() {
    this.lastRefresh = Date.now();
    const { data: people, error } = await this.supabase.from('people_stats').select('id, name, thumb_path, visit_count');
    if (error) throw error;

    const blocked: Float32Array[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error: e } = await this.supabase
        .from('blocked_faces')
        .select('embedding')
        .order('id')
        .range(from, from + PAGE - 1);
      if (e) throw e;
      for (const row of data ?? []) blocked.push(new Float32Array(JSON.parse(row.embedding)));
      if (!data || data.length < PAGE) break;
    }
    this.blocked = blocked;

    const descriptors = new Map<number, Float32Array[]>();
    for (let from = 0; ; from += PAGE) {
      const { data, error: e } = await this.supabase
        .from('face_descriptors')
        .select('person_id, embedding')
        .order('id')
        .range(from, from + PAGE - 1);
      if (e) throw e;
      for (const row of data ?? []) {
        const list = descriptors.get(row.person_id) ?? [];
        list.push(new Float32Array(JSON.parse(row.embedding)));
        descriptors.set(row.person_id, list);
      }
      if (!data || data.length < PAGE) break;
    }

    const next = new Map<number, Known>();
    for (const p of people ?? []) {
      const prev = this.known.get(p.id);
      next.set(p.id, {
        id: p.id,
        name: p.name,
        thumbPath: p.thumb_path,
        descriptors: descriptors.get(p.id) ?? [],
        visitNo: Math.max(prev?.visitNo ?? 0, p.visit_count),
        lastReport: prev?.lastReport ?? 0,
        reporting: prev?.reporting ?? false,
        addingDescriptor: prev?.addingDescriptor ?? false,
      });
    }
    this.known = next;
  }

  /** Drop people that were just blocked or deleted, so their faces are looked at again from scratch. */
  async forget(ids: number[]) {
    for (const id of ids) this.known.delete(id);
    for (const t of this.tracks) {
      if (t.personId != null && ids.includes(t.personId)) {
        t.personId = null;
        t.lastDescribed = 0;
      }
    }
    await this.refresh();
  }

  /**
   * Handle one frame. Faces are found every frame (cheap) and followed by box overlap;
   * the expensive descriptor is only computed for new/unknown faces and periodically for known ones.
   * Side effects (DB writes, uploads) run in the background.
   */
  async step(
    detections: Detection[],
    describe: (dets: Detection[]) => Promise<FaceResult[]>
  ): Promise<FaceLabel[]> {
    const now = Date.now();
    if (now - this.lastRefresh > REFRESH_INTERVAL) {
      this.refresh().catch((e) => this.onError(`โหลดข้อมูลไม่สำเร็จ: ${e.message}`));
    }

    // follow faces from the previous frame: greedy by box overlap
    const overlaps: { i: number; t: Track; o: number }[] = [];
    detections.forEach((d, i) => {
      for (const t of this.tracks) {
        const o = iou(d.box, t.box);
        if (o > TRACK_IOU) overlaps.push({ i, t, o });
      }
    });
    overlaps.sort((a, b) => b.o - a.o);
    const active: Track[] = [];
    const taken = new Set<Track>();
    for (const { i, t } of overlaps) {
      if (active[i] || taken.has(t)) continue;
      active[i] = t;
      taken.add(t);
    }
    detections.forEach((d, i) => {
      active[i] ??= { box: d.box, personId: null, blocked: false, text: 'ตรวจพบใบหน้า', lastDescribed: 0, misses: 0 };
      active[i].box = d.box;
      active[i].misses = 0;
    });
    for (const t of this.tracks) if (!taken.has(t)) t.misses++;
    this.tracks = [...active, ...this.tracks.filter((t) => !taken.has(t) && t.misses <= MAX_MISSES)];

    // a person whose track is gone from the database (deleted/merged elsewhere) needs a fresh look
    for (const t of active) if (t.personId != null && !this.known.has(t.personId)) t.personId = null;

    const need = active
      .map((t, i) => ((t.personId == null && !t.blocked) || now - t.lastDescribed > REDESCRIBE_MS ? i : -1))
      .filter((i) => i >= 0);
    const described = need.length ? await describe(need.map((i) => detections[i])) : [];

    // identify the described faces; people held by tracks we didn't re-check stay reserved
    const { threshold } = this.settings();
    // blocked faces are set aside before anything else; nothing about them is kept
    const isBlocked = described.map((r) => this.blocked.length > 0 && this.bestDistance(this.blocked, r.descriptor) < threshold);
    const reserved = new Set(active.filter((t, i) => !need.includes(i) && t.personId != null).map((t) => t.personId!));
    const pairs: { k: number; p: Known; d: number }[] = [];
    described.forEach((r, k) => {
      if (isBlocked[k]) return;
      for (const p of this.known.values()) {
        if (reserved.has(p.id)) continue;
        const d = this.bestDistance(p.descriptors, r.descriptor);
        if (d < threshold) pairs.push({ k, p, d });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    const assigned = new Map<number, { p: Known; d: number }>();
    const used = new Set(reserved);
    for (const pr of pairs) {
      if (assigned.has(pr.k) || used.has(pr.p.id)) continue;
      assigned.set(pr.k, pr);
      used.add(pr.p.id);
    }

    described.forEach((r, k) => {
      const t = active[need[k]];
      t.lastDescribed = now;
      t.blocked = isBlocked[k];
      const a = assigned.get(k);
      if (t.blocked) {
        t.personId = null;
        t.text = 'ไม่บันทึก';
      } else if (a) {
        t.personId = a.p.id;
        this.onSeen(a.p, r.detection.box, r.descriptor, a.d);
      } else {
        t.personId = null;
        t.text = this.onUnknown(r);
      }
    });
    active.forEach((t, i) => {
      if (need.includes(i) || t.personId == null) return;
      this.onSeen(this.known.get(t.personId)!, t.box);
    });

    this.inView = new Set(active.filter((t) => t.personId != null).map((t) => t.personId!));
    this.present = active
      .filter((t) => t.personId != null && this.known.has(t.personId))
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
      .map((t) => {
        const p = this.known.get(t.personId!)!;
        return { id: p.id, name: displayName(p), thumbPath: p.thumbPath };
      });
    return active.map((t) => {
      if (t.blocked) return { box: t.box, known: false, text: t.text, blocked: true };
      const p = t.personId != null ? this.known.get(t.personId) : undefined;
      return p
        ? { box: t.box, known: true, text: `${displayName(p)} · ครั้งที่ ${p.visitNo || '…'}`, personId: p.id }
        : { box: t.box, known: false, text: t.text };
    });
  }

  private bestDistance(list: Float32Array[], descriptor: Float32Array) {
    let best = Infinity;
    for (const d of list) best = Math.min(best, this.faceapi.euclideanDistance(d, descriptor));
    return best;
  }

  private onSeen(p: Known, box: Box, descriptor?: Float32Array, dist = 0) {
    const now = Date.now();
    if (!p.reporting && now - p.lastReport >= REPORT_INTERVAL) {
      p.reporting = true;
      p.lastReport = now;
      this.report(p, this.cropCanvas(box)).finally(() => (p.reporting = false));
    }

    // keep extra samples from different angles / lighting
    const { minFace } = this.settings();
    if (descriptor && dist > 0.3 && p.descriptors.length < MAX_DESCRIPTORS && box.width >= minFace && !p.addingDescriptor) {
      p.addingDescriptor = true;
      p.descriptors.push(descriptor);
      Promise.resolve(
        this.supabase.from('face_descriptors').insert({ person_id: p.id, embedding: toVector(descriptor) })
      ).finally(() => (p.addingDescriptor = false));
    }
  }

  /** Count an unrecognised face towards registering a new person; returns the label to show. */
  private onUnknown(r: FaceResult): string {
    const { threshold, minFace } = this.settings();
    const box = r.detection.box;
    const now = Date.now();
    this.pending = this.pending.filter((c) => c.promoting || now - c.lastTs < PENDING_TTL);

    let best: Pending | null = null;
    let bestD = Infinity;
    for (const c of this.pending) {
      const d = this.bestDistance(c.descriptors, r.descriptor);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || bestD >= threshold) {
      if (box.width < minFace || r.detection.score < 0.7) return 'ใบหน้าเล็ก/ไม่ชัด';
      best = { descriptors: [], hits: 0, lastTs: now, score: 0, canvas: null, promoting: false };
      this.pending.push(best);
    }
    if (best.promoting) return 'กำลังบันทึก…';

    best.hits++;
    best.lastTs = now;
    best.descriptors.push(r.descriptor);
    if (r.detection.score > best.score) {
      best.score = r.detection.score;
      best.canvas = this.cropCanvas(box);
    }
    if (best.hits >= PROMOTE_HITS) {
      const c = best;
      c.promoting = true;
      this.promote(c)
        .catch((e) => this.onError(`บันทึกบุคคลใหม่ไม่สำเร็จ: ${e.message}`))
        .finally(() => (this.pending = this.pending.filter((x) => x !== c)));
    }
    return 'กำลังจดจำ…';
  }

  private async promote(c: Pending) {
    const canvas = c.canvas!;
    const mean = new Float32Array(128);
    for (const d of c.descriptors) for (let i = 0; i < 128; i++) mean[i] += d[i] / c.descriptors.length;

    // blocked (maybe just now, or by another camera): drop it without saving anything
    const { data: blocked } = await this.supabase.rpc('is_blocked', { query: toVector(mean), max_distance: this.settings().threshold });
    if (blocked) {
      this.blocked.push(mean);
      return;
    }

    // another camera may have registered this person since our last refresh
    const { data: match } = await this.supabase
      .rpc('match_face', { query: toVector(mean), max_distance: this.settings().threshold })
      .maybeSingle<{ person_id: number; distance: number }>();
    if (match) {
      await this.refresh();
      const p = this.known.get(match.person_id);
      if (p && !p.reporting) {
        p.reporting = true;
        p.lastReport = Date.now();
        await this.report(p, canvas).finally(() => (p.reporting = false));
      }
      return;
    }

    const blob = await toJpeg(canvas);
    const thumbPath = await uploadThumb(this.userId, blob);
    const { data: person, error } = await this.supabase
      .from('people')
      .insert({ name: '', thumb_path: thumbPath })
      .select('id, name')
      .single();
    if (error) throw error;

    const samples = c.descriptors.slice(0, 5);
    const { error: e2 } = await this.supabase
      .from('face_descriptors')
      .insert(samples.map((d) => ({ person_id: person.id, embedding: toVector(d) })));
    if (e2) throw e2;

    const k: Known = {
      id: person.id,
      name: person.name,
      thumbPath,
      descriptors: samples,
      visitNo: 0,
      lastReport: Date.now(),
      reporting: true,
      addingDescriptor: false,
    };
    this.known.set(k.id, k);
    await this.report(k, canvas, blob, thumbPath).finally(() => (k.reporting = false));
  }

  /** Tell the server we saw this person; it decides whether this is a new visit. */
  private async report(p: Known, canvas: HTMLCanvasElement, blob?: Blob, thumbPath?: string) {
    const s = this.settings();
    const { data, error } = await this.supabase
      .rpc('record_sighting', {
        p_person_id: p.id,
        // a gap shorter than a few report intervals would split one continuous stay into many visits
        p_gap_seconds: Math.max(Math.round(s.gapMinutes * 60), (REPORT_INTERVAL * 3) / 1000),
        p_camera: s.cameraName.trim() || null,
      })
      .single<SightingResult>();
    if (error) {
      if (error.message.includes('not found')) this.known.delete(p.id); // deleted elsewhere
      else this.onError(`บันทึกเวลาไม่สำเร็จ: ${error.message}`);
      return;
    }
    p.visitNo = data.visit_no;
    if (!data.is_new) return;

    const thumbUrl = canvas.toDataURL('image/jpeg', 0.8);
    this.onEvent({
      key: `live-${data.visit_id}`,
      personId: p.id,
      name: displayName(p),
      visitNo: data.visit_no,
      gapSeconds: data.gap_seconds,
      thumbUrl,
      at: Date.now(),
    });
    try {
      const path = thumbPath ?? (await uploadThumb(this.userId, blob ?? (await toJpeg(canvas))));
      await this.supabase.from('visits').update({ thumb_path: path }).eq('id', data.visit_id);
      if (!p.thumbPath) {
        p.thumbPath = path;
        await this.supabase.from('people').update({ thumb_path: path }).eq('id', p.id);
      }
    } catch (e) {
      this.onError(`อัปโหลดรูปไม่สำเร็จ: ${(e as Error).message}`);
    }
  }

  private cropCanvas(box: Box) {
    const v = this.frame;
    const pad = box.width * 0.35;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const w = Math.min(v.width - x, box.width + pad * 2);
    const h = Math.min(v.height - y, box.height + pad * 2);
    const size = Math.min(w, h);
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    c.getContext('2d')!.drawImage(v, x + (w - size) / 2, y + (h - size) / 2, size, size, 0, 0, 160, 160);
    return c;
  }
}

function toJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.8)
  );
}

function iou(a: Box, b: Box) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
}
