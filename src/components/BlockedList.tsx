'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';

interface Block { blockId: string; at: string }

/** People on the block list. There is nothing to show about them but when they were blocked. */
export default function BlockedList() {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('blocked_faces').select('block_id, created_at').order('created_at', { ascending: false });
    if (error) return setError(error.message);
    const seen = new Map<string, Block>();
    for (const r of data ?? []) if (!seen.has(r.block_id)) seen.set(r.block_id, { blockId: r.block_id, at: r.created_at });
    setBlocks([...seen.values()]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const unblock = async (ids: string[]) => {
    const ask =
      ids.length === 1
        ? 'ยกเลิกบล็อกคนนี้? ถ้ามาหน้ากล้องอีก ระบบจะบันทึกเป็นคนใหม่'
        : `ยกเลิกบล็อกทั้งหมด ${ids.length} คน? ถ้ามาหน้ากล้องอีก ระบบจะบันทึกเป็นคนใหม่`;
    if (!confirm(ask)) return;
    const { error } = await getSupabase().from('blocked_faces').delete().in('block_id', ids);
    if (error) setError(error.message);
    load();
  };

  return (
    <div className="card settings">
      <h2>🚫 บุคคลที่บล็อก {blocks && <span className="note">({blocks.length})</span>}</h2>
      <p className="note">
        คนที่ขอไม่ให้เก็บข้อมูล ระบบลบชื่อ รูป ประวัติการมา และการรับของไปแล้ว เหลือแค่ลักษณะใบหน้าที่เป็นตัวเลข
        เพื่อให้กล้องจำได้ว่าห้ามบันทึก (บนวิดีโอจะเห็นเป็นกรอบสีเทา “ไม่บันทึก”) บล็อกคนได้จากหน้ากล้อง หน้าบุคคล หรือเลือกหลายคนที่หน้ารายชื่อ
      </p>
      {error && <p className="alert" onClick={() => setError('')}>{error}</p>}
      {blocks && blocks.length === 0 && <p className="note">ยังไม่มีคนที่ถูกบล็อก</p>}
      {blocks && blocks.length > 0 && (
        <>
          <ul className="blocked-list">
            {blocks.map((b, i) => (
              <li key={b.blockId}>
                <span className="img-ph" aria-hidden>🚫</span>
                <span>คนที่ {blocks.length - i} · บล็อกเมื่อ {fmtDateTime(b.at)}</span>
                <span className="spacer" />
                <button className="link" onClick={() => unblock([b.blockId])}>ยกเลิกบล็อก</button>
              </li>
            ))}
          </ul>
          {blocks.length > 1 && (
            <button onClick={() => unblock(blocks.map((b) => b.blockId))}>ยกเลิกบล็อกทั้งหมด</button>
          )}
        </>
      )}
    </div>
  );
}
