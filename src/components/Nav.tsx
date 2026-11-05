'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';

const LINKS = [
  { href: '/', label: 'กล้อง', icon: '📷' },
  { href: '/handouts', label: 'การแจก', icon: '🍱' },
  { href: '/train', label: 'เทรน', icon: '🎓' },
  { href: '/people', label: 'บุคคล', icon: '👥' },
  { href: '/history', label: 'ประวัติการเข้า', icon: '🕒' },
  { href: '/settings', label: 'ตั้งค่า', icon: '⚙️' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname.startsWith('/login') || pathname.startsWith('/kiosk')) return null;

  const signOut = async () => {
    const auth = getSupabase().auth;
    // the server refuses if the account is gone (e.g. deleted); still clear the session here
    const { error } = await auth.signOut();
    if (error) await auth.signOut({ scope: 'local' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="nav">
      <Link href="/" className="brand"><span aria-hidden>👀</span> Seen Again</Link>
      <nav>
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={active ? 'active' : ''}>
              <span aria-hidden>{l.icon}</span> {l.label}
            </Link>
          );
        })}
      </nav>
      <button className="link" onClick={signOut}>ออกจากระบบ</button>
    </header>
  );
}
