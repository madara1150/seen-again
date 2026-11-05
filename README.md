<div align="center">

# 👀 Seen Again

**Know who came back, when, and how often — from any camera, right in the browser.**

[English](README.md) · [ภาษาไทย](README.th.md)

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20pgvector-3ecf8e?logo=supabase&logoColor=white)
![face-api.js](https://img.shields.io/badge/face--api.js-WebGL-ff6f00)

</div>

---

Seen Again watches a camera, recognises faces, and keeps a visit log for every person it meets:
the first time they appeared, every time they came back, how long they stayed, and how long it had
been since their last visit.

Face detection and recognition run **entirely in the browser** (WebGL). No video ever leaves the
device — only a 128-number face descriptor, a small thumbnail and timestamps are stored.

## ✨ Features

- **Fast recognition** — ~15 fps on the GPU; a new face is boxed in ~0.2 s and registered in ~0.5 s
- **Visit counting** — a person who has been away longer than a set gap (default 5 min) starts a new visit
- **Per-person insights** — visit count, first/last seen, average gap, time on camera, busiest hours and weekdays
- **Visit history** — every visit numbered, with its thumbnail and the camera that saw it
- **Multiple cameras** — any number of devices share one face database; duplicates across cameras are avoided
- **Hand-outs** — for a food stall or giveaway: records what the person in front of the camera received, with a warning sound if they already came today
- **Item recognition** — teach the camera what each item looks like and it records hand-outs on its own (MobileNet v2 + k-nearest-neighbours, in the browser)
- **Training page** — enrol a face from all around (straight, left, right, up, down) as a named person or straight onto the block list, and teach items from every side
- **Tablet mode** — a full-screen hand-out station at `/kiosk` with big buttons that keeps the screen awake
- **Tidy-up tools** — rename people, merge duplicates, delete one person, several at once, or everything
- **Block list** — someone who asks not to be recorded is blocked: all their data is deleted and the cameras skip their face from then on
- **Private by default** — per-user Row Level Security, private image storage with short-lived signed URLs
- **Camera permission page** — clear guidance for every browser and OS when access is blocked

## 🧠 How it works

```mermaid
flowchart LR
  cam[Camera] --> det[Detect faces<br/>SSD MobileNet]
  det --> trk[Track by overlap<br/>across frames]
  trk -->|new or due| desc[128-d descriptor]
  desc --> match{Known face?<br/>distance &lt; 0.5}
  match -->|yes| rep[record_sighting<br/>every 3 s]
  match -->|seen 3 frames| new[match_face in DB<br/>then register]
  rep --> db[(Supabase<br/>Postgres + pgvector)]
  new --> db
```

1. Every frame the browser finds faces and follows each one across frames, so the expensive
   descriptor is only computed for new faces (and refreshed once a second for known ones).
2. A descriptor is compared against known people by euclidean distance (threshold 0.5).
3. An unknown face seen on 3 frames is checked against the database once more (another camera may
   have just registered it) and only then saved as a new person.
4. While someone stays in view, `record_sighting` runs every 3 s **inside the database, on server
   time**. If they had been gone longer than the gap, it opens a new visit.

## 🚀 Getting started

Choose one setup.

| | Where it runs | Cost | Best for |
|---|---|---|---|
| **A. Home server** | Your own PC + [Tailscale](https://tailscale.com) | Free | Keeping all data at home, using it from anywhere |
| **B. Cloud** | [Supabase](https://supabase.com) + [Netlify](https://netlify.com) | Free tiers | No machine to keep running |

**Requirements:** Node.js 22+. Option A also needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) (on Windows, with WSL 2).

### A. Home server (PC) + use from anywhere

Everything — app, database and images — lives on one PC. Tailscale links the PC with your laptop
over any network and provides the HTTPS certificate the camera requires. Only devices signed in to
your Tailscale account can reach it.

```
Laptop (camera + browser) ──HTTPS via Tailscale──▶ PC: app :3000 ──▶ Supabase (local) :54321
```

The browser talks to Supabase through the app at `/supabase`, so only one port is exposed.

**One-time setup on the PC**

```bash
git clone https://github.com/madara1150/seen-again.git
cd seen-again
npm install
npx supabase start        # first run downloads images; creates tables from supabase/migrations
```

Create `.env.local` with the **Publishable key** printed by `supabase start`:

```env
NEXT_PUBLIC_SUPABASE_URL=/supabase
SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then:

1. Install Tailscale on **both** the PC and the laptop and sign in with the same account.
2. In the [Tailscale admin → DNS](https://login.tailscale.com/admin/dns), enable **MagicDNS** and **HTTPS Certificates**.
3. On the PC run `tailscale serve --bg 3000` — it prints a URL like `https://my-pc.tailxxxx.ts.net`. This persists across reboots.
4. Stop the PC from sleeping.

**Every time you start the PC** (with Docker Desktop running):

```bash
npx supabase start
npm run serve             # production build, port 3000
```

Open the Tailscale URL on your laptop and create your account. Afterwards, turn off sign-ups by
setting `enable_signup = false` under `[auth]` in `supabase/config.toml`, then `npx supabase stop`
and `npx supabase start`.

> [!WARNING]
> Never expose ports 54321–54324 to the internet. Supabase Studio (54323) has no password.
> `npx supabase stop` keeps your data; `npx supabase db reset` and `stop --no-backup` erase it.
> Back up with `npx supabase db dump --data-only -f backup.sql` (images in Storage are not included).

### B. Cloud (Supabase + Netlify)

1. **Supabase** — create a project at [supabase.com](https://supabase.com) (pick a nearby region).
   - Open **SQL Editor**, paste [`supabase/migrations/20261103000000_init.sql`](supabase/migrations/20261103000000_init.sql) and **Run**
     (or `npx supabase link --project-ref <ref>` then `npx supabase db push`).
   - **Authentication → URL Configuration:** set **Site URL** to your Netlify URL and add
     `https://<your-site>.netlify.app/auth/callback` and `http://localhost:3000/auth/callback` to **Redirect URLs**.
   - Copy the **Project URL** and **Publishable key** from **Project Settings → API Keys**.
2. **Netlify** — **Add new site → Import an existing project** and pick this repo.
   Build settings come from `netlify.toml`. Add the environment variables
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then deploy.
3. After creating your account, turn off **Authentication → Sign In / Providers → Allow new users to sign up**.

Free-tier notes: Supabase Free gives ~500 MB database and ~1 GB storage (a thumbnail is ~10 KB) and
pauses projects after ~7 days of inactivity. The ~12 MB face models are cached by the browser
after the first load.

### Local development

```bash
cp .env.example .env.local   # fill in the values
npm install
npx supabase start           # optional: local Supabase via Docker
npm run dev                  # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run serve` | Production build + start |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## ⚙️ Settings

Adjusted per device on the **Settings** page.

| Setting | Default | Meaning |
|---|---|---|
| Match strictness | `0.5` | Lower = stricter; raise it if one person keeps being split into several |
| New-visit gap | `5 min` | Time away before a return counts as a new visit |
| Minimum face size | `80 px` | Ignore faces smaller than this (too far to recognise reliably) |
| Camera name | — | Shown in the history, e.g. "Front door" |

**Multiple cameras:** open the site on each device, sign in with the same account and give each a
camera name. They all share one face database.

## 🍱 Hand-outs (food stall, giveaways)

Track how much was given out, who took what, and when.

1. On **Hand-outs → Items**, add what you give out with a unit, e.g. *Rice box / box*, *Water / bottle*.
2. On the camera page, the **Hand out** panel picks the closest recognised face (outlined in blue).
   With several people in view, tap a name to choose another.
3. Tap an item button to record **+1** for that person. **Undo** removes the last tap.
4. The panel shows what the person already received today. Taps less than 5 minutes apart count as
   one round; a red tag means they are back for another round.
5. The **Hand-outs** page shows, for any day: totals per item, hand-outs per hour, what each person
   received and how many rounds, the full log (with delete), and a **CSV** download for Excel.

Items that were already handed out cannot be deleted — hide them instead, and their history stays.

### 🎓 Training page (`/train`)

**👤 Faces.** One person stands alone in front of the camera and follows the prompts: look straight, turn left,
turn right, tilt up, tilt down. Head pose is measured from the face landmarks and a view is kept only when the head
is in the asked pose; the ring around the face lights up as each angle is done (up/down can be skipped). Then:

- **💾 Save as person** (name optional) — a face already known gets the new angles added instead of a duplicate.
- **🚫 Block this face** — no photo, name or time is stored; only the descriptors go on the block list. If the face
  was already stored, that record is deleted.

**📦 Items.** Pick an item or create one right there, capture the empty zone once (15 views), then press start and
turn the item slowly — up, down, all sides, near and far. Only views that differ from those already stored count,
and a *“turn to a new angle”* prompt appears when you hold one angle too long. It stops at 30 angles; step 4 shows
what the camera now thinks it sees. Hold the item so it nearly fills the dashed frame — a small item in a large
frame cannot be told apart from the empty scene, so the default frame is the centre of the picture.

### 🧠 Teach the camera your items

Instead of tapping, the camera can recognise what is handed over.

1. On the camera page open the **สอนกล้อง** (Teach) tab and pick the zone to watch, e.g. the counter at the bottom
   of the picture (shown as a dashed frame on the video).
2. **Empty scene first:** with nothing held in the zone, press and hold 📸 next to *ฉากว่าง* for ~5 seconds.
3. For each item, hold it in the zone and press and hold 📸 while turning it — about 20 samples, from several
   angles and distances, with and without people around.
4. Back on the hand-out tab, the strip shows what the camera sees. With **อัตโนมัติ** (auto) on, an item seen
   steadily for ~0.75 s is recorded for the selected person; the same item is recorded again only after the zone
   has been empty for ~2 s. **Undo** fixes a wrong guess.

Samples are stored per account in `item_samples`, so every camera on the account shares them. Recognition works
best when items look clearly different (a rice box vs. a water bottle) and the lighting matches the teaching.
The model (~13 MB) is downloaded by `npm install` and cached by the browser after the first load.

### 🖥️ Tablet mode

Open **โหมดแท็บเล็ต** from the camera page (or `/kiosk`) on an iPad or phone at the counter: video and the hand-out
panel only, extra-large buttons, ⛶ for full screen, and the screen stays awake while the camera runs.
Sounds (a chime when recorded, a buzz for repeat takers) can be turned off in Settings.

## 🗂️ Project structure

```
src/
  proxy.ts                  Session refresh; signed-out visitors go to /login
  app/                      Pages: camera (/), /people, /people/[id], /history, /settings, /login
  components/CameraView     Camera, detection loop and permission screens
  components/HandoutPanel   Hand-out buttons and the teach tab next to the camera
  app/kiosk/                Full-screen tablet station
  app/train/                Training: FaceTrainer (guided face angles), ItemTrainer (item from every side)
  lib/pose.ts               Head pose from face landmarks
  lib/items.ts              Item recognition (MobileNet v2 embeddings + k-NN)
  app/handouts/             Daily hand-out summary, CSV export, item list
  lib/tracker.ts            Face tracking, matching, registration and visit reporting
  lib/supabase/             Browser/server clients and the /supabase proxy config
supabase/migrations/        Schema, RLS policies, SQL functions, storage bucket
scripts/copy-models.mjs     Puts face-api models and MobileNet v2 into public/models on npm install
```

**Database:** `people`, `face_descriptors` (`vector(128)`, HNSW index), `visits`, `items`, `handouts`, `item_samples`, `blocked_faces`, plus the views
`people_stats` and `visits_numbered`, and the functions `match_face`, `record_sighting`, `merge_people`, `block_people` and `is_blocked`.

## 🔒 Privacy

Face data that identifies people is **sensitive personal data** under laws such as Thailand's PDPA
(Section 26) and the GDPR. If you point a camera at anyone other than yourself:

- Put up a clear notice that faces are recorded, why, and who is responsible, and obtain consent where required.
- Limit access — disable sign-ups and use a strong password.
- Delete what you no longer need: on a person's page, several people at once with **☑️ เลือก** (Select) on the
  People page, or everything on the Settings page. Deleting removes their photos, visits and hand-outs.
- **Block** people who do not want to be recorded — from the camera panel (🚫 next to the recipient), their page, or
  the People page. Their name, photos, visits and hand-outs are deleted at once; only their face descriptors (numbers,
  no image) stay on the block list so every camera recognises and skips them, shown as a grey “ไม่บันทึก” box.
  Settings → *บุคคลที่บล็อก* lists blocks by date and can lift them.

## 🛠️ Built with

[Next.js](https://nextjs.org) ·
[TypeScript](https://www.typescriptlang.org) ·
[@vladmandic/face-api](https://github.com/vladmandic/face-api) ·
[MobileNet v2](https://github.com/tensorflow/tfjs-models/tree/master/mobilenet) ·
[Supabase](https://supabase.com) (Postgres, pgvector, Auth, Storage) ·
[Tailscale](https://tailscale.com) / [Netlify](https://netlify.com)
