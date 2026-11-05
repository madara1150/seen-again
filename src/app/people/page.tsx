'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fmtAgo, fmtDateTime } from '@/lib/format';
import { BLOCK_CONFIRM, blockPeople, deletePeople } from '@/lib/people';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import { displayName, type PersonStats } from '@/lib/types';

export default function PeoplePage() {
  const [people, setPeople] = useState<PersonStats[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const thumb = useThumbUrls(people?.map((p) => p.thumb_path) ?? []);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('people_stats').select('*').order('last_seen', { ascending: false });
    if (error) setError(error.message);
    else setPeople(data as PersonStats[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const query = q.trim().toLowerCase();
  const list = (people ?? []).filter((p) => !query || displayName(p).toLowerCase().includes(query));
  const chosen = list.filter((p) => picked.has(p.id));

  const toggle = (id: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (action: 'delete' | 'block') => {
    const ids = chosen.map((p) => p.id);
    if (!ids.length) return;
    const ask =
      action === 'delete'
        ? `ลบ ${ids.length} คน พร้อมรูป ประวัติการมา และประวัติการรับของทั้งหมด? ไม่สามารถย้อนกลับได้`
        : `บล็อก ${ids.length} คน: ${BLOCK_CONFIRM}`;
    if (!confirm(ask)) return;
    setBusy(true);
    setError('');
    try {
      await (action === 'delete' ? deletePeople(ids) : blockPeople(ids));
      setMessage(action === 'delete' ? `ลบแล้ว ${ids.length} คน` : `บล็อกแล้ว ${ids.length} คน`);
      setPicked(new Set());
      setSelecting(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar-row">
        <h1>บุคคล {people && <span className="note">({people.length})</span>}</h1>
        <span className="spacer" />
        <input type="search" placeholder="ค้นหาชื่อ…" value={q} onChange={(e) => setQ(e.target.value)} />
        {people && people.length > 0 && (
          <button
            onClick={() => {
              setSelecting((v) => !v);
              setPicked(new Set());
            }}
          >
            {selecting ? 'เสร็จ' : '☑️ เลือก'}
          </button>
        )}
      </div>

      {selecting && (
        <div className="select-bar card">
          <b>เลือกแล้ว {chosen.length} คน</b>
          <button className="link" onClick={() => setPicked(new Set(list.map((p) => p.id)))}>เลือกทั้งหมด</button>
          {chosen.length > 0 && <button className="link" onClick={() => setPicked(new Set())}>ล้าง</button>}
          <span className="spacer" />
          <button onClick={() => run('block')} disabled={!chosen.length || busy}>🚫 บล็อก (ห้ามเก็บข้อมูล)</button>
          <button className="danger" onClick={() => run('delete')} disabled={!chosen.length || busy}>🗑️ ลบ</button>
        </div>
      )}

      {error && <p className="alert" onClick={() => setError('')}>{error}</p>}
      {message && <p className="saved" onClick={() => setMessage('')}>✓ {message}</p>}
      {!people && !error && <p className="empty">กำลังโหลด…</p>}
      {people && list.length === 0 && <p className="empty">ยังไม่มีข้อมูลบุคคล — เปิดกล้องเพื่อเริ่มบันทึก</p>}
      <div className="people-list">
        {list.map((p) => {
          const body = (
            <>
              {selecting && <input type="checkbox" checked={picked.has(p.id)} readOnly tabIndex={-1} aria-hidden />}
              {thumb(p.thumb_path) ? <img src={thumb(p.thumb_path)} alt="" /> : <span className="img-ph big" />}
              <div className="info">
                <div className="name">{displayName(p)}</div>
                <div className="meta">เจอครั้งแรก {fmtDateTime(p.first_visit ?? p.created_at)}</div>
                <div className="meta">ล่าสุด {fmtAgo(p.last_seen)}</div>
              </div>
              <div className="count">
                <b>{p.visit_count}</b>
                <span>ครั้ง</span>
              </div>
            </>
          );
          return selecting ? (
            <button
              key={p.id}
              className={`person ${picked.has(p.id) ? 'picked' : ''}`}
              role="checkbox"
              aria-checked={picked.has(p.id)}
              onClick={() => toggle(p.id)}
            >
              {body}
            </button>
          ) : (
            <Link key={p.id} href={`/people/${p.id}`} className="person">
              {body}
            </Link>
          );
        })}
      </div>
    </>
  );
}
