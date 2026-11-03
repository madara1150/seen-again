'use client';

import { useState } from 'react';
import { DEFAULT_SETTINGS, useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase/client';
import { FACES_BUCKET } from '@/lib/supabase/config';
import { removeThumbs } from '@/lib/thumbs';
import { useUser } from '@/lib/useUser';

export default function SettingsPage() {
  const [settings, update] = useSettings();
  const user = useUser();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

  const set = (patch: Parameters<typeof update>[0]) => {
    update(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const deleteAll = async () => {
    if (!user) return;
    if (!confirm('ลบข้อมูลใบหน้า รูป และประวัติทั้งหมดของบัญชีนี้? ไม่สามารถย้อนกลับได้')) return;
    if (prompt('พิมพ์คำว่า ลบ เพื่อยืนยัน') !== 'ลบ') return;
    setBusy(true);
    setMessage('');
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from('people').delete().gt('id', 0);
      if (error) throw error;
      // remove every thumbnail in this user's folder
      for (;;) {
        const { data, error: e } = await supabase.storage.from(FACES_BUCKET).list(user.id, { limit: 100 });
        if (e) throw e;
        if (!data?.length) break;
        await removeThumbs(data.map((f) => `${user.id}/${f.name}`));
      }
      setMessage('ลบข้อมูลทั้งหมดแล้ว');
    } catch (e) {
      setMessage(`ลบไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar-row">
        <h1>ตั้งค่า</h1>
        {saved && <span className="status live">บันทึกแล้ว</span>}
      </div>

      <div className="card settings">
        <h2>การตรวจจับ (เก็บไว้ในเครื่องนี้)</h2>
        <label>
          ชื่อกล้อง/จุดติดตั้ง (แสดงในประวัติ เช่น “ประตูหน้า”)
          <input value={settings.cameraName} onChange={(e) => set({ cameraName: e.target.value })} placeholder="ไม่ระบุ" />
        </label>
        <label>
          ความเข้มงวดในการจับคู่ใบหน้า: {settings.threshold.toFixed(2)}
          <input
            type="range" min="0.35" max="0.65" step="0.01" value={settings.threshold}
            onChange={(e) => set({ threshold: num(e.target.value, DEFAULT_SETTINGS.threshold) })}
          />
          <span className="note">ค่าน้อย = เข้มงวด (แยกคนได้ดีแต่อาจนับคนเดิมเป็นคนใหม่) · ค่ามาก = หลวม (อาจรวมคนหน้าคล้ายเป็นคนเดียว)</span>
        </label>
        <label>
          นับเป็น “ครั้งใหม่” เมื่อหายไปนานกว่า (นาที)
          <input
            type="number" min="0.5" step="0.5" value={settings.gapMinutes}
            onChange={(e) => set({ gapMinutes: num(e.target.value, DEFAULT_SETTINGS.gapMinutes) })}
          />
        </label>
        <label>
          ขนาดใบหน้าขั้นต่ำสำหรับลงทะเบียนคนใหม่ (พิกเซล)
          <input
            type="number" min="40" step="10" value={settings.minFace}
            onChange={(e) => set({ minFace: num(e.target.value, DEFAULT_SETTINGS.minFace) })}
          />
        </label>
      </div>

      <div className="card settings">
        <h2>บัญชี</h2>
        <p>เข้าสู่ระบบด้วย <b>{user?.email ?? '…'}</b></p>
        <p className="note">
          ข้อมูลทั้งหมดเก็บใน Supabase ของคุณ และแยกตามบัญชี (Row Level Security) กล้องหลายตัวที่ล็อกอินบัญชีเดียวกันจะใช้ฐานข้อมูลใบหน้าร่วมกัน
        </p>
        <div className="row">
          <button className="danger" onClick={deleteAll} disabled={busy || !user}>
            {busy ? 'กำลังลบ…' : 'ลบข้อมูลทั้งหมด'}
          </button>
          {message && <span className="note">{message}</span>}
        </div>
      </div>
    </>
  );
}
