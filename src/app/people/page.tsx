'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtAgo, fmtDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import { displayName, type PersonStats } from '@/lib/types';

export default function PeoplePage() {
  const [people, setPeople] = useState<PersonStats[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const thumb = useThumbUrls(people?.map((p) => p.thumb_path) ?? []);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await getSupabase()
        .from('people_stats')
        .select('*')
        .order('last_seen', { ascending: false });
      if (error) setError(error.message);
      else setPeople(data as PersonStats[]);
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const query = q.trim().toLowerCase();
  const list = (people ?? []).filter((p) => !query || displayName(p).toLowerCase().includes(query));

  return (
    <>
      <div className="toolbar-row">
        <h1>บุคคล {people && <span className="note">({people.length})</span>}</h1>
        <span className="spacer" />
        <input type="search" placeholder="ค้นหาชื่อ…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="alert">{error}</p>}
      {!people && !error && <p className="empty">กำลังโหลด…</p>}
      {people && list.length === 0 && <p className="empty">ยังไม่มีข้อมูลบุคคล — เปิดกล้องเพื่อเริ่มบันทึก</p>}
      <div className="people-list">
        {list.map((p) => (
          <Link key={p.id} href={`/people/${p.id}`} className="person">
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
          </Link>
        ))}
      </div>
    </>
  );
}
