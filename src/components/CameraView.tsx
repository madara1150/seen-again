'use client';

import type { FaceDetection } from '@vladmandic/face-api';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import PermissionGate from './PermissionGate';
import { backendName, loadFaceApi, type FaceApi } from '@/lib/faceapi';
import { fmtDuration, fmtTime } from '@/lib/format';
import { cameraPermission, hasConsent, listCameras, permStateForError, saveConsent, type PermState } from '@/lib/permission';
import { readSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import { FaceTracker, type Detection, type FaceLabel, type FaceResult, type TrackerEvent } from '@/lib/tracker';
import { displayName, type Person, type Visit } from '@/lib/types';
import { useUser } from '@/lib/useUser';

const FRAME_INTERVAL = 66; // cap at ~15 fps to leave the GPU some headroom
const MAX_EVENTS = 50;

interface Stats { people: number; visitsToday: number; peopleToday: number }

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const user = useUser();

  const [faceapi, setFaceapi] = useState<FaceApi | null>(null);
  const [status, setStatus] = useState('กำลังโหลดโมเดล…');
  const [gate, setGate] = useState<PermState | null>(null);
  const [gateError, setGateError] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [running, setRunning] = useState(false);
  const [inView, setInView] = useState(0);
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const thumbUrl = useThumbUrls(events.map((e) => e.thumbPath));

  // ---------- data ----------
  const loadStats = useCallback(async () => {
    const supabase = getSupabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ count }, { data: todays }] = await Promise.all([
      supabase.from('people').select('id', { count: 'exact', head: true }),
      supabase.from('visits').select('person_id, started_at').gte('ended_at', today.toISOString()),
    ]);
    setStats({
      people: count ?? 0,
      visitsToday: (todays ?? []).filter((v) => new Date(v.started_at) >= today).length,
      peopleToday: new Set((todays ?? []).map((v) => v.person_id)).size,
    });
  }, []);

  const loadRecent = useCallback(async () => {
    const { data } = await getSupabase()
      .from('visits_numbered')
      .select('*, people(id, name)')
      .order('started_at', { ascending: false })
      .limit(20);
    setEvents(
      ((data ?? []) as (Visit & { people: Pick<Person, 'id' | 'name'> | null })[])
        .filter((v) => v.people)
        .map((v) => ({
          key: `db-${v.id}`,
          personId: v.person_id,
          name: displayName(v.people!),
          visitNo: v.visit_no,
          gapSeconds: v.gap_seconds,
          thumbPath: v.thumb_path,
          at: new Date(v.started_at).getTime(),
        }))
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadStats();
    loadRecent();
    const t = setInterval(loadStats, 15000);
    return () => clearInterval(t);
  }, [loadStats, loadRecent]);

  // ---------- models + permission ----------
  useEffect(() => {
    loadFaceApi()
      .then((api) => {
        setFaceapi(api);
        setStatus('พร้อมใช้งาน');
      })
      .catch((e) => setStatus(`โหลดโมเดลไม่สำเร็จ: ${e.message}`));
  }, []);

  const refreshCameras = useCallback(async () => {
    const list = await listCameras();
    setCameras(list);
    setCameraId((id) => id || list[0]?.deviceId || '');
  }, []);

  // ---------- camera ----------
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const ov = overlayRef.current;
    ov?.getContext('2d')?.clearRect(0, 0, ov.width, ov.height);
    setRunning(false);
    setInView(0);
  }, []);

  const startCamera = useCallback(
    async (deviceId = cameraId) => {
      const video = videoRef.current!;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, width: 1280, height: 720 } : { width: 1280, height: 720 },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setRunning(true);
      refreshCameras();
    },
    [cameraId, refreshCameras]
  );

  useEffect(() => {
    let status: PermissionStatus | null = null;
    (async () => {
      const state = await cameraPermission();
      if (state === 'granted' && hasConsent()) refreshCameras();
      else setGate(state === 'denied' || state === 'insecure' ? state : 'prompt');
      try {
        status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        status.onchange = () => {
          if (status!.state === 'denied') {
            stopCamera();
            setGate('denied');
          }
        };
      } catch {
        /* permission query unsupported */
      }
    })();
    return () => {
      if (status) status.onchange = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermission = useCallback(async () => {
    setGate('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
      saveConsent();
      setGate(null);
      await refreshCameras();
    } catch (e) {
      setGateError((e as Error).message);
      setGate(permStateForError(e));
    }
  }, [refreshCameras]);

  const toggleCamera = async () => {
    if (running) return stopCamera();
    const state = await cameraPermission();
    if (state !== 'granted' || !hasConsent()) {
      setGate(state === 'denied' || state === 'insecure' ? state : 'prompt');
      return;
    }
    try {
      await startCamera();
    } catch (e) {
      setGateError((e as Error).message);
      setGate(permStateForError(e));
    }
  };

  useEffect(() => stopCamera, [stopCamera]);

  // ---------- detection loop ----------
  useEffect(() => {
    if (!running || !faceapi || !user) return;
    const video = videoRef.current!;
    const frame = document.createElement('canvas');
    let stopped = false;

    const tracker = new FaceTracker(
      faceapi,
      getSupabase(),
      user.id,
      frame,
      readSettings,
      (e) => {
        setEvents((list) => [e, ...list].slice(0, MAX_EVENTS));
        loadStats();
      },
      setError
    );
    trackerRef.current = tracker;
    // detection starts right away; known faces arrive in the background
    tracker.refresh().catch((e) => setError(`โหลดข้อมูลไม่สำเร็จ: ${(e as Error).message}`));

    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
    const describe = (dets: Detection[]) =>
      new faceapi.DetectAllFaceLandmarksTask(
        Promise.resolve(dets.map((d) => faceapi.extendWithFaceDetection({}, d as FaceDetection))),
        frame,
        false
      ).withFaceDescriptors() as unknown as Promise<FaceResult[]>;

    const backend = backendName(faceapi);
    const accel = backend === 'cpu' ? 'CPU (ช้า)' : `GPU (${backend})`;

    (async () => {
      if (backend === 'cpu') {
        setError('เบราว์เซอร์นี้ประมวลผลด้วย CPU ทำให้ตรวจจับช้ามาก ลองเปิด “Use hardware acceleration” ในการตั้งค่าเบราว์เซอร์ หรือใช้ Chrome/Edge');
      }
      let frames = 0;
      let windowStart = performance.now();
      setStatus(`กำลังตรวจจับ · ${accel}`);
      while (!stopped) {
        const t0 = performance.now();
        if (video.readyState >= 2 && video.videoWidth) {
          try {
            // freeze this frame so detection, descriptors and thumbnails all see the same image
            if (frame.width !== video.videoWidth) {
              frame.width = video.videoWidth;
              frame.height = video.videoHeight;
            }
            frame.getContext('2d')!.drawImage(video, 0, 0);
            const dets = await faceapi.detectAllFaces(frame, opts);
            const labels = await tracker.step(dets, describe);
            if (stopped) break;
            draw(frame.width, frame.height, overlayRef.current!, labels);
            setInView(tracker.inView.size);
            frames++;
          } catch (e) {
            console.error(e);
          }
        }
        const now = performance.now();
        if (now - windowStart >= 1000) {
          setStatus(`กำลังตรวจจับ · ${Math.round((frames * 1000) / (now - windowStart))} fps · ${accel}`);
          frames = 0;
          windowStart = now;
        }
        await new Promise((r) => setTimeout(r, Math.max(0, FRAME_INTERVAL - (now - t0))));
      }
    })();

    return () => {
      stopped = true;
      trackerRef.current = null;
      setStatus('พร้อมใช้งาน');
    };
  }, [running, faceapi, user, loadStats]);

  return (
    <>
      {gate && (
        <PermissionGate state={gate} errorMessage={gateError} onRequest={requestPermission} onSkip={() => setGate(null)} />
      )}

      <div className="toolbar-row">
        <span className={`status ${running ? 'live' : ''}`}>{status}</span>
        <span className="spacer" />
        {cameras.length > 1 && (
          <select
            value={cameraId}
            onChange={async (e) => {
              setCameraId(e.target.value);
              if (running) {
                stopCamera();
                await startCamera(e.target.value).catch((err) => setError(err.message));
              }
            }}
            aria-label="เลือกกล้อง"
          >
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>{c.label || `กล้อง ${i + 1}`}</option>
            ))}
          </select>
        )}
        <button className="primary" disabled={!faceapi || !user} onClick={toggleCamera}>
          {running ? 'ปิดกล้อง' : 'เปิดกล้อง'}
        </button>
      </div>

      {error && (
        <p className="alert" onClick={() => setError('')}>
          {error} <span className="note">(คลิกเพื่อปิด)</span>
        </p>
      )}

      <div className="camera-layout">
        <div>
          <div className="video-wrap">
            <video ref={videoRef} autoPlay muted playsInline />
            <canvas ref={overlayRef} />
            {!running && <div className="placeholder">กด “เปิดกล้อง” เพื่อเริ่มตรวจจับใบหน้า</div>}
          </div>
          <div className="stats">
            <Stat n={stats?.people} label="บุคคลทั้งหมด" />
            <Stat n={stats?.visitsToday} label="ครั้งที่เข้าวันนี้" />
            <Stat n={stats?.peopleToday} label="คนที่เจอวันนี้" />
            <Stat n={inView} label="อยู่หน้ากล้องตอนนี้" />
          </div>
        </div>

        <div>
          <h2>เหตุการณ์ล่าสุด</h2>
          <ul className="event-log">
            {events.length === 0 && <li className="empty">ยังไม่มีเหตุการณ์</li>}
            {events.map((e) => {
              const src = e.thumbUrl ?? thumbUrl(e.thumbPath);
              return (
                <li key={e.key}>
                  {src ? <img src={src} alt="" /> : <span className="img-ph" />}
                  <span>
                    <Link href={`/people/${e.personId}`}><b>{e.name}</b></Link>{' '}
                    {e.visitNo === 1 ? (
                      <span className="tag new">คนใหม่</span>
                    ) : (
                      <span className="tag back">มาครั้งที่ {e.visitNo}</span>
                    )}
                    {e.gapSeconds != null && <> · ห่างจากครั้งก่อน {fmtDuration(e.gapSeconds * 1000)}</>}
                  </span>
                  <time>{fmtTime(e.at)}</time>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}

function Stat({ n, label }: { n: number | undefined; label: string }) {
  return (
    <div className="stat">
      <b>{n ?? '–'}</b>
      <span>{label}</span>
    </div>
  );
}

function draw(width: number, height: number, ov: HTMLCanvasElement, labels: FaceLabel[]) {
  ov.width = width;
  ov.height = height;
  const ctx = ov.getContext('2d')!;
  ctx.clearRect(0, 0, ov.width, ov.height);
  const fs = Math.max(14, ov.width / 40);
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  for (const l of labels) {
    const { x, y, width, height } = l.box;
    const color = l.known ? '#22c55e' : '#f59e0b';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);
    const tw = ctx.measureText(l.text).width + 12;
    const ty = y > fs + 8 ? y - fs - 8 : y + height;
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.5, ty, tw, fs + 8);
    ctx.fillStyle = '#000';
    ctx.fillText(l.text, x + 5, ty + fs + 1);
  }
}
