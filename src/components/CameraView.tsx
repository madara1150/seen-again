'use client';

import type { FaceDetection } from '@vladmandic/face-api';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import HandoutPanel from './HandoutPanel';
import PermissionGate from './PermissionGate';
import { backendName, loadFaceApi, type FaceApi } from '@/lib/faceapi';
import { fmtDuration, fmtTime } from '@/lib/format';
import { ItemRecognizer, ZONES } from '@/lib/items';
import { cameraPermission, hasConsent, listCameras, permStateForError, saveConsent, type PermState } from '@/lib/permission';
import { readSettings, type ItemZone } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase/client';
import { useThumbUrls } from '@/lib/thumbs';
import { FaceTracker, type Detection, type FaceLabel, type FaceResult, type PresentPerson, type TrackerEvent } from '@/lib/tracker';
import { displayName, type Person, type Visit } from '@/lib/types';
import { useUser } from '@/lib/useUser';

const FRAME_INTERVAL = 66; // cap at ~15 fps to leave the GPU some headroom
const ITEM_INTERVAL = 250; // item recognition runs ~4 times a second
const MAX_EVENTS = 50;

interface Stats { people: number; visitsToday: number; peopleToday: number }

export default function CameraView({ kiosk = false }: { kiosk?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const recipientRef = useRef<number | null>(null);
  const user = useUser();

  const [faceapi, setFaceapi] = useState<FaceApi | null>(null);
  const [recognizer, setRecognizer] = useState<ItemRecognizer | null>(null);
  const [recognizerError, setRecognizerError] = useState('');
  const [status, setStatus] = useState('กำลังโหลดโมเดล…');
  const [gate, setGate] = useState<PermState | null>(null);
  const [gateError, setGateError] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [running, setRunning] = useState(false);
  const [inView, setInView] = useState(0);
  const [present, setPresent] = useState<PresentPerson[]>([]);
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const thumbUrl = useThumbUrls(events.map((e) => e.thumbPath));

  const selectRecipient = useCallback((id: number | null) => {
    recipientRef.current = id;
  }, []);

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

  const forgetPeople = useCallback((ids: number[]) => {
    trackerRef.current?.forget(ids).catch((e) => setError(`โหลดข้อมูลไม่สำเร็จ: ${(e as Error).message}`));
    loadStats();
    loadRecent();
  }, [loadStats, loadRecent]);

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

  // item recognition model (13 MB, cached by the browser after the first load)
  useEffect(() => {
    if (!faceapi || !user) return;
    let cancelled = false;
    ItemRecognizer.load(faceapi, getSupabase())
      .then((r) => !cancelled && setRecognizer(r))
      .catch((e) => !cancelled && setRecognizerError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [faceapi, user]);
  const recognizerRef = useRef<ItemRecognizer | null>(null);
  useEffect(() => {
    recognizerRef.current = recognizer;
  }, [recognizer]);

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
    setPresent([]);
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
      let presentKey = '';
      let lastItemStep = 0;
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
            const zone = readSettings().itemZone;
            if (recognizerRef.current && t0 - lastItemStep >= ITEM_INTERVAL) {
              lastItemStep = t0;
              recognizerRef.current.step(frame, zone);
            }
            draw(frame.width, frame.height, overlayRef.current!, labels, recipientRef.current, recognizerRef.current ? zone : null);
            setInView(tracker.inView.size);
            const key = tracker.present.map((p) => `${p.id}:${p.name}:${p.thumbPath}`).join('|');
            if (key !== presentKey) {
              presentKey = key;
              setPresent(tracker.present);
            }
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

  // keep a kiosk tablet's screen on while the camera runs
  useEffect(() => {
    if (!kiosk || !running || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release();
  }, [kiosk, running]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const gateView = gate && (
    <PermissionGate state={gate} errorMessage={gateError} onRequest={requestPermission} onSkip={() => setGate(null)} />
  );

  const controls = (
    <>
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
      <button className={running ? '' : 'primary'} disabled={!faceapi || !user} onClick={toggleCamera}>
        {running ? '⏹ ปิดกล้อง' : '▶ เปิดกล้อง'}
      </button>
    </>
  );

  const errorView = error && (
    <p className="alert" onClick={() => setError('')}>
      {error} <span className="note">(คลิกเพื่อปิด)</span>
    </p>
  );

  const video = (
    <div className="video-wrap">
      <video ref={videoRef} autoPlay muted playsInline />
      <canvas ref={overlayRef} />
      {!running && (
        <div className="placeholder">
          <div>
            <div className="placeholder-icon">📷</div>
            กด “เปิดกล้อง” เพื่อเริ่มตรวจจับใบหน้า
          </div>
        </div>
      )}
    </div>
  );

  const panel = (
    <HandoutPanel
      present={present}
      onSelect={selectRecipient}
      recognizer={recognizer}
      recognizerError={recognizerError}
      cameraOn={running}
      kiosk={kiosk}
      onBlocked={forgetPeople}
    />
  );

  if (kiosk) {
    return (
      <div className="kiosk-shell">
        {gateView}
        <header className="kiosk-bar">
          <span className="brand">👀 Seen Again</span>
          <span className={`status ${running ? 'live' : ''}`}>{status}</span>
          <span className="spacer" />
          {controls}
          <button onClick={toggleFullscreen} title="เต็มจอ" aria-label="เต็มจอ">⛶</button>
          <Link href="/" className="exit">ออก</Link>
        </header>
        {errorView}
        <div className="kiosk-grid">
          {video}
          {panel}
        </div>
      </div>
    );
  }

  return (
    <>
      {gateView}

      <div className="toolbar-row">
        <span className={`status ${running ? 'live' : ''}`}>{status}</span>
        <span className="spacer" />
        <Link href="/kiosk" className="button-link">🖥️ โหมดแท็บเล็ต</Link>
        {controls}
      </div>

      {errorView}

      <div className="camera-layout">
        <div>
          {video}
          <div className="stats">
            <Stat icon="👥" n={stats?.people} label="บุคคลทั้งหมด" />
            <Stat icon="🚪" n={stats?.visitsToday} label="ครั้งที่เข้าวันนี้" />
            <Stat icon="📅" n={stats?.peopleToday} label="คนที่เจอวันนี้" />
            <Stat icon="👀" n={inView} label="อยู่หน้ากล้องตอนนี้" />
          </div>
        </div>

        <div>
          {panel}
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

function Stat({ icon, n, label }: { icon: string; n: number | undefined; label: string }) {
  return (
    <div className="stat">
      <i aria-hidden>{icon}</i>
      <b>{n ?? '–'}</b>
      <span>{label}</span>
    </div>
  );
}

function draw(width: number, height: number, ov: HTMLCanvasElement, labels: FaceLabel[], recipient: number | null, zone: ItemZone | null) {
  ov.width = width;
  ov.height = height;
  const ctx = ov.getContext('2d')!;
  ctx.clearRect(0, 0, ov.width, ov.height);
  const fs = Math.max(14, ov.width / 40);
  if (zone && zone !== 'full') {
    // where the item recogniser looks
    const [zx, zy, zw, zh] = ZONES[zone];
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.strokeRect(zx * width + 4, zy * height + 4, zw * width - 8, zh * height - 8);
    ctx.restore();
  }
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  for (const l of labels) {
    const { x, y, width, height } = l.box;
    const isRecipient = l.personId != null && l.personId === recipient;
    const color = l.blocked ? '#6b7280' : isRecipient ? '#3b82f6' : l.known ? '#22c55e' : '#f59e0b';
    ctx.strokeStyle = color;
    ctx.lineWidth = isRecipient ? 6 : 3;
    ctx.strokeRect(x, y, width, height);
    const tw = ctx.measureText(l.text).width + 12;
    const ty = y > fs + 8 ? y - fs - 8 : y + height;
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.5, ty, tw, fs + 8);
    ctx.fillStyle = isRecipient ? '#fff' : '#000';
    ctx.fillText(l.text, x + 5, ty + fs + 1);
  }
}
