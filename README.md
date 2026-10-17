# BPIN Service CRM

Field-service CRM for Blaupunkt India (BPIN): service engineers file visit/assessment reports on products, admins monitor, analyze, remind (push notifications), and export reports.

- **Frontend** — Vite + React + Tailwind v4 (`frontend/`), mobile-first (Android/iOS), monochrome Blaupunkt design
- **Backend** — Node + Express 5 (`backend/`), MongoDB Atlas + Mongoose, Passport local strategy with **session cookies** (no tokens), Multer → Cloudinary for images, Web Push for reminders
- **Reports** — per-day/technician/model/problem aggregations, **CSV + PDF export** with the Blaupunkt logo

## Visit form

Product (searchable SKU catalog) → serial number (typed or **scanned via camera QR** — the QR payload is the serial directly; falls back to manual entry) → customers' reported problem → **preloaded problem list** (seeded from your CRM Warranty Report; admins add/archive) — picking *Other* makes the problem name + a detailed description **mandatory** → optional assessment notes → up to 4 photos (compressed on-device before upload).

On submit, a token is generated for the day: `DDMMYYYY-NNNN` (e.g. `16102026-0001`, `-0002`, resetting daily). Admins see an **Activity** screen per day and can **Nudge** zero-activity engineers — an in-app notification + a real Web Push to their subscribed phones.

## Project layout

```
backend/
  index.js            entry: express app, session, passport, routes, prod static hosting
  db.js               mongoose connection
  passport.js         local strategy
  models/             User, Product, Problem, ServiceRecord, Counter, Notification, PushSubscription
  routes/             auth, products, problems, records, notifications, push, reports, users
  utils/              token (DDMMYYYY-NNNN), exporters (CSV/PDF), cloudinary, web-push, dates
  seed/seed.js        loads products + 13 engineers + problems from ../csvs xlsx files
  assets/             BL Logo.jpg (PDF header)
frontend/
  src/pages/          tech: Home, NewReport (QR + photos), Records, Detail, Notifications, Profile
                      admin: Dashboard (charts), Reports (+CSV/PDF), Activity (+Nudge), Users, Problems
  src/components/     AppShell, ProductSelect, QRScanner, ImageUploader, ui primitives
  public/sw.js        service worker for Web Push
```

## Setup

### 1. Backend

```bash
cd backend
npm install              # if dev deps matter: env has NODE_ENV=production? use: npm ci --include=dev
```

Edit `backend/.env`:

| Key | What to put |
|---|---|
| `DB_URL` | Your MongoDB Atlas connection string (keep `/bpin` as database name) — **required** |
| `SESSION_SECRET` | Already generated; rotate for production |
| `CLOUDINARY_*` | Your Cloudinary cloud/key/secret — **required for photo upload** (app still works without photos if blank) |
| `VAPID_*` | Optional: `npx web-push generate-vapid-keys` — enables real push notifications; in-app bell works without it |
| `ADMIN_EMAIL/PASSWORD` | Super-admin email + the password to give seeded admins (choose your own; values never live in this repo) |
| `TECH_DEFAULT_PASSWORD` | Login password for the 13 seeded engineers — pick your own; admins can reset per user in the app |

Seed (idempotent, safe to re-run):

```bash
npm run seed     # products (~900), 13 technicians, ~25 problems, 1 admin
```

Run:

```bash
npm run dev      # http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install                # same NODE_ENV caveat: prefer  npm ci --include=dev
npm run dev                # http://localhost:5173  (proxies /api → :5000)
```

Sign in at `localhost:5173` with `ADMIN_EMAIL`/`ADMIN_PASSWORD` (admin) or a seeded engineer `email` + `TECH_DEFAULT_PASSWORD` (technician).

> ⚠️ This machine has `NODE_ENV=production` exported in the shell, which makes npm skip devDependencies (vite/tailwind). Use `npm ci --include=dev` or run commands from a normal shell.

### 3. Production

```bash
cd frontend && npm run build     # → frontend/dist
cd ../backend && npm run start   # serves the built SPA on the same origin (sessions just work)
```

QR camera scanning and Web Push **require HTTPS** in production (deploy behind HTTPS; on iOS also enable push < 16.4 unsupported). Serving frontend+backend from one origin avoids CORS pain — recommended.

## Notes

- **Accounts** — the super admin (`ADMIN_EMAIL`, badge "Super admin") is for IT. The 7 staff admins (Riyaz, Sakir, Murugesh, Kailash, Subhash, Pankaj Sir, Kiran) are seeded from `seed/seed.js` → `ADMIN_ACCOUNTS` with `ADMIN_PASSWORD`; everyone changes their own password in Profile.
- **Assignments** — admins hand out visits (`POST /api/assignments`: technician, customer name/phone, address/pincode, visit date + timing, notes). The engineer gets an in-app + push notification and sees it under **Visits**; marking done is possible by the assigned engineer or an admin.
- **Casing a case** — records start `open`. Closing requires a **work-done description** (mandatory) and optional proof photos. Allowed only for the engineer who filed it or any admin; the closure stamps who/when + resolution on the detail page.
- Files in `csvs/` are read only at seed time; admins can re-import products via `POST /api/products/import`.
- Watch the console when seeding — counts print at the end.
- The Cloudinary credentials found in `backend/.env` must be verified as yours before going live.
