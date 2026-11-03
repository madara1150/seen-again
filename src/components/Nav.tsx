'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';

const LINKS = [
  { href: '/', label: 'กล้อง' },
  { href: '/people', label: 'บุคคล' },
  { href: '/history', label: 'ประวัติการเข้า' },
  { href: '/settings', label: 'ตั้งค่า' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname.startsWith('/login')) return null;

  const signOut = async () => {
    await getSupabase().auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="nav">
      <Link href="/" className="brand">Face Visit Tracker</Link>
      <nav>
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={active ? 'active' : ''}>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <button className="link" onClick={signOut}>ออกจากระบบ</button>
    </header>
  );
}
