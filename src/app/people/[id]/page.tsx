'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rounds, summarize } from '@/lib/handouts';
import { fmtDate, fmtDateTime, fmtDuration, fmtTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';
import { removeThumbs, useThumbUrls } from '@/lib/thumbs';
import { displayName, itemLabel, type Handout, type Item, type Person, type Visit } from '@/lib/types';

export default function PersonPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [others, setOthers] = useState<Person[]>([]);
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const nameLoadedFor = useRef<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const thumb = useThumbUrls([person?.thumb_path, ...visits.map((v) => v.thumb_path)]);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [p, v, o, h, i] = await Promise.all([
      supabase.from('people').select('*').eq('id', id).maybeSingle(),
      supabase.from('visits_numbered').select('*').eq('person_id', id).order('started_at'),
      supabase.from('people').select('id, name').neq('id', id).order('last_seen', { ascending: false }),
      supabase.from('handouts').select('*').eq('person_id', id).order('created_at', { ascending: false }).limit(500),
      supabase.from('items').select('*').order('sort').order('id'),
    ]);
    if (p.error || v.error) return setError((p.error ?? v.error)!.message);
    if (!p.data) return setNotFound(true);
    setPerson(p.data as Person);
    // fill the name field once per person, so polling doesn't overwrite what the user is typing
    if (nameLoadedFor.current !== id) {
      nameLoadedFor.current = id;
      setName((p.data as Person).name);
    }
    setVisits(v.data as Visit[]);
    setOthers((o.data ?? []) as Person[]);
    setHandouts((h.data ?? []) as Handout[]);
    setItems((i.data ?? []) as Item[]);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (notFound) return <p className="empty">ไม่พบบุคคลนี้ <Link href="/people">กลับไปหน้ารายชื่อ</Link></p>;
  if (!person) return <p className="empty">{error || 'กำลังโหลด…'}</p>;

  const saveName = async () => {
    if (name.trim() === person.name) return;
    const { error } = await getSupabase().from('people').update({ name: name.trim() }).eq('id', id);
    if (error) setError(error.message);
    else setPerson({ ...person, name: name.trim() });
  };

  const remove = async () => {
    if (!confirm(`ลบ ${displayName(person)} และประวัติทั้งหมด? ไม่สามารถย้อนกลับได้`)) return;
    const paths = [person.thumb_path, ...visits.map((v) => v.thumb_path)];
    const { error } = await getSupabase().from('people').delete().eq('id', id);
    if (error) return setError(error.message);
    await removeThumbs(paths);
    router.replace('/people');
  };

  const merge = async () => {
    const target = others.find((o) => o.id === Number(mergeTarget));
    if (!target || !confirm(`รวม ${displayName(person)} เข้ากับ ${displayName(target)}? ประวัติทั้งหมดจะย้ายไปอยู่กับ ${displayName(target)}`)) return;
    const { error } = await getSupabase().rpc('merge_people', { p_source: id, p_target: target.id });
    if (error) return setError(error.message);
    router.replace(`/people/${target.id}`);
  };

  const gaps = visits.map((v) => v.gap_seconds).filter((g): g is number => g != null);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const total = visits.reduce((a, v) => a + (new Date(v.ended_at).getTime() - new Date(v.started_at).getTime()), 0);
  const days = new Set(visits.map((v) => new Date(v.started_at).toDateString())).size;
  const hours = Array<number>(24).fill(0);
  visits.forEach((v) => hours[new Date(v.started_at).getHours()]++);
  const maxH = Math.max(1, ...hours);
  const weekdays = Array<number>(7).fill(0);
  visits.forEach((v) => weekdays[new Date(v.started_at).getDay()]++);
  const maxW = Math.max(1, ...weekdays);

  return (
    <>
      <p><Link href="/people">← บุคคลทั้งหมด</Link></p>
      {error && <p className="alert" onClick={() => setError('')}>{error}</p>}

      <div className="card detail-head">
        {thumb(person.thumb_path) ? <img src={thumb(person.thumb_path)} alt="" /> : <span className="img-ph huge" />}
        <div className="grow">
          <input
            className="name"
            value={name}
            placeholder={displayName(person)}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="ชื่อ"
          />
          <div className="kv">
            <div><span>จำนวนครั้งที่มา</span>{visits.length} ครั้ง ({days} วัน)</div>
            <div><span>เจอครั้งแรก</span>{fmtDateTime(visits[0]?.started_at ?? person.created_at)}</div>
            <div><span>เจอล่าสุด</span>{fmtDateTime(person.last_seen)}</div>
            <div><span>ห่างกันเฉลี่ย</span>{avgGap != null ? fmtDuration(avgGap * 1000) : '-'}</div>
            <div><span>เวลารวมหน้ากล้อง</span>{fmtDuration(total)}</div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>ช่วงเวลาที่มาบ่อย</h2>
          <div className="hours">
            {hours.map((n, h) => (
              <div key={h} title={`${h}:00 น. · ${n} ครั้ง`} style={{ height: `${(n / maxH) * 100}%` }} />
            ))}
          </div>
          <div className="hours-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span></div>
        </div>
        <div className="card">
          <h2>วันที่มาบ่อย</h2>
          <div className="weekdays">
            {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d, i) => (
              <div key={d} title={`${weekdays[i]} ครั้ง`}>
                <div className="bar"><div style={{ height: `${(weekdays[i] / maxW) * 100}%` }} /></div>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>ประวัติการมาแต่ละครั้ง</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th /><th>ครั้งที่</th><th>วันที่</th><th>เวลา</th><th>อยู่นาน</th><th>ห่างจากครั้งก่อน</th><th>กล้อง</th></tr>
            </thead>
            <tbody>
              {[...visits].reverse().map((v) => (
                <tr key={v.id}>
                  <td>{thumb(v.thumb_path) ? <img src={thumb(v.thumb_path)} alt="" /> : <span className="img-ph" />}</td>
                  <td>{v.visit_no}</td>
                  <td>{fmtDate(v.started_at)}</td>
                  <td>{fmtTime(v.started_at)} – {fmtTime(v.ended_at)}</td>
                  <td>{fmtDuration(new Date(v.ended_at).getTime() - new Date(v.started_at).getTime())}</td>
                  <td>{v.gap_seconds != null ? fmtDuration(v.gap_seconds * 1000) : 'ครั้งแรก'}</td>
                  <td>{v.camera ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>การรับของ{handouts.length > 0 && <span className="note"> · {rounds(handouts).length} รอบ · รวม {summarize(handouts, items)}</span>}</h2>
        {handouts.length === 0 ? (
          <p className="empty">ยังไม่เคยรับของ</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>วันที่</th><th>เวลา</th><th>รายการ</th><th>กล้อง</th></tr>
              </thead>
              <tbody>
                {handouts.map((h) => (
                  <tr key={h.id}>
                    <td>{fmtDate(h.created_at)}</td>
                    <td>{fmtTime(h.created_at)}</td>
                    <td>{itemLabel(items.find((i) => i.id === h.item_id), h.qty)}</td>
                    <td>{h.camera ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row">
        {others.length > 0 && (
          <>
            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} aria-label="รวมเข้ากับบุคคลอื่น">
              <option value="">รวมเข้ากับบุคคลอื่น (กรณีซ้ำ)…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{displayName(o)}</option>
              ))}
            </select>
            <button onClick={merge} disabled={!mergeTarget}>รวม</button>
          </>
        )}
        <span className="spacer" />
        <button className="danger" onClick={remove}>ลบบุคคลนี้</button>
      </div>
    </>
  );
}
