# Face Visit Tracker (Next.js + Supabase)

เว็บตรวจจับใบหน้าจากกล้อง บันทึกว่าแต่ละคนมาเมื่อไหร่ กี่ครั้ง ห่างกันเท่าไหร่ ใช้กล้องหลายตัวร่วมกันได้

- **Next.js 16 + TypeScript**: ตรวจจับใบหน้าในเบราว์เซอร์ด้วย face-api.js ไม่มีการส่งวิดีโอขึ้นเซิร์ฟเวอร์
- **Supabase**: ใช้ Postgres + pgvector เก็บข้อมูลใบหน้าและการมาแต่ละครั้ง, Storage เก็บรูปหน้า, Auth ใช้ล็อกอิน
- **Netlify**: ใช้ deploy

## การทำงาน

1. ทุก ~250ms เบราว์เซอร์จะตรวจจับใบหน้าและคำนวณ descriptor (ตัวเลข 128 ค่า) ของแต่ละหน้า
2. เทียบกับใบหน้าที่รู้จัก (ระยะห่าง < ค่าความเข้มงวด ค่าเริ่มต้น 0.5)
3. หน้าที่ไม่รู้จักและเห็นต่อเนื่อง 3 เฟรม ระบบจะถามฐานข้อมูลอีกครั้ง (`match_face`) เผื่อกล้องอื่นเพิ่งบันทึกคนนี้ ถ้าไม่พบจึงบันทึกเป็นคนใหม่
4. ระหว่างที่คนยังอยู่หน้ากล้อง ระบบจะรายงาน `record_sighting` ทุก 3 วินาที ฟังก์ชันนี้รันในฐานข้อมูลและใช้เวลาของเซิร์ฟเวอร์ ถ้าคนนั้นหายไปนานกว่าที่ตั้งไว้ (ค่าเริ่มต้น 5 นาที) จะนับเป็น "ครั้งใหม่"

## ตั้งค่า (ครั้งเดียว)

### 1. Supabase (ฟรี)

1. สมัครที่ https://supabase.com แล้วกด **New project** เลือก region ที่ใกล้ (เช่น Singapore)
2. ไปที่ **SQL Editor** แล้ว copy เนื้อหาไฟล์ [`supabase/migrations/20261103000000_init.sql`](supabase/migrations/20261103000000_init.sql) ไปวางแล้วกด **Run** ขั้นนี้จะสร้างตาราง สิทธิ์ (RLS) ฟังก์ชัน และ bucket `faces`
   - หรือใช้ CLI: `npx supabase link --project-ref <ref>` แล้วตามด้วย `npx supabase db push`
3. **Authentication → URL Configuration**
   - ช่อง **Site URL**: ใส่ URL ของ Netlify เช่น `https://your-site.netlify.app`
   - ช่อง **Redirect URLs**: เพิ่ม `https://your-site.netlify.app/auth/callback` และ `http://localhost:3000/auth/callback`
4. **Project Settings → API Keys**: copy ค่า **Project URL** และ **Publishable key** (หรือ anon key แบบเดิมก็ใช้ได้)
5. (แนะนำ) หลังสมัครบัญชีของตัวเองแล้ว ให้ปิดการสมัครสมาชิกใหม่ที่ **Authentication → Sign In / Providers → Allow new users to sign up** เพื่อกันคนอื่นมาสมัคร

### 2. รันในเครื่อง

```bash
cp .env.example .env.local   # ใส่ค่า URL และ key จากขั้นตอนที่ 1
npm install
npm run dev                  # http://localhost:3000
```

ทดสอบกับ Supabase ในเครื่องก็ได้ (ต้องมี Docker): `npx supabase start` แล้วใช้ URL/key ที่คำสั่งนี้แสดง

### 3. Deploy บน Netlify (ฟรี)

1. push โปรเจกต์นี้ขึ้น GitHub
2. https://app.netlify.com → **Add new site → Import an existing project** → เลือก repo
3. Netlify จะอ่านค่า build จาก `netlify.toml` เอง
4. **Site configuration → Environment variables** เพิ่ม
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. กด **Deploy** (ถ้าเพิ่ม env หลัง deploy ครั้งแรก ต้องกด Trigger deploy ใหม่) แล้วอย่าลืมใส่ URL ที่ได้กลับไปตั้งใน Supabase (ขั้นตอน 1.3)

> กล้องใช้ได้บน `https://` เท่านั้น (Netlify เป็น https ให้อยู่แล้ว) หรือบน `localhost`

## รันบน PC ที่บ้านเป็น server แล้วเข้าใช้จากที่อื่น (ไม่ต้องใช้ cloud)

แบบนี้ทุกอย่างอยู่บน PC เครื่องเดียว ใช้ [Tailscale](https://tailscale.com) (ฟรี) เชื่อม PC กับ MacBook ให้ใช้งานได้แม้อยู่คนละเครือข่าย และได้ HTTPS ซึ่งจำเป็นสำหรับการใช้กล้อง เข้าเว็บได้เฉพาะอุปกรณ์ที่ล็อกอิน Tailscale บัญชีเดียวกันเท่านั้น

```
MacBook (กล้อง + เบราว์เซอร์) ──HTTPS ผ่าน Tailscale──▶ PC: Next.js :3000 ──▶ Supabase ในเครื่อง :54321
```

เบราว์เซอร์คุยกับ Supabase ผ่าน path `/supabase` ของเว็บ จึงเปิดออกไปข้างนอกแค่พอร์ตเดียว

### ติดตั้งบน PC (ครั้งเดียว)

1. ติดตั้ง [Node.js 22 LTS ขึ้นไป](https://nodejs.org), [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows ต้องเปิด WSL 2) และ Git
2. ย้ายโปรเจกต์ไปที่ PC โดย copy โฟลเดอร์นี้ไปทั้งโฟลเดอร์ (ไม่ต้องเอา `node_modules` และ `.next` ไป) หรือ push ขึ้น GitHub แบบ private แล้ว clone
3. ในโฟลเดอร์โปรเจกต์ ให้รัน
   ```bash
   npm install
   npx supabase start
   ```
   คำสั่ง `supabase start` ครั้งแรกจะโหลด image นานหลายนาที เมื่อเสร็จจะสร้างตารางจาก `supabase/migrations` ให้อัตโนมัติ และแสดงค่า **Publishable key**
4. สร้างไฟล์ `.env.local`
   ```
   NEXT_PUBLIC_SUPABASE_URL=/supabase
   SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Publishable key จากขั้นที่ 3>
   ```
5. ติดตั้ง Tailscale บน **ทั้ง PC และ MacBook** แล้วล็อกอินบัญชีเดียวกัน
6. ที่ https://login.tailscale.com/admin/dns ให้เปิด **MagicDNS** และ **HTTPS Certificates**
7. บน PC รัน
   ```bash
   tailscale serve --bg 3000
   ```
   คำสั่งนี้จะแสดง URL เช่น `https://my-pc.tailxxxx.ts.net` ใช้ URL นี้เปิดเว็บบน MacBook ได้ และไม่ต้องรันซ้ำเมื่อรีสตาร์ตเครื่อง
8. ตั้ง PC ไม่ให้ sleep (Windows: Settings → System → Power → Sleep = Never)

### เปิดใช้งาน (ทุกครั้งที่เปิดเครื่อง)

เปิด Docker Desktop ก่อน แล้วรัน

```bash
npx supabase start
npm run serve
```

`npm run serve` จะ build แล้วรันแบบ production ที่พอร์ต 3000 หลังจากนั้นเปิด URL ของ Tailscale บน MacBook

### หลังสร้างบัญชีของตัวเองแล้ว

ปิดการสมัครสมาชิกใหม่โดยแก้ `supabase/config.toml` ในส่วน `[auth]` เป็น `enable_signup = false` แล้วรัน `npx supabase stop` ตามด้วย `npx supabase start`

### ข้อควรระวัง

- ห้ามเปิดพอร์ต 54321–54324 ออกไปข้างนอกเด็ดขาด โดยเฉพาะ Studio (54323) ซึ่งไม่มีรหัสผ่าน ให้เปิดผ่าน Tailscale แค่พอร์ต 3000 ตามข้างบนเท่านั้น
- `npx supabase stop` ข้อมูลยังอยู่ แต่ `npx supabase db reset` หรือ `stop --no-backup` จะลบข้อมูลทั้งหมด
- สำรองข้อมูลด้วย `npx supabase db dump --data-only -f backup.sql` (คำสั่งนี้ไม่รวมรูปใน Storage)

## ใช้หลายกล้อง

เปิดเว็บบนแต่ละเครื่องแล้วล็อกอินด้วยบัญชีเดียวกัน จากนั้นตั้ง **ชื่อกล้อง** ในหน้าตั้งค่า (เช่น "ประตูหน้า") ทุกกล้องจะใช้ฐานข้อมูลใบหน้าเดียวกัน และประวัติจะบอกว่าแต่ละครั้งเห็นจากกล้องไหน

## ข้อจำกัดแพ็กเกจฟรี (ตรวจสอบตัวเลขล่าสุดที่หน้า pricing)

- **Supabase Free**
  - ฐานข้อมูลประมาณ 500MB และ Storage ประมาณ 1GB (รูปหน้ารูปละประมาณ 10KB)
  - ถ้าไม่มีการใช้งานประมาณ 7 วัน โปรเจกต์จะถูกพัก ต้องเข้าไปกด Restore ใน dashboard
- **Netlify Free**: มีโควตา bandwidth และ build ต่อเดือน ซึ่งพอสำหรับใช้งานภายใน โมเดลตรวจจับหน้า (~12MB) ถูกตั้งให้ cache ในเบราว์เซอร์ จึงโหลดแค่ครั้งแรก

## ความเป็นส่วนตัว (PDPA)

ข้อมูลใบหน้าที่ใช้ระบุตัวบุคคลเป็นข้อมูลอ่อนไหว (มาตรา 26) ควรปฏิบัติดังนี้
- ติดป้ายแจ้งว่ามีการบันทึกใบหน้า ระบุวัตถุประสงค์และผู้ควบคุมข้อมูล และขอความยินยอมตามที่กฎหมายกำหนด
- จำกัดผู้เข้าถึง (ปิดการสมัครสมาชิกใหม่ ใช้รหัสผ่านที่แข็งแรง)
- ลบข้อมูลที่ไม่จำเป็นแล้ว ลบรายบุคคลได้ที่หน้าบุคคลนั้น หรือลบทั้งหมดในหน้าตั้งค่า

## โครงสร้าง

```
src/
  proxy.ts                 ตรวจ session และส่งคนที่ยังไม่ล็อกอินไปหน้า /login
  app/                     หน้า: กล้อง (/), /people, /people/[id], /history, /settings, /login
  components/CameraView    กล้อง + loop ตรวจจับ + หน้าขอสิทธิ์กล้อง
  lib/tracker.ts           ตรรกะการจับคู่ใบหน้า การลงทะเบียนคนใหม่ และการรายงานการมา
supabase/migrations/       schema, RLS, ฟังก์ชัน, storage bucket
scripts/copy-models.mjs    copy model face-api ไป public/models ตอน npm install
```
