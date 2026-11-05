'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FaceApi } from '@/lib/faceapi';
import { deletePeople } from '@/lib/people';
import { looksStraight, matchesPose, measurePose, POSE_ARROW, POSE_TEXT, POSES, type Pose, type PoseMetrics } from '@/lib/pose';
import { readSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase/client';
import { uploadThumb } from '@/lib/thumbs';
import { displayName } from '@/lib/types';
import { useUser } from '@/lib/useUser';

const PER_POSE = 3;          // descriptors kept per pose
const CAPTURE_GAP_MS = 200;  // between two captures of the same pose
const LOOP_MS = 110;
const MIN_FACE = 110;        // px; closer faces give better descriptors
const MAX_DESCRIPTORS = 20;  // per person, as in the tracker

type Captures = Record<Pose, Float32Array[]>;
const emptyCaptures = (): Captures => ({ front: [], left: [], right: [], up: [], down: [] });

interface View {
  counts: Record<Pose, number>;
  target: Pose | null;
  hint: string;
  ok: boolean; // the face currently matches the wanted pose
  skipped: Pose[];
}

const toVector = (d: ArrayLike<number>) => JSON.stringify(Array.from(d));

/**
 * Enrol a face from all around: straight, left, right, up and down, guided by head pose.
 * The result is saved as a person (optionally named) or put on the block list without any photo.
 */
export default function FaceTrainer({ faceapi, stream }: { faceapi: FaceApi | null; stream: MediaStream | null }) {
  const user = useUser();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const capRef = useRef({ captures: emptyCaptures(), base: null as PoseMetrics | null, lastAt: 0, thumb: null as HTMLCanvasElement | null, skipped: new Set<Pose>() });
  const [view, setView] = useState<View>({ counts: { front: 0, left: 0, right: 0, up: 0, down: 0 }, target: 'front', hint: '', ok: false, skipped: [] });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; href?: string } | null>(null);
  const [error, setError] = useState('');

  const counts = () => {
    const c = capRef.current;
    return Object.fromEntries(POSES.map((p) => [p, c.captures[p].length])) as Record<Pose, number>;
  };
  const nextTarget = () => {
    const c = capRef.current;
    return POSES.find((p) => !c.skipped.has(p) && c.captures[p].length < PER_POSE) ?? null;
  };

  useEffect(() => {
    if (!faceapi || !stream) return;
    const video = videoRef.current!;
    video.srcObject = stream;
    video.play().catch(() => {});
    const frame = document.createElement('canvas');
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 });
    let stopped = false;

    (async () => {
      while (!stopped) {
        const t0 = performance.now();
        if (video.readyState >= 2 && video.videoWidth) {
          try {
            frame.width = video.videoWidth;
            frame.height = video.videoHeight;
            frame.getContext('2d')!.drawImage(video, 0, 0);
            const faces = await faceapi.detectAllFaces(frame, opts).withFaceLandmarks().withFaceDescriptors();
            if (stopped) break;
            const face = faces.sort((a, b) => b.detection.box.area - a.detection.box.area)[0];
            const c = capRef.current;
            const target = nextTarget();
            let hint = '';
            let ok = false;
            if (!face) hint = 'ไม่เห็นใบหน้า — หันหน้าเข้าหากล้อง';
            else if (face.detection.box.width < MIN_FACE) hint = 'ขยับเข้ามาใกล้กล้องอีกนิด';
            else if (target) {
              const m = measurePose(face.landmarks.positions);
              ok = c.base ? matchesPose(m, c.base, target) : target === 'front' && looksStraight(m);
              const now = Date.now();
              if (ok && now - c.lastAt > CAPTURE_GAP_MS) {
                c.lastAt = now;
                c.captures[target].push(face.descriptor);
                if (target === 'front') {
                  c.base ??= m;
                  c.thumb ??= crop(frame, face.detection.box);
                }
              }
              if (faces.length > 1) hint = 'มีหลายหน้าในกล้อง ระบบใช้หน้าที่ใหญ่ที่สุด';
            }
            drawFace(overlayRef.current!, frame.width, frame.height, face?.detection.box, ok);
            setView({ counts: counts(), target: nextTarget(), hint, ok, skipped: [...c.skipped] });
          } catch (e) {
            console.error(e);
          }
        }
        await new Promise((r) => setTimeout(r, Math.max(0, LOOP_MS - (performance.now() - t0))));
      }
    })();

    return () => {
      stopped = true;
    };
  }, [faceapi, stream]);

  const reset = () => {
    capRef.current = { captures: emptyCaptures(), base: null, lastAt: 0, thumb: null, skipped: new Set() };
    setView({ counts: counts(), target: 'front', hint: '', ok: false, skipped: [] });
    setResult(null);
    setError('');
    setName('');
  };

  const skip = () => {
    const t = nextTarget();
    if (t && t !== 'front') capRef.current.skipped.add(t);
    setView((v) => ({ ...v, target: nextTarget(), skipped: [...capRef.current.skipped] }));
  };

  const all = () => POSES.flatMap((p) => capRef.current.captures[p]);
  const meanOf = (list: Float32Array[]) => {
    const m = new Float32Array(128);
    for (const d of list) for (let i = 0; i < 128; i++) m[i] += d[i] / list.length;
    return m;
  };

  /** Which stored person (if any) this face already belongs to. */
  const findExisting = async () => {
    const { data } = await getSupabase()
      .rpc('match_face', { query: toVector(meanOf(capRef.current.captures.front)), max_distance: readSettings().threshold })
      .maybeSingle<{ person_id: number }>();
    return data?.person_id ?? null;
  };

  const savePerson = async () => {
    if (!user) return;
    setBusy(true);
    setError('');
    const supabase = getSupabase();
    try {
      const { data: blocked } = await supabase.rpc('is_blocked', { query: toVector(meanOf(capRef.current.captures.front)), max_distance: readSettings().threshold });
      if (blocked) throw new Error('หน้านี้อยู่ในรายการบล็อก ยกเลิกบล็อกที่หน้าตั้งค่าก่อนถ้าต้องการบันทึก');

      const existing = await findExisting();
      let personId: number;
      let label: string;
      if (existing) {
        const { count } = await supabase.from('face_descriptors').select('id', { count: 'exact', head: true }).eq('person_id', existing);
        const room = Math.max(0, MAX_DESCRIPTORS - (count ?? 0));
        if (room) {
          const { error } = await supabase.from('face_descriptors').insert(spread(all(), room).map((d) => ({ person_id: existing, embedding: toVector(d) })));
          if (error) throw error;
        }
        if (name.trim()) await supabase.from('people').update({ name: name.trim() }).eq('id', existing);
        const { data: p } = await supabase.from('people').select('id, name').eq('id', existing).single();
        personId = existing;
        label = `หน้านี้มีในระบบแล้ว (${displayName(p!)}) — เพิ่มข้อมูลหน้าจากหลายมุมให้แล้ว${room ? '' : ' (ข้อมูลหน้าเต็มแล้ว)'}`;
      } else {
        const blob = await new Promise<Blob>((res, rej) => capRef.current.thumb!.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85));
        const thumbPath = await uploadThumb(user.id, blob);
        const { data: p, error } = await supabase.from('people').insert({ name: name.trim(), thumb_path: thumbPath }).select('id, name').single();
        if (error) throw error;
        const { error: e2 } = await supabase.from('face_descriptors').insert(spread(all(), MAX_DESCRIPTORS).map((d) => ({ person_id: p.id, embedding: toVector(d) })));
        if (e2) throw e2;
        personId = p.id;
        label = `บันทึก ${displayName(p)} แล้ว`;
      }
      setResult({ text: label, href: `/people/${personId}` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const block = async () => {
    if (!confirm('บล็อกหน้านี้? ระบบจะไม่เก็บรูปหรือข้อมูลใด ๆ และกล้องจะข้ามหน้านี้ ถ้าหน้านี้มีในระบบแล้ว ข้อมูลเดิมทั้งหมดจะถูกลบ')) return;
    setBusy(true);
    setError('');
    try {
      const supabase = getSupabase();
      const existing = await findExisting();
      // one block entry per person: the new views plus what was stored about them before
      const embeddings = spread(all(), MAX_DESCRIPTORS).map(toVector);
      if (existing) {
        const { data, error } = await supabase.from('face_descriptors').select('embedding').eq('person_id', existing);
        if (error) throw error;
        embeddings.push(...(data ?? []).map((r) => r.embedding as string));
      }
      const blockId = crypto.randomUUID();
      const { error } = await supabase.from('blocked_faces').insert(embeddings.map((e) => ({ block_id: blockId, embedding: e })));
      if (error) throw error;
      if (existing) await deletePeople([existing]);
      setResult({ text: existing ? 'บล็อกแล้ว และลบข้อมูลเดิมของคนนี้ทั้งหมด' : 'บล็อกแล้ว กล้องจะไม่บันทึกหน้านี้' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const done = POSES.filter((p) => view.counts[p] >= PER_POSE);
  const ready = view.counts.front >= PER_POSE && done.length >= 3;
  const target = view.target;

  return (
    <div className="train-layout">
      <div className="video-wrap mirror">
        <video ref={videoRef} autoPlay muted playsInline />
        <canvas ref={overlayRef} />
        {!stream && (
          <div className="placeholder">
            <div>
              <div className="placeholder-icon">👤</div>กด “เปิดกล้อง” แล้วให้คนที่จะเทรนยืนหน้ากล้องคนเดียว
            </div>
          </div>
        )}
        {stream && (
          <div className="pose-ring" aria-hidden>
            {(['up', 'right', 'down', 'left'] as Pose[]).map((p) => (
              <span key={p} className={`seg ${p} ${view.counts[p] >= PER_POSE ? 'done' : ''} ${view.skipped.includes(p) ? 'skipped' : ''} ${target === p ? 'now' : ''}`} />
            ))}
            <span className={`seg front ${view.counts.front >= PER_POSE ? 'done' : ''} ${target === 'front' ? 'now' : ''}`} />
          </div>
        )}
      </div>

      <div className="card train-panel">
        <h2>👤 เทรนหน้าคน</h2>
        <p className="note">ให้คนที่จะเทรนยืนหน้ากล้องคนเดียว แล้วหันหน้าตามคำแนะนำ ระบบจะเก็บเองเมื่อหันถูกมุม</p>

        {result ? (
          <div className="train-result">
            <div className="big-check">✓</div>
            <p>{result.text}</p>
            <div className="row">
              {result.href && <Link href={result.href} className="button-link">ดูข้อมูลคนนี้</Link>}
              <button className="primary" onClick={reset}>เทรนคนถัดไป</button>
            </div>
          </div>
        ) : (
          <>
            <div className={`pose-step ${view.ok ? 'ok' : ''}`}>
              <span className="arrow">{target ? POSE_ARROW[target] : '✓'}</span>
              <div>
                <b>{target ? POSE_TEXT[target] : 'ครบทุกมุมแล้ว'}</b>
                <div className="note">{stream ? view.hint || (view.ok ? 'ค้างไว้…' : ' ') : 'ยังไม่ได้เปิดกล้อง'}</div>
              </div>
              {target && target !== 'front' && view.counts.front >= PER_POSE && (
                <button className="link" onClick={skip}>ข้าม</button>
              )}
            </div>

            <ul className="pose-list">
              {POSES.map((p) => (
                <li key={p} className={view.counts[p] >= PER_POSE ? 'done' : view.skipped.includes(p) ? 'skipped' : ''}>
                  <span>{POSE_ARROW[p]}</span> {POSE_TEXT[p]}
                  <em>{view.skipped.includes(p) ? 'ข้าม' : `${Math.min(view.counts[p], PER_POSE)}/${PER_POSE}`}</em>
                </li>
              ))}
            </ul>

            {ready && (
              <div className="train-save">
                <label>
                  ชื่อ (ไม่ใส่ก็ได้)
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ป้าศรี" />
                </label>
                <div className="row">
                  <button className="primary" onClick={savePerson} disabled={busy}>💾 บันทึกเป็นคน</button>
                  <button onClick={block} disabled={busy}>🚫 บล็อกหน้านี้</button>
                  <button className="link" onClick={reset} disabled={busy}>เริ่มใหม่</button>
                </div>
                <p className="note">บล็อก = ไม่เก็บรูป ชื่อ หรือเวลาใด ๆ เก็บแค่ลักษณะใบหน้าที่เป็นตัวเลขเพื่อให้กล้องข้ามหน้านี้</p>
              </div>
            )}
          </>
        )}
        {error && <p className="alert" onClick={() => setError('')}>{error}</p>}
      </div>
    </div>
  );
}

/** Up to `n` items spread evenly over the list (keeps every pose represented). */
function spread<T>(list: T[], n: number) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

function crop(frame: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }) {
  const pad = box.width * 0.35;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(frame.width - x, box.width + pad * 2);
  const h = Math.min(frame.height - y, box.height + pad * 2);
  const size = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  c.getContext('2d')!.drawImage(frame, x + (w - size) / 2, y + (h - size) / 2, size, size, 0, 0, 160, 160);
  return c;
}

function drawFace(ov: HTMLCanvasElement, width: number, height: number, box: { x: number; y: number; width: number; height: number } | undefined, ok: boolean) {
  ov.width = width;
  ov.height = height;
  const ctx = ov.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  if (!box) return;
  ctx.strokeStyle = ok ? '#10b981' : '#a5b4fc';
  ctx.lineWidth = ok ? 6 : 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
}
