'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime } from '@/lib/format';
import { ROUND_GAP_MS, rounds, summarize } from '@/lib/handouts';
import { BLOCK_CONFIRM, blockPeople } from '@/lib/people';
import { MAX_SAMPLES, ZONE_LABELS, type ItemRecognizer, type Prediction } from '@/lib/items';
import { readSettings, useSettings, type ItemZone } from '@/lib/settings';
import { playOk, playWarn } from '@/lib/sound';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import type { PresentPerson } from '@/lib/tracker';
import { itemLabel, type Handout, type Item } from '@/lib/types';

const CAPTURE_MS = 250; // one sample per new camera view while a teach button is held

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** a stable colour per item, so buttons and the detection strip match */
export const itemHue = (items: Item[], id: number) => (items.findIndex((i) => i.id === id) * 67 + 210) % 360;

interface Props {
  present: PresentPerson[];
  /** the recipient is highlighted on the video */
  onSelect: (personId: number | null) => void;
  /** null while the item model loads (or if it is unavailable) */
  recognizer: ItemRecognizer | null;
  recognizerError?: string;
  cameraOn: boolean;
  kiosk?: boolean;
  /** people were blocked here; the tracker must forget them */
  onBlocked: (ids: number[]) => void;
}

/**
 * Hand-over panel next to the camera: the closest recognised face is picked automatically and
 * shows what they already received today. Items are recorded by a tap, or automatically when the
 * camera recognises an item it was taught (the "สอนกล้อง" tab).
 */
export default function HandoutPanel({ present, onSelect, recognizer, recognizerError, cameraOn, kiosk, onBlocked }: Props) {
  const [settings, updateSettings] = useSettings();
  const [tab, setTab] = useState<'give' | 'teach'>('give');
  const [items, setItems] = useState<Item[] | null>(null);
  const [today, setToday] = useState<Handout[]>([]);
  const [selected, setSelected] = useState<PresentPerson | null>(null);
  const [last, setLast] = useState<{ id: number; text: string; auto: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0); // refreshed with the data, to tell an old round from the current one
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [flash, setFlash] = useState<{ n: number; warn: boolean }>({ n: 0, warn: false });
  const [popped, setPopped] = useState<{ id: number; n: number } | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [, setSampleVersion] = useState(0);
  const thumb = useThumbUrls([selected?.thumbPath, ...present.map((p) => p.thumbPath)]);

  // follow the camera: keep the current person while in view, else switch to the closest face;
  // when nobody is in view keep the last one so a late tap still goes to the right person
  const current = selected && present.find((p) => p.id === selected.id);
  if (present.length && !current) setSelected(present[0]);
  else if (current && (current.name !== selected!.name || current.thumbPath !== selected!.thumbPath)) setSelected(current);

  useEffect(() => onSelect(selected?.id ?? null), [selected?.id, onSelect]);

  // a new recipient may receive the item that is still in view
  useEffect(() => recognizer?.rearm(), [selected?.id, recognizer]);

  useEffect(() => recognizer?.onPrediction(setPrediction), [recognizer]);
  useEffect(() => recognizer?.onSamplesChanged(() => setSampleVersion((v) => v + 1)), [recognizer]);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [i, h] = await Promise.all([
      supabase.from('items').select('*').order('sort').order('id'),
      supabase.from('handouts').select('*').gte('created_at', startOfToday().toISOString()).order('created_at', { ascending: false }),
    ]);
    if (i.error || h.error) return setError((i.error ?? h.error)!.message);
    setItems(i.data as Item[]);
    setToday(h.data as Handout[]);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const allItems = items ?? [];
  const active = allItems.filter((i) => !i.archived);
  const mine = selected ? today.filter((h) => h.person_id === selected.id) : [];
  const myRounds = rounds(mine);
  // a tap within the current round is expected; only an earlier round today is a repeat
  const repeat = myRounds.length > 1 || (myRounds.length === 1 && now - new Date(mine[0].created_at).getTime() > ROUND_GAP_MS);
  const inView = !!current;

  const give = async (item: Item, auto = false) => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error } = await getSupabase()
      .from('handouts')
      .insert({ person_id: selected.id, item_id: item.id, qty: 1, camera: readSettings().cameraName.trim() || null })
      .select('*')
      .single<Handout>();
    setBusy(false);
    if (error) return setError(`บันทึกไม่สำเร็จ: ${error.message}`);
    const warn = repeat || (mine.length > 0 && new Date(data.created_at).getTime() - new Date(mine[0].created_at).getTime() > ROUND_GAP_MS);
    if (warn) playWarn();
    else playOk();
    setFlash((f) => ({ n: f.n + 1, warn }));
    setPopped((p) => ({ id: item.id, n: (p?.n ?? 0) + 1 }));
    setToday((list) => [data, ...list]);
    setNow(new Date(data.created_at).getTime());
    setLast({ id: data.id, text: `${item.emoji ? `${item.emoji} ` : ''}${itemLabel(item, 1)} → ${selected.name}`, auto });
  };

  // the recogniser calls back outside React; keep the latest state reachable from that callback
  const onDetectedRef = useRef<(id: number) => void>(() => {});
  useEffect(() => {
    onDetectedRef.current = (id) => {
      const item = active.find((i) => i.id === id);
      if (!item || !readSettings().autoRecord || tab !== 'give' || busy) return;
      if (!selected || !inView) return setNotice(`กล้องเห็น ${item.name} แต่ไม่มีผู้รับหน้ากล้อง จึงยังไม่บันทึก`);
      give(item, true);
    };
  });
  useEffect(() => recognizer?.onDetected((id) => onDetectedRef.current(id)), [recognizer]);

  const undo = async () => {
    if (!last) return;
    const { error } = await getSupabase().from('handouts').delete().eq('id', last.id);
    if (error) return setError(`ยกเลิกไม่สำเร็จ: ${error.message}`);
    setToday((list) => list.filter((h) => h.id !== last.id));
    setLast(null);
  };

  const block = async () => {
    if (!selected || !confirm(`${selected.name}: ${BLOCK_CONFIRM}`)) return;
    const id = selected.id;
    try {
      await blockPeople([id]);
      onBlocked([id]);
      setSelected(null);
      setLast(null);
      setToday((list) => list.filter((h) => h.person_id !== id));
      setNotice('บล็อกแล้ว ลบข้อมูลทั้งหมดของคนนี้ และจะไม่บันทึกเมื่อมาหน้ากล้องอีก');
    } catch (e) {
      setError(`บล็อกไม่สำเร็จ: ${(e as Error).message}`);
    }
  };

  const seen = prediction && prediction.itemId !== null ? allItems.find((i) => i.id === prediction.itemId) : null;

  return (
    <div className={`card handout ${kiosk ? 'kiosk' : ''}`}>
      <div className="handout-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'give'} className={tab === 'give' ? 'on' : ''} onClick={() => setTab('give')}>
            🎁 แจกของ
          </button>
          <button role="tab" aria-selected={tab === 'teach'} className={tab === 'teach' ? 'on' : ''} onClick={() => setTab('teach')}>
            🧠 สอนกล้อง
          </button>
        </div>
        <span className="spacer" />
        {!kiosk && <Link href="/handouts" className="note">สรุปการแจก →</Link>}
      </div>

      {tab === 'give' ? (
        <>
          {present.length > 1 && (
            <div className="chips" role="radiogroup" aria-label="เลือกผู้รับ">
              {present.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={p.id === selected?.id}
                  className={p.id === selected?.id ? 'chip on' : 'chip'}
                  onClick={() => setSelected(p)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {selected ? (
            <div
              key={flash.n}
              className={`recipient ${inView ? '' : 'away'} ${flash.n ? (flash.warn ? 'flash-warn' : 'flash-ok') : ''}`}
            >
              {thumb(selected.thumbPath) ? <img src={thumb(selected.thumbPath)} alt="" /> : <span className="img-ph big" />}
              <div className="who">
                <Link href={`/people/${selected.id}`}><b>{selected.name}</b></Link>
                <div className="note">{inView ? '● อยู่หน้ากล้อง' : 'ไม่อยู่หน้ากล้องแล้ว'}</div>
                {mine.length ? (
                  <div className={`tag ${repeat ? 'warn' : 'back'}`}>
                    {repeat ? `⚠️ วันนี้รับไปแล้ว ${myRounds.length} รอบ` : 'รอบนี้'}: {summarize(mine, allItems)} · ล่าสุด{' '}
                    {fmtTime(mine[0].created_at).slice(0, 5)}
                  </div>
                ) : (
                  <div className="tag new">✨ ยังไม่ได้รับวันนี้</div>
                )}
              </div>
              <button className="block-btn" onClick={block} title="ลบข้อมูลทั้งหมดของคนนี้ และไม่บันทึกอีก">
                🚫<span>ไม่บันทึก</span>
              </button>
            </div>
          ) : (
            <div className="recipient waiting">
              <span className="pulse" />
              <span>รอใบหน้าผู้รับหน้ากล้อง…</span>
            </div>
          )}

          <div className="seen-strip">
            {recognizer?.ready ? (
              <>
                <span className="eye">👁️</span>
                {!cameraOn ? (
                  <span className="note">เปิดกล้องเพื่อให้ระบบดูของที่แจก</span>
                ) : seen ? (
                  <>
                    <b style={{ color: `hsl(${itemHue(allItems, seen.id)} 70% 50%)` }}>
                      {seen.emoji} {seen.name}
                    </b>
                    <span className="meter"><i style={{ width: `${Math.round(prediction!.confidence * 100)}%` }} /></span>
                  </>
                ) : (
                  <span className="note">ไม่เห็นของในโซน</span>
                )}
                <label className="switch" title="บันทึกเองเมื่อกล้องเห็นของ">
                  <input type="checkbox" checked={settings.autoRecord} onChange={(e) => updateSettings({ autoRecord: e.target.checked })} />
                  <span>อัตโนมัติ</span>
                </label>
              </>
            ) : (
              <span className="note">
                {recognizerError
                  ? `จดจำของไม่ได้: ${recognizerError}`
                  : recognizer
                    ? 'ยังไม่ได้สอนกล้องให้รู้จักของ — แตะปุ่มด้านล่างเพื่อบันทึกเอง หรือไปที่แท็บ “สอนกล้อง”'
                    : 'กำลังโหลดโมเดลจดจำของ…'}
              </span>
            )}
          </div>

          {items && active.length === 0 ? (
            <p className="note">
              ยังไม่มีรายการของ <Link href="/handouts#items">เพิ่มรายการ</Link>
            </p>
          ) : (
            <div className="give-grid">
              {active.map((i) => (
                <button
                  key={popped?.id === i.id ? `${i.id}-${popped.n}` : i.id}
                  className={`give ${popped?.id === i.id ? 'pop' : ''} ${seen?.id === i.id ? 'seen' : ''}`}
                  style={{ '--hue': itemHue(allItems, i.id) } as React.CSSProperties}
                  disabled={!selected || busy}
                  onClick={() => give(i)}
                >
                  {i.emoji && <em>{i.emoji}</em>}
                  {i.name}
                  <span>+1{i.unit ? ` ${i.unit}` : ''}</span>
                </button>
              ))}
            </div>
          )}

          {last && (
            <p className="saved">
              ✓ {last.auto ? 'กล้องบันทึก' : 'บันทึก'} {last.text} <button className="link" onClick={undo}>ยกเลิก</button>
            </p>
          )}
          {notice && <p className="note notice">{notice}</p>}
          {error && <p className="alert" onClick={() => setError('')}>{error}</p>}

          <p className="note today">
            วันนี้แจกไปแล้ว {today.length ? summarize(today, allItems) : '–'} · ผู้รับ {new Set(today.map((h) => h.person_id)).size} คน
          </p>
        </>
      ) : (
        <TeachTab
          items={active}
          allItems={allItems}
          recognizer={recognizer}
          recognizerError={recognizerError}
          cameraOn={cameraOn}
          prediction={prediction}
          zone={settings.itemZone}
          onZone={(z) => updateSettings({ itemZone: z })}
        />
      )}
    </div>
  );
}

function TeachTab({
  items,
  allItems,
  recognizer,
  recognizerError,
  cameraOn,
  prediction,
  zone,
  onZone,
}: {
  items: Item[];
  allItems: Item[];
  recognizer: ItemRecognizer | null;
  recognizerError?: string;
  cameraOn: boolean;
  prediction: Prediction | null;
  zone: ItemZone;
  onZone: (z: ItemZone) => void;
}) {
  const [capturing, setCapturing] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setCapturing(undefined);
  }, []);
  useEffect(() => stop, [stop]);

  if (recognizerError) return <p className="alert">จดจำของไม่ได้: {recognizerError}</p>;
  if (!recognizer) return <p className="empty">กำลังโหลดโมเดลจดจำของ…</p>;

  const start = (itemId: number | null) => {
    if (!cameraOn) return setError('เปิดกล้องก่อน แล้วถือของไว้ในกรอบเส้นประบนวิดีโอ');
    setError('');
    setCapturing(itemId);
    const grab = () =>
      recognizer.addSample(itemId).catch((e) => {
        setError(`บันทึกภาพไม่สำเร็จ: ${(e as Error).message}`);
        stop();
      });
    grab();
    timer.current = setInterval(grab, CAPTURE_MS);
  };

  const clear = async (itemId: number | null, name: string) => {
    if (!confirm(`ล้างภาพที่สอนของ “${name}” ทั้งหมด?`)) return;
    await recognizer.clearSamples(itemId).catch((e) => setError((e as Error).message));
  };

  const rows: { id: number | null; name: string; emoji: string; hint: string }[] = [
    { id: null, name: 'ฉากว่าง', emoji: '⬜', hint: 'จุดแจกตอนไม่มีของ (ทำก่อน)' },
    ...items.map((i) => ({ id: i.id, name: i.name, emoji: i.emoji || '📦', hint: 'ถือของในกรอบ หมุนหลายมุม' })),
  ];
  const predicted = prediction ? (prediction.itemId === null ? 'ฉากว่าง' : allItems.find((i) => i.id === prediction.itemId)?.name) : null;

  return (
    <div className="teach">
      <p className="note">
        กด<b>ค้าง</b>ที่ปุ่ม 📸 ระหว่างถือของไว้ในกรอบเส้นประบนวิดีโอ ระบบจะเก็บภาพ 4 ภาพต่อวินาที
        ควรมีอย่างละ 20 ภาพขึ้นไป ถ่ายหลายมุม หลายระยะ และทั้งตอนมีคนกับไม่มีคน
        · หรือใช้หน้า <Link href="/train">🎓 เทรน</Link> ที่มีขั้นตอนแนะนำและเก็บเฉพาะมุมใหม่ให้
      </p>

      <div className="zone-row">
        <span className="note">โซนที่ดูของ</span>
        {(Object.keys(ZONE_LABELS) as ItemZone[]).map((z) => (
          <button key={z} className={z === zone ? 'chip on' : 'chip'} onClick={() => onZone(z)}>
            {ZONE_LABELS[z]}
          </button>
        ))}
      </div>

      <div className="teach-list">
        {rows.map((r) => {
          const n = recognizer.count(r.id);
          return (
            <div key={r.id ?? 'empty'} className={`teach-row ${capturing === r.id ? 'live' : ''}`}>
              <em>{r.emoji}</em>
              <div className="grow">
                <b>{r.name}</b> <span className="note">{r.hint}</span>
                <span className="meter">
                  <i style={{ width: `${(n / MAX_SAMPLES) * 100}%`, background: n >= 20 ? 'var(--ok)' : 'var(--warn)' }} />
                </span>
                <span className="note">{n}/{MAX_SAMPLES} ภาพ</span>
              </div>
              <button
                className="primary capture"
                onPointerDown={() => start(r.id)}
                onPointerUp={stop}
                onPointerLeave={stop}
                onPointerCancel={stop}
                onContextMenu={(e) => e.preventDefault()}
                disabled={n >= MAX_SAMPLES}
              >
                📸 {capturing === r.id ? 'กำลังเก็บ…' : 'กดค้าง'}
              </button>
              {n > 0 && <button className="link" onClick={() => clear(r.id, r.name)}>ล้าง</button>}
            </div>
          );
        })}
      </div>
      {items.length === 0 && (
        <p className="note">ยังไม่มีรายการของ <Link href="/handouts#items">เพิ่มรายการ</Link></p>
      )}

      <p className="seen-strip">
        <span className="eye">👁️</span>
        {recognizer.ready ? (
          cameraOn && predicted ? (
            <>ตอนนี้กล้องคิดว่าเป็น <b>{predicted}</b> ({Math.round(prediction!.confidence * 100)}%)</>
          ) : (
            <span className="note">เปิดกล้องเพื่อทดสอบ</span>
          )
        ) : (
          <span className="note">สอน “ฉากว่าง” และของอย่างน้อย 1 อย่าง แล้วระบบจะเริ่มทาย</span>
        )}
      </p>
      {error && <p className="alert" onClick={() => setError('')}>{error}</p>}
    </div>
  );
}
