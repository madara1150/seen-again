'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { FaceApi } from '@/lib/faceapi';
import { ItemRecognizer, ZONE_LABELS, ZONES, type Prediction } from '@/lib/items';
import { useSettings, type ItemZone } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase/client';
import type { Item } from '@/lib/types';

const EMPTY_GOAL = 15;   // views of the empty zone
const ITEM_GOAL = 30;    // distinct views of an item
const CAPTURE_MS = 220;
const LOOP_MS = 120;

/**
 * Teach the camera an item from every side: pick or create the item, show the empty zone once,
 * then turn the item around in the zone. Only views that differ from those already stored count.
 */
export default function ItemTrainer({ faceapi, stream }: { faceapi: FaceApi | null; stream: MediaStream | null }) {
  const [settings, updateSettings] = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [recognizer, setRecognizer] = useState<ItemRecognizer | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<number | null | undefined>(undefined); // undefined = idle, null = empty scene
  const [dupStreak, setDupStreak] = useState(0);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [, setVersion] = useState(0);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadItems = useCallback(async () => {
    const { data, error } = await getSupabase().from('items').select('*').eq('archived', false).order('sort').order('id');
    if (error) return setError(error.message);
    setItems(data as Item[]);
    setItemId((id) => id ?? (data as Item[])[0]?.id ?? null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!faceapi) return;
    let cancelled = false;
    ItemRecognizer.load(faceapi, getSupabase())
      .then((r) => !cancelled && setRecognizer(r))
      .catch((e) => !cancelled && setError(`โหลดโมเดลจดจำของไม่สำเร็จ: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [faceapi]);

  useEffect(() => recognizer?.onPrediction(setPrediction), [recognizer]);
  useEffect(() => recognizer?.onSamplesChanged(() => setVersion((v) => v + 1)), [recognizer]);

  // look at the zone continuously so a fresh view is always ready to store
  const zoneRef = useRef<ItemZone>(settings.itemZone);
  useEffect(() => {
    zoneRef.current = settings.itemZone;
  }, [settings.itemZone]);
  useEffect(() => {
    if (!stream || !recognizer) return;
    const video = videoRef.current!;
    video.srcObject = stream;
    video.play().catch(() => {});
    const frame = document.createElement('canvas');
    const t = setInterval(() => {
      if (video.readyState < 2 || !video.videoWidth) return;
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      frame.getContext('2d')!.drawImage(video, 0, 0);
      recognizer.step(frame, zoneRef.current);
      drawZone(overlayRef.current!, frame.width, frame.height, zoneRef.current);
    }, LOOP_MS);
    return () => clearInterval(t);
  }, [stream, recognizer]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setCapturing(undefined);
  }, []);
  useEffect(() => stop, [stop]);

  const start = (cls: number | null) => {
    if (!recognizer) return;
    if (!stream) return setError('เปิดกล้องก่อน');
    setError('');
    setDupStreak(0);
    setCapturing(cls);
    const goal = cls === null ? EMPTY_GOAL : ITEM_GOAL;
    timer.current = setInterval(async () => {
      try {
        // the empty scene barely changes, so take it as it is; items must show new angles
        const res = await recognizer.addSample(cls, cls !== null);
        if (res === 'duplicate') setDupStreak((n) => n + 1);
        if (res === 'added') setDupStreak(0);
        if (res === 'full' || recognizer.count(cls) >= goal) stop();
      } catch (e) {
        setError(`บันทึกภาพไม่สำเร็จ: ${(e as Error).message}`);
        stop();
      }
    }, CAPTURE_MS);
  };

  const clear = async (cls: number | null, label: string) => {
    if (!recognizer || !confirm(`ล้างภาพที่เทรนของ “${label}” ทั้งหมด แล้วเริ่มใหม่?`)) return;
    await recognizer.clearSamples(cls).catch((e) => setError((e as Error).message));
  };

  const item = items.find((i) => i.id === itemId) ?? null;
  const emptyCount = recognizer?.count(null) ?? 0;
  const itemCount = item && recognizer ? recognizer.count(item.id) : 0;
  const predicted = prediction ? (prediction.itemId === null ? 'ฉากว่าง (ไม่มีของ)' : items.find((i) => i.id === prediction.itemId)?.name) : null;
  const pct = Math.min(1, itemCount / ITEM_GOAL);

  return (
    <div className="train-layout">
      <div className="video-wrap">
        <video ref={videoRef} autoPlay muted playsInline />
        <canvas ref={overlayRef} />
        {!stream && (
          <div className="placeholder">
            <div>
              <div className="placeholder-icon">📦</div>กด “เปิดกล้อง” แล้วถือของไว้ในกรอบเส้นประ
            </div>
          </div>
        )}
        {capturing !== undefined && capturing !== null && (
          <div className={`turn-hint ${dupStreak >= 5 ? 'nudge' : ''}`}>{dupStreak >= 5 ? '🔄 หมุนไปมุมใหม่!' : '🔄 ค่อย ๆ หมุนของ'}</div>
        )}
      </div>

      <div className="card train-panel">
        <h2>📦 เทรนสิ่งของ</h2>
        {!recognizer && !error && <p className="empty">กำลังโหลดโมเดลจดจำของ…</p>}

        <div className="train-step">
          <span className="num">1</span>
          <div className="grow">
            <b>เลือกหรือสร้างรายการ</b>
            <div className="row">
              {items.length > 0 && (
                <select value={itemId ?? ''} onChange={(e) => setItemId(Number(e.target.value))} aria-label="รายการ" disabled={capturing !== undefined}>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>{i.emoji} {i.name} ({recognizer?.count(i.id) ?? 0} มุม)</option>
                  ))}
                </select>
              )}
            </div>
            <NewItemForm
              sort={Math.max(0, ...items.map((i) => i.sort)) + 1}
              onCreated={async (id) => {
                await loadItems();
                setItemId(id);
              }}
              onError={setError}
            />
          </div>
        </div>

        <div className="train-step">
          <span className={`num ${emptyCount >= EMPTY_GOAL ? 'ok' : ''}`}>{emptyCount >= EMPTY_GOAL ? '✓' : '2'}</span>
          <div className="grow">
            <b>ถ่ายฉากว่าง</b> <span className="note">เอาของออกจากกรอบ (ทำครั้งเดียว ใช้กับทุกรายการ)</span>
            <div className="row">
              <span className="meter"><i style={{ width: `${Math.min(1, emptyCount / EMPTY_GOAL) * 100}%` }} /></span>
              <span className="note">{emptyCount}/{EMPTY_GOAL}</span>
              {capturing === null ? (
                <button onClick={stop}>หยุด</button>
              ) : (
                <button onClick={() => start(null)} disabled={!recognizer || capturing !== undefined}>
                  📸 {emptyCount >= EMPTY_GOAL ? 'ถ่ายเพิ่ม' : 'เริ่มถ่าย'}
                </button>
              )}
              {emptyCount > 0 && capturing === undefined && <button className="link" onClick={() => clear(null, 'ฉากว่าง')}>ล้าง</button>}
            </div>
          </div>
        </div>

        <div className="train-step">
          <span className={`num ${itemCount >= ITEM_GOAL ? 'ok' : ''}`}>{itemCount >= ITEM_GOAL ? '✓' : '3'}</span>
          <div className="grow">
            <b>{item ? `ถือ ${item.emoji} ${item.name} ให้กล้องเห็นทุกด้าน` : 'เลือกรายการก่อน'}</b>
            <ul className="tips">
              <li><b>ถือให้ของใหญ่เกือบเต็มกรอบเส้นประ</b> ของที่เล็กในกรอบ กล้องจะแยกจากฉากว่างไม่ออก</li>
              <li>หมุนรอบตัวช้า ๆ ให้เห็นทุกด้าน</li>
              <li>พลิกให้เห็นด้านบนและด้านล่าง</li>
              <li>ถือใกล้และไกลกล้อง ถือด้วยมือเหมือนตอนแจกจริง</li>
            </ul>
            <div className="item-progress">
              <svg viewBox="0 0 36 36" aria-hidden>
                <circle cx="18" cy="18" r="15.5" className="track" />
                <circle cx="18" cy="18" r="15.5" className="bar" strokeDasharray={`${pct * 97.4} 97.4`} />
              </svg>
              <div>
                <b>{itemCount}</b>/{ITEM_GOAL} มุม
              </div>
            </div>
            <div className="row">
              {capturing !== undefined && capturing !== null ? (
                <button onClick={stop}>⏹ หยุด</button>
              ) : (
                <button className="primary" onClick={() => item && start(item.id)} disabled={!recognizer || !item || capturing !== undefined}>
                  🔄 {itemCount ? 'เก็บมุมเพิ่ม' : 'เริ่มเทรน'}
                </button>
              )}
              {item && itemCount > 0 && capturing === undefined && <button className="link" onClick={() => clear(item.id, item.name)}>ล้างแล้วเริ่มใหม่</button>}
            </div>
            {emptyCount < EMPTY_GOAL && itemCount > 0 && <p className="note">⚠️ ถ่ายฉากว่าง (ขั้นที่ 2) ด้วย ระบบถึงจะเริ่มทายได้</p>}
          </div>
        </div>

        <div className="train-step">
          <span className="num">4</span>
          <div className="grow">
            <b>ทดสอบ</b>
            <p className="seen-strip">
              <span className="eye">👁️</span>
              {recognizer?.ready && stream && predicted ? (
                <>
                  กล้องคิดว่าเป็น <b>{predicted}</b>
                  <span className="meter"><i style={{ width: `${Math.round(prediction!.confidence * 100)}%` }} /></span>
                </>
              ) : (
                <span className="note">{recognizer?.ready ? 'เปิดกล้องเพื่อทดสอบ' : 'เทรนฉากว่างและของอย่างน้อย 1 อย่างก่อน'}</span>
              )}
            </p>
          </div>
        </div>

        <div className="zone-row">
          <span className="note">กรอบที่ดูของ</span>
          {(Object.keys(ZONE_LABELS) as ItemZone[]).map((z) => (
            <button key={z} className={z === settings.itemZone ? 'chip on' : 'chip'} onClick={() => updateSettings({ itemZone: z })}>
              {ZONE_LABELS[z]}
            </button>
          ))}
        </div>
        <p className="note">ใช้กรอบเดียวกับตอนแจกจริง ถ้าเปลี่ยนกรอบควรเทรนใหม่ · ถ้ากล้องยังทายผิด ลองเลือกกรอบให้เล็กลง (กลางภาพ) แล้วเทรนใหม่</p>
        {error && <p className="alert" onClick={() => setError('')}>{error}</p>}
      </div>
    </div>
  );
}

function NewItemForm({ sort, onCreated, onError }: { sort: number; onCreated: (id: number) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { data, error } = await getSupabase()
      .from('items')
      .insert({ name: name.trim(), unit: unit.trim(), emoji: emoji.trim(), sort })
      .select('id')
      .single();
    if (error) return onError(error.message);
    setOpen(false);
    setName('');
    setUnit('');
    setEmoji('');
    onCreated(data.id);
  };

  if (!open) return <button className="link" onClick={() => setOpen(true)}>＋ สร้างรายการใหม่</button>;
  return (
    <form className="row new-item" onSubmit={submit}>
      <input className="emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🍱" aria-label="ไอคอน" maxLength={4} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ เช่น ข้าวกล่อง" aria-label="ชื่อรายการ" autoFocus />
      <input className="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="หน่วย" aria-label="หน่วย" />
      <button className="primary" disabled={!name.trim()}>สร้าง</button>
      <button type="button" className="link" onClick={() => setOpen(false)}>ยกเลิก</button>
    </form>
  );
}

function drawZone(ov: HTMLCanvasElement, width: number, height: number, zone: ItemZone) {
  if (ov.width !== width) ov.width = width;
  if (ov.height !== height) ov.height = height;
  const ctx = ov.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  const [zx, zy, zw, zh] = ZONES[zone];
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.strokeRect(zx * width + 4, zy * height + 4, zw * width - 8, zh * height - 8);
}
