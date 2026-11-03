'use client';

import { useState } from 'react';
import type { PermState } from '@/lib/permission';

interface Props {
  state: PermState;
  errorMessage?: string;
  onRequest: () => void;
  onSkip: () => void;
}

export default function PermissionGate({ state, errorMessage, onRequest, onSkip }: Props) {
  const [consent, setConsent] = useState(false);

  return (
    <section className="perm-gate" role="dialog" aria-modal="true" aria-labelledby="perm-title">
      <div className="perm-card">
        <div className="perm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        </div>
        <h1 id="perm-title">ขออนุญาตใช้งานกล้อง</h1>

        {state === 'prompt' && (
          <>
            <p>เว็บนี้ต้องใช้กล้องเพื่อตรวจจับใบหน้า บันทึกเวลาที่พบแต่ละบุคคล และนับว่ามากี่ครั้งแล้ว</p>
            <ul className="perm-points">
              <li>การตรวจจับใบหน้าประมวลผลในเบราว์เซอร์ ไม่มีการส่งวิดีโอออกไป</li>
              <li>ระบบเก็บเฉพาะรูปหน้าขนาดเล็ก ข้อมูลลักษณะใบหน้า และเวลาที่พบ ไว้ในฐานข้อมูลของบัญชีคุณ (Supabase)</li>
              <li>ลบข้อมูลรายบุคคลหรือทั้งหมดได้ทุกเมื่อ</li>
              <li>ข้อมูลใบหน้าเป็นข้อมูลอ่อนไหวตาม PDPA หากใช้ในพื้นที่ที่มีผู้อื่น ต้องติดป้ายแจ้งและขอความยินยอม</li>
            </ul>
            <label className="perm-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              ฉันเข้าใจและยินยอมให้ใช้กล้องเพื่อบันทึกใบหน้า
            </label>
            <button className="primary big" disabled={!consent} onClick={onRequest}>
              อนุญาตใช้งานกล้อง
            </button>
            <p className="note">เบราว์เซอร์จะแสดงหน้าต่างถามสิทธิ์ ให้กด “อนุญาต / Allow”</p>
          </>
        )}

        {state === 'requesting' && (
          <p>
            กำลังรอการอนุญาต… กรุณากด <b>“อนุญาต / Allow”</b> ในหน้าต่างของเบราว์เซอร์ (มักอยู่ด้านบนซ้ายของแถบที่อยู่)
          </p>
        )}

        {state === 'denied' && (
          <>
            <p className="perm-error">สิทธิ์การใช้กล้องถูกปฏิเสธ</p>
            <p>วิธีเปิดสิทธิ์อีกครั้ง:</p>
            <ol className="perm-points">
              <li><b>Chrome / Edge:</b> คลิกไอคอนแม่กุญแจหรือไอคอนตั้งค่าข้างแถบที่อยู่ → กล้อง → อนุญาต</li>
              <li><b>Safari:</b> เมนู Safari → การตั้งค่าสำหรับเว็บไซต์นี้ → กล้อง → อนุญาต</li>
              <li><b>Firefox:</b> คลิกไอคอนกล้องที่ถูกขีดฆ่าในแถบที่อยู่ → ล้างการบล็อก</li>
              <li><b>มือถือ:</b> การตั้งค่าเครื่อง → แอปเบราว์เซอร์ → อนุญาตกล้อง</li>
              <li>macOS: การตั้งค่าระบบ → ความเป็นส่วนตัวและความปลอดภัย → กล้อง</li>
            </ol>
            <button className="primary big" onClick={onRequest}>ลองอีกครั้ง</button>
          </>
        )}

        {state === 'nocamera' && (
          <>
            <p className="perm-error">ไม่พบกล้องในเครื่องนี้</p>
            <p>กรุณาเชื่อมต่อกล้อง แล้วกดลองอีกครั้ง</p>
            <button className="primary big" onClick={onRequest}>ลองอีกครั้ง</button>
          </>
        )}

        {state === 'busy' && (
          <>
            <p className="perm-error">กล้องถูกใช้งานโดยโปรแกรมอื่นอยู่</p>
            <p>ปิดโปรแกรมที่ใช้กล้อง (เช่น Zoom, Teams, LINE) แล้วกดลองอีกครั้ง</p>
            <button className="primary big" onClick={onRequest}>ลองอีกครั้ง</button>
          </>
        )}

        {state === 'insecure' && (
          <>
            <p className="perm-error">เบราว์เซอร์ไม่อนุญาตให้ใช้กล้องบนหน้านี้</p>
            <p>กล้องใช้ได้เฉพาะเว็บที่เปิดผ่าน <code>https://</code> หรือ <code>http://localhost</code> เท่านั้น</p>
          </>
        )}

        {state === 'error' && (
          <>
            <p className="perm-error">เปิดกล้องไม่สำเร็จ</p>
            <p>{errorMessage}</p>
            <button className="primary big" onClick={onRequest}>ลองอีกครั้ง</button>
          </>
        )}

        <button className="link" onClick={onSkip}>ปิดหน้านี้ไว้ก่อน</button>
      </div>
    </section>
  );
}
