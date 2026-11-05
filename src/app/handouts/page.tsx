'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fmtDate, fmtTime } from '@/lib/format';
import { rounds, summarize } from '@/lib/handouts';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import { displayName, itemLabel, type Handout, type Item, type Person } from '@/lib/types';

type Row = Handout & { people: Pick<Person, 'id' | 'name' | 'thumb_path'> | null };

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function HandoutsPage() {
  const [day, setDay] = useState(() => toDateInput(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const thumb = useThumbUrls(rows?.map((r) => r.people?.thumb_path) ?? []);

  const load = useCallback(async () => {
    const [y, m, d] = day.split('-').map(Number);
    const from = new Date(y, m - 1, d);
    const to = new Date(y, m - 1, d + 1);
    const supabase = getSupabase();
    const [h, i] = await Promise.all([
      supabase
        .from('handouts')
        .select('*, people(id, name, thumb_path)')
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString())
        .order('created_at', { ascending: false }),
      supabase.from('items').select('*').order('sort').order('id'),
    ]);
    if (h.error || i.error) return setError((h.error ?? i.error)!.message);
    setRows(h.data as Row[]);
    setItems(i.data as Item[]);
  }, [day]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const remove = async (r: Row) => {
    if (!confirm(`ลบรายการ ${itemLabel(itemById(items, r.item_id), r.qty)} ของ ${r.people ? displayName(r.people) : ''} เวลา ${fmtTime(r.created_at)}?`)) return;
    const { error } = await getSupabase().from('handouts').delete().eq('id', r.id);
    if (error) setError(error.message);
    else load();
  };

  const list = rows ?? [];

  // totals per item
  const perItem = items
    .map((i) => ({ item: i, qty: list.filter((r) => r.item_id === i.id).reduce((a, r) => a + r.qty, 0) }))
    .filter((t) => t.qty > 0);

  // per person, most received first
  const people = new Map<number, Row[]>();
  for (const r of list) people.set(r.person_id, [...(people.get(r.person_id) ?? []), r]);
  const perPerson = [...people.values()]
    .map((rs) => ({ person: rs[0].people, rows: rs, rounds: rounds(rs), total: rs.reduce((a, r) => a + r.qty, 0) }))
    .sort((a, b) => b.rounds.length - a.rounds.length || b.total - a.total);
  const roundCount = perPerson.reduce((a, p) => a + p.rounds.length, 0);
  const repeat = perPerson.filter((p) => p.rounds.length > 1).length;

  // quantity handed out per hour
  const hours = Array<number>(24).fill(0);
  list.forEach((r) => (hours[new Date(r.created_at).getHours()] += r.qty));
  const maxH = Math.max(1, ...hours);
  const busiest = hours.indexOf(Math.max(...hours));

  const exportCsv = () => {
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['เวลา', 'รหัสบุคคล', 'บุคคล', 'รายการ', 'จำนวน', 'หน่วย', 'กล้อง'].map(esc).join(','),
      ...[...list].reverse().map((r) => {
        const item = itemById(items, r.item_id);
        return [
          new Date(r.created_at).toLocaleString('th-TH'),
          r.person_id,
          r.people ? displayName(r.people) : '',
          item?.name ?? '',
          r.qty,
          item?.unit ?? '',
          r.camera,
        ].map(esc).join(',');
      }),
    ];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `handouts-${day}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="toolbar-row">
        <h1>การแจก</h1>
        <input type="date" value={day} max={toDateInput(new Date())} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="วันที่" />
        <span className="spacer" />
        <button onClick={exportCsv} disabled={!list.length}>ดาวน์โหลด CSV</button>
      </div>
      {error && <p className="alert" onClick={() => setError('')}>{error}</p>}

      <div className="totals">
        {perItem.map((t) => (
          <div key={t.item.id} className="stat">
            <i aria-hidden>{t.item.emoji || '📦'}</i>
            <b>{t.qty}{t.item.unit && <small> {t.item.unit}</small>}</b>
            <span>{t.item.name}</span>
          </div>
        ))}
        <div className="stat"><i aria-hidden>🙋</i><b>{perPerson.length}</b><span>ผู้รับ (คน)</span></div>
        <div className="stat"><i aria-hidden>🔁</i><b>{roundCount}</b><span>รอบที่แจก</span></div>
        <div className="stat"><i aria-hidden>⚠️</i><b>{repeat}</b><span>คนที่รับมากกว่า 1 รอบ</span></div>
      </div>

      <div className="card">
        <h2>
          ช่วงเวลาที่แจก
          {list.length > 0 && <span className="note"> · แจกมากที่สุดช่วง {busiest}:00–{busiest + 1}:00 น. ({hours[busiest]} ชิ้น)</span>}
        </h2>
        <div className="hours">
          {hours.map((n, h) => (
            <div key={h} title={`${h}:00 น. · ${n} ชิ้น`} style={{ height: `${(n / maxH) * 100}%` }} />
          ))}
        </div>
        <div className="hours-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span></div>
      </div>

      <div className="card">
        <h2>แต่ละคนรับอะไรไปบ้าง · {fmtDate(new Date(day + 'T00:00'))}</h2>
        {rows && !perPerson.length ? (
          <p className="empty">ยังไม่มีการแจกในวันนี้</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th /><th>บุคคล</th><th>รอบ</th><th>รับไป</th><th>เวลาที่รับ</th></tr>
              </thead>
              <tbody>
                {perPerson.map((p) => (
                  <tr key={p.rows[0].person_id}>
                    <td>{thumb(p.person?.thumb_path) ? <img src={thumb(p.person?.thumb_path)} alt="" /> : <span className="img-ph" />}</td>
                    <td>
                      <Link href={`/people/${p.rows[0].person_id}`}>{p.person ? displayName(p.person) : `#${p.rows[0].person_id}`}</Link>
                    </td>
                    <td>{p.rounds.length > 1 ? <span className="tag warn">{p.rounds.length} รอบ</span> : '1 รอบ'}</td>
                    <td className="wrap">{summarize(p.rows, items)}</td>
                    <td className="wrap">{p.rounds.map((r) => fmtTime(r.at).slice(0, 5)).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>รายการทั้งหมด</h2>
        {list.length === 0 ? (
          <p className="empty">–</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>เวลา</th><th>บุคคล</th><th>รายการ</th><th>กล้อง</th><th /></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtTime(r.created_at)}</td>
                    <td><Link href={`/people/${r.person_id}`}>{r.people ? displayName(r.people) : `#${r.person_id}`}</Link></td>
                    <td>{itemLabel(itemById(items, r.item_id), r.qty)}</td>
                    <td>{r.camera ?? '-'}</td>
                    <td><button className="link" onClick={() => remove(r)}>ลบ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ItemsEditor items={items} onChange={load} />
    </>
  );
}

const itemById = (items: Item[], id: number) => items.find((i) => i.id === id);

function ItemsEditor({ items, onChange }: { items: Item[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [emoji, setEmoji] = useState('');
  const [message, setMessage] = useState('');

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const sort = Math.max(0, ...items.map((i) => i.sort)) + 1;
    const { error } = await getSupabase().from('items').insert({ name: name.trim(), unit: unit.trim(), emoji: emoji.trim(), sort });
    if (error) return setMessage(error.message);
    setName('');
    setUnit('');
    setEmoji('');
    setMessage('');
    onChange();
  };

  const update = async (item: Item, patch: Partial<Item>) => {
    if (patch.name !== undefined && !patch.name.trim()) return onChange(); // revert an emptied name
    const { error } = await getSupabase().from('items').update(patch).eq('id', item.id);
    setMessage(error ? error.message : '');
    onChange();
  };

  const remove = async (item: Item) => {
    if (!confirm(`ลบรายการ “${item.name}”?`)) return;
    const { error } = await getSupabase().from('items').delete().eq('id', item.id);
    if (error?.code === '23503') setMessage(`“${item.name}” มีประวัติการแจกแล้ว จึงลบไม่ได้ ใช้ “ซ่อน” แทน`);
    else if (error) setMessage(error.message);
    else onChange();
  };

  return (
    <div className="card" id="items">
      <h2>รายการของที่แจก</h2>
      <p className="note">ปุ่มในหน้ากล้องจะเรียงตามรายการนี้ ใส่ emoji เป็นไอคอนได้ รายการที่ซ่อนจะไม่แสดงปุ่ม แต่ประวัติยังอยู่ · สอนกล้องให้รู้จักของได้ที่หน้ากล้อง แท็บ “สอนกล้อง”</p>
      <div className="items-edit">
        {items.map((i) => (
          <div key={`${i.id}-${i.name}-${i.unit}-${i.emoji}`} className={`row ${i.archived ? 'archived' : ''}`}>
            <input className="emoji" defaultValue={i.emoji} placeholder="🍱" aria-label="ไอคอน" maxLength={4} onBlur={(e) => e.target.value !== i.emoji && update(i, { emoji: e.target.value.trim() })} />
            <input className="name" defaultValue={i.name} aria-label="ชื่อรายการ" onBlur={(e) => e.target.value !== i.name && update(i, { name: e.target.value.trim() })} />
            <input className="unit" defaultValue={i.unit} placeholder="หน่วย" aria-label="หน่วย" onBlur={(e) => e.target.value !== i.unit && update(i, { unit: e.target.value.trim() })} />
            <button onClick={() => update(i, { archived: !i.archived })}>{i.archived ? 'แสดง' : 'ซ่อน'}</button>
            <button className="link" onClick={() => remove(i)}>ลบ</button>
          </div>
        ))}
        <form className="row" onSubmit={add}>
          <input className="emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🍱" aria-label="ไอคอนของรายการใหม่" maxLength={4} />
          <input className="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ข้าวกล่อง" aria-label="ชื่อรายการใหม่" />
          <input className="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="หน่วย เช่น กล่อง" aria-label="หน่วยของรายการใหม่" />
          <button className="primary" disabled={!name.trim()}>เพิ่ม</button>
        </form>
      </div>
      {message && <p className="alert" onClick={() => setMessage('')}>{message}</p>}
    </div>
  );
}
