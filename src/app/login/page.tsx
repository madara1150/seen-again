'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { loadFaceApi } from '@/lib/faceapi';
import { getSupabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  // start downloading and warming up the face models while the user types
  useEffect(() => {
    loadFaceApi().catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = getSupabase();
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace('/');
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace('/');
          router.refresh();
        } else {
          setMessage({ kind: 'info', text: 'สมัครสำเร็จ กรุณายืนยันอีเมลจากลิงก์ที่ส่งไปก่อนเข้าสู่ระบบ' });
          setMode('signin');
        }
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Face Visit Tracker</h1>
        <p className="note">{mode === 'signin' ? 'เข้าสู่ระบบเพื่อใช้งาน' : 'สร้างบัญชีใหม่'}</p>
        <label>
          อีเมล
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          รหัสผ่าน
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && <p className={message.kind === 'error' ? 'perm-error' : 'note'}>{message.text}</p>}
        <button className="primary big" disabled={busy}>
          {busy ? 'กำลังดำเนินการ…' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'ยังไม่มีบัญชี? สมัครสมาชิก' : 'มีบัญชีแล้ว? เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  );
}
