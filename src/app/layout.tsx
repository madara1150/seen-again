import type { Metadata, Viewport } from 'next';
import Nav from '@/components/Nav';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import './globals.css';

export const metadata: Metadata = {
  title: 'Face Visit Tracker',
  description: 'บันทึกใบหน้าและเวลาที่พบแต่ละบุคคล พร้อมนับจำนวนครั้งที่มา',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="th">
      <body>
        {isSupabaseConfigured ? (
          <>
            <Nav />
            <main className="container">{children}</main>
          </>
        ) : (
          <main className="container">
            <div className="card setup">
              <h1>ยังไม่ได้ตั้งค่า Supabase</h1>
              <p>
                สร้างไฟล์ <code>.env.local</code> (หรือตั้ง Environment variables ใน Netlify) โดยใส่ค่า{' '}
                <code>NEXT_PUBLIC_SUPABASE_URL</code> และ <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> ตาม{' '}
                <code>.env.example</code> แล้วรันใหม่ ดูขั้นตอนทั้งหมดใน README.md
              </p>
            </div>
          </main>
        )}
      </body>
    </html>
  );
}
