'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fmtDate, fmtDuration, fmtTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import { displayName, type Person, type Visit } from '@/lib/types';

type Row = Visit & { people: Pick<Person, 'id' | 'name'> | null };

const LIMIT = 500;

export default function HistoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const thumb = useThumbUrls(rows?.map((r) => r.thumb_path) ?? []);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await getSupabase()
        .from('visits_numbered')
        .select('*, people(id, name)')
        .order('started_at', { ascending: false })
        .limit(LIMIT);
      if (error) setError(error.message);
      else setRows((data as Row[]).filter((r) => r.people));
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const query = q.trim().toLowerCase();
  const list = (rows ?? []).filter((r) => !query || displayName(r.people!).toLowerCase().includes(query));
  const groups = new Map<string, Row[]>();
  for (const r of list) {
    const k = fmtDate(r.started_at);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <>
      <div className="toolbar-row">
        <h1>ประวัติการเข้า</h1>
        <span className="spacer" />
        <input type="search" placeholder="ค้นหาชื่อ…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="alert">{error}</p>}
      {!rows && !error && <p className="empty">กำลังโหลด…</p>}
      {rows && list.length === 0 && <p className="empty">ยังไม่มีประวัติ</p>}
      {[...groups].map(([day, vs]) => (
        <div key={day} className="card day-group">
          <h3>
            {day} · {vs.length} ครั้ง · {new Set(vs.map((v) => v.person_id)).size} คน
          </h3>
          <div className="table-scroll">
            <table>
              <tbody>
                {vs.map((v) => (
                  <tr key={v.id} className="clickable" onClick={() => router.push(`/people/${v.person_id}`)}>
                    <td>{thumb(v.thumb_path) ? <img src={thumb(v.thumb_path)} alt="" /> : <span className="img-ph" />}</td>
                    <td>{displayName(v.people!)}</td>
                    <td>
                      {v.visit_no === 1 ? <span className="tag new">คนใหม่</span> : <span className="tag back">ครั้งที่ {v.visit_no}</span>}
                    </td>
                    <td>{fmtTime(v.started_at)} – {fmtTime(v.ended_at)}</td>
                    <td>{fmtDuration(new Date(v.ended_at).getTime() - new Date(v.started_at).getTime())}</td>
                    <td className="note">{v.gap_seconds != null ? `ห่างจากครั้งก่อน ${fmtDuration(v.gap_seconds * 1000)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {rows?.length === LIMIT && <p className="note">แสดง {LIMIT} ครั้งล่าสุด</p>}
    </>
  );
}
