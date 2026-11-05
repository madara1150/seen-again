'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fmtTime } from '@/lib/format';
import { ROUND_GAP_MS, rounds, summarize } from '@/lib/handouts';
import { readSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import type { PresentPerson } from '@/lib/tracker';
import { itemLabel, type Handout, type Item } from '@/lib/types';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Hand-over panel next to the camera: the closest recognised face is picked automatically,
 * shows what they already received today, and one tap records an item for them.
 */
export default function HandoutPanel({
  present,
  onSelect,
}: {
  present: PresentPerson[];
  /** the recipient is highlighted on the video */
  onSelect: (personId: number | null) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [today, setToday] = useState<Handout[]>([]);
  const [selected, setSelected] = useState<PresentPerson | null>(null);
  const [last, setLast] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0); // refreshed with the data, to tell an old round from the current one
  const [error, setError] = useState('');
  const thumb = useThumbUrls([selected?.thumbPath, ...present.map((p) => p.thumbPath)]);

  // follow the camera: keep the current person while in view, else switch to the closest face;
  // when nobody is in view keep the last one so a late tap still goes to the right person
  const current = selected && present.find((p) => p.id === selected.id);
  if (present.length && !current) setSelected(present[0]);
  else if (current && (current.name !== selected!.name || current.thumbPath !== selected!.thumbPath)) setSelected(current);

  useEffect(() => onSelect(selected?.id ?? null), [selected?.id, onSelect]);

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

  const give = async (item: Item) => {
    if (!selected) return;
    setBusy(true);
    setError('');
    const { data, error } = await getSupabase()
      .from('handouts')
      .insert({ person_id: selected.id, item_id: item.id, qty: 1, camera: readSettings().cameraName.trim() || null })
      .select('*')
      .single<Handout>();
    setBusy(false);
    if (error) return setError(`บันทึกไม่สำเร็จ: ${error.message}`);
    setToday((list) => [data, ...list]);
    setNow(new Date(data.created_at).getTime());
    setLast({ id: data.id, text: `${itemLabel(item, 1)} → ${selected.name}` });
  };

  const undo = async () => {
    if (!last) return;
    const { error } = await getSupabase().from('handouts').delete().eq('id', last.id);
    if (error) return setError(`ยกเลิกไม่สำเร็จ: ${error.message}`);
    setToday((list) => list.filter((h) => h.id !== last.id));
    setLast(null);
  };

  const active = (items ?? []).filter((i) => !i.archived);
  const mine = selected ? today.filter((h) => h.person_id === selected.id) : [];
  const myRounds = rounds(mine);
  // a tap within the current round is expected; only an earlier round today is a repeat
  const repeat = myRounds.length > 1 || (myRounds.length === 1 && now - new Date(mine[0].created_at).getTime() > ROUND_GAP_MS);
  const inView = !!current;

  return (
    <div className="card handout">
      <div className="toolbar-row">
        <h2>แจกของ</h2>
        <span className="spacer" />
        <Link href="/handouts" className="note">สรุปการแจก →</Link>
      </div>

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
        <div className={`recipient ${inView ? '' : 'away'}`}>
          {thumb(selected.thumbPath) ? <img src={thumb(selected.thumbPath)} alt="" /> : <span className="img-ph big" />}
          <div>
            <Link href={`/people/${selected.id}`}><b>{selected.name}</b></Link>
            <div className="note">{inView ? 'อยู่หน้ากล้อง' : 'ไม่อยู่หน้ากล้องแล้ว'}</div>
            {mine.length ? (
              <div className={`tag ${repeat ? 'warn' : 'back'}`}>
                {repeat ? `วันนี้รับไปแล้ว ${myRounds.length} รอบ` : 'รอบนี้'}: {summarize(mine, items ?? [])} · ล่าสุด {fmtTime(mine[0].created_at)}
              </div>
            ) : (
              <div className="tag new">ยังไม่ได้รับวันนี้</div>
            )}
          </div>
        </div>
      ) : (
        <p className="empty">รอใบหน้าผู้รับหน้ากล้อง…</p>
      )}

      {items && active.length === 0 ? (
        <p className="note">
          ยังไม่มีรายการของ <Link href="/handouts#items">เพิ่มรายการ</Link>
        </p>
      ) : (
        <div className="give-grid">
          {active.map((i) => (
            <button key={i.id} className="give" disabled={!selected || busy} onClick={() => give(i)}>
              {i.name}
              <span>+1{i.unit ? ` ${i.unit}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      {last && (
        <p className="saved">
          ✓ บันทึก {last.text} <button className="link" onClick={undo}>ยกเลิก</button>
        </p>
      )}
      {error && <p className="alert" onClick={() => setError('')}>{error}</p>}

      <p className="note">
        วันนี้แจกไปแล้ว {today.length ? summarize(today, items ?? []) : '–'} · ผู้รับ {new Set(today.map((h) => h.person_id)).size} คน
      </p>
    </div>
  );
}
