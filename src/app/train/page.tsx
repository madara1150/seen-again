'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import FaceTrainer from '@/components/FaceTrainer';
import ItemTrainer from '@/components/ItemTrainer';
import { loadFaceApi, type FaceApi } from '@/lib/faceapi';
import { cameraPermission, permStateForError, saveConsent } from '@/lib/permission';

const CAMERA_ERRORS: Record<string, string> = {
  denied: 'เบราว์เซอร์ไม่อนุญาตให้ใช้กล้อง ดูวิธีเปิดสิทธิ์ได้ที่หน้ากล้อง',
  nocamera: 'ไม่พบกล้องในเครื่องนี้',
  busy: 'กล้องถูกโปรแกรมอื่นใช้อยู่ ปิดโปรแกรมนั้นแล้วลองใหม่',
  insecure: 'ต้องเปิดเว็บผ่าน https:// หรือ localhost จึงจะใช้กล้องได้',
  error: 'เปิดกล้องไม่สำเร็จ',
};

/** Training: enrol a face from all around (as a person, or to block it), or teach an item from every side. */
export default function TrainPage() {
  const [mode, setMode] = useState<'face' | 'item'>('face');
  const [faceapi, setFaceapi] = useState<FaceApi | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    loadFaceApi()
      .then(setFaceapi)
      .catch((e) => setError(`โหลดโมเดลไม่สำเร็จ: ${e.message}`));
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setError('');
    if ((await cameraPermission()) === 'insecure') return setError(CAMERA_ERRORS.insecure);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      saveConsent();
      streamRef.current = s;
      setStream(s);
    } catch (e) {
      setError(CAMERA_ERRORS[permStateForError(e)] ?? CAMERA_ERRORS.error);
    }
  };

  return (
    <>
      <div className="toolbar-row">
        <h1>🎓 เทรน</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'face'} className={mode === 'face' ? 'on' : ''} onClick={() => setMode('face')}>
            👤 หน้าคน
          </button>
          <button role="tab" aria-selected={mode === 'item'} className={mode === 'item' ? 'on' : ''} onClick={() => setMode('item')}>
            📦 สิ่งของ
          </button>
        </div>
        <span className="spacer" />
        <button className={stream ? '' : 'primary'} disabled={!faceapi} onClick={stream ? stop : start}>
          {!faceapi ? 'กำลังโหลดโมเดล…' : stream ? '⏹ ปิดกล้อง' : '▶ เปิดกล้อง'}
        </button>
      </div>
      {error && (
        <p className="alert" onClick={() => setError('')}>
          {error} {error === CAMERA_ERRORS.denied && <Link href="/">ไปหน้ากล้อง</Link>}
        </p>
      )}

      {mode === 'face' ? <FaceTrainer faceapi={faceapi} stream={stream} /> : <ItemTrainer faceapi={faceapi} stream={stream} />}
    </>
  );
}
