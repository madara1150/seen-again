'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FaceApi } from './faceapi';
import type { ItemZone } from './settings';

const MODEL_URL = '/models/mobilenet_v2/model.json';
const EMBED_NODE = 'module_apply_default/MobilenetV2/Logits/AvgPool';
const INPUT = 224;
export const EMBED_DIM = 1280;

const K = 7;                 // neighbours that vote
const MIN_CONFIDENCE = 0.6;  // share of the votes the winner needs
const STABLE_STEPS = 3;      // agreeing predictions in a row before an item counts as seen (~0.75 s)
const CLEAR_STEPS = 8;       // "nothing" predictions in a row (~2 s) before the same item can be recorded again
export const MAX_SAMPLES = 60; // per class
const SAME_VIEW = 0.95;      // cosine similarity above which two views count as the same angle
const PAGE = 1000;

/** fractions of the frame: x, y, width, height */
export const ZONES: Record<ItemZone, [number, number, number, number]> = {
  full: [0, 0, 1, 1],
  center: [0.25, 0.2, 0.5, 0.6],
  bottom: [0, 0.5, 1, 0.5],
  left: [0, 0, 0.5, 1],
  right: [0.5, 0, 0.5, 1],
};

export const ZONE_LABELS: Record<ItemZone, string> = {
  full: 'ทั้งภาพ',
  center: 'กลางภาพ',
  bottom: 'ครึ่งล่าง',
  left: 'ครึ่งซ้าย',
  right: 'ครึ่งขวา',
};

/** itemId null = the "nothing / empty scene" class */
export interface Sample { itemId: number | null; v: Float32Array }
export interface Prediction { itemId: number | null; confidence: number }

interface Tensor { data(): Promise<Float32Array>; dispose(): void }
interface GraphModel { execute(input: unknown, output: string): Tensor }
interface Tf {
  loadGraphModel(url: string): Promise<GraphModel>;
  tidy<T>(fn: () => T): T;
  browser: { fromPixels(c: HTMLCanvasElement): unknown };
  cast(x: unknown, dtype: 'float32'): unknown;
  div(a: unknown, b: number): unknown;
  expandDims(x: unknown, axis: number): unknown;
}

type Listener<T> = (value: T) => void;

/**
 * Recognises handed-out items from the camera: MobileNet v2 turns a crop of the frame into a
 * 1280-d vector, which is matched against samples the user taught (k-nearest-neighbours).
 * An item is "detected" once it is seen steadily, and only again after the scene was empty.
 */
export class ItemRecognizer {
  samples: Sample[] = [];
  prediction: Prediction | null = null;
  private lastEmbedding: Float32Array | null = null;
  private crop = document.createElement('canvas');
  private busy = false;
  private streak: { label: number | null; n: number } | null = null;
  private recorded = new Set<number>();
  private predictionListeners = new Set<Listener<Prediction | null>>();
  private detectListeners = new Set<Listener<number>>();
  private sampleListeners = new Set<Listener<void>>();

  private constructor(
    private tf: Tf,
    private model: GraphModel,
    private supabase: SupabaseClient
  ) {
    this.crop.width = this.crop.height = INPUT;
  }

  static async load(faceapi: FaceApi, supabase: SupabaseClient) {
    const tf = faceapi.tf as unknown as Tf;
    const model = await tf.loadGraphModel(MODEL_URL);
    const r = new ItemRecognizer(tf, model, supabase);
    await r.embed(); // compile shaders now rather than on the first frame
    await r.loadSamples();
    return r;
  }

  async loadSamples() {
    const samples: Sample[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.supabase
        .from('item_samples')
        .select('item_id, embedding')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) samples.push({ itemId: row.item_id, v: new Float32Array(row.embedding) });
      if (!data || data.length < PAGE) break;
    }
    this.samples = samples;
    this.sampleListeners.forEach((l) => l());
  }

  /** Teaching needs empty-scene samples, or an empty counter would be read as the nearest item. */
  get ready() {
    return this.samples.some((s) => s.itemId === null) && this.samples.some((s) => s.itemId !== null);
  }

  count(itemId: number | null) {
    return this.samples.filter((s) => s.itemId === itemId).length;
  }

  onPrediction(l: Listener<Prediction | null>) {
    this.predictionListeners.add(l);
    return () => void this.predictionListeners.delete(l);
  }

  onDetected(l: Listener<number>) {
    this.detectListeners.add(l);
    return () => void this.detectListeners.delete(l);
  }

  onSamplesChanged(l: Listener<void>) {
    this.sampleListeners.add(l);
    return () => void this.sampleListeners.delete(l);
  }

  /** Allow items already recorded to be recorded again, e.g. for the next person. */
  rearm() {
    this.recorded.clear();
  }

  /** Look at the current frame; the crop is taken synchronously so the caller may redraw the frame. */
  step(frame: HTMLCanvasElement, zone: ItemZone) {
    if (this.busy || !frame.width) return;
    this.busy = true;
    const [zx, zy, zw, zh] = ZONES[zone];
    this.crop
      .getContext('2d')!
      .drawImage(frame, zx * frame.width, zy * frame.height, zw * frame.width, zh * frame.height, 0, 0, INPUT, INPUT);
    this.embed()
      .then((v) => {
        this.lastEmbedding = v;
        const p = this.ready ? this.classify(v) : null;
        this.prediction = p;
        this.predictionListeners.forEach((l) => l(p));
        if (p) this.track(p);
      })
      .catch((e) => console.error(e))
      .finally(() => (this.busy = false));
  }

  /**
   * Save the latest view as a sample of this item (null = empty scene).
   * With `distinct`, a view too similar to one already stored is skipped, so turning the item
   * around collects different angles rather than many copies of one.
   */
  async addSample(itemId: number | null, distinct = false): Promise<'added' | 'duplicate' | 'full' | 'none'> {
    const v = this.lastEmbedding;
    if (!v) return 'none';
    if (this.count(itemId) >= MAX_SAMPLES) return 'full';
    this.lastEmbedding = null; // never store the same view twice
    if (distinct && this.samples.some((s) => s.itemId === itemId && dot(s.v, v) > SAME_VIEW)) return 'duplicate';
    const { error } = await this.supabase.from('item_samples').insert({ item_id: itemId, embedding: Array.from(v) });
    if (error) throw error;
    this.samples.push({ itemId, v });
    this.sampleListeners.forEach((l) => l());
    return 'added';
  }

  async clearSamples(itemId: number | null) {
    const q = this.supabase.from('item_samples').delete();
    const { error } = await (itemId === null ? q.is('item_id', null) : q.eq('item_id', itemId));
    if (error) throw error;
    this.samples = this.samples.filter((s) => s.itemId !== itemId);
    this.sampleListeners.forEach((l) => l());
  }

  private async embed() {
    const { tf, model, crop } = this;
    const out = tf.tidy(() => model.execute(tf.div(tf.expandDims(tf.cast(tf.browser.fromPixels(crop), 'float32'), 0), 255), EMBED_NODE));
    const v = await out.data();
    out.dispose();
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    const unit = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) unit[i] = v[i] / norm;
    return unit;
  }

  private classify(v: Float32Array): Prediction {
    const scored = this.samples.map((s) => ({ itemId: s.itemId, sim: dot(v, s.v) }));
    scored.sort((a, b) => b.sim - a.sim);
    const top = scored.slice(0, K);
    const votes = new Map<number | null, number>();
    for (const t of top) votes.set(t.itemId, (votes.get(t.itemId) ?? 0) + 1);
    let best: number | null = null;
    let bestVotes = -1;
    for (const [id, n] of votes) if (n > bestVotes) [best, bestVotes] = [id, n];
    return { itemId: best, confidence: bestVotes / top.length };
  }

  private track(p: Prediction) {
    if (p.confidence < MIN_CONFIDENCE) {
      this.streak = null;
      return;
    }
    this.streak = this.streak?.label === p.itemId ? { label: p.itemId, n: this.streak.n + 1 } : { label: p.itemId, n: 1 };
    if (p.itemId === null) {
      if (this.streak.n >= CLEAR_STEPS) this.recorded.clear();
      return;
    }
    if (this.streak.n === STABLE_STEPS && !this.recorded.has(p.itemId)) {
      this.recorded.add(p.itemId);
      const id = p.itemId;
      this.detectListeners.forEach((l) => l(id));
    }
  }
}

function dot(a: Float32Array, b: Float32Array) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}
