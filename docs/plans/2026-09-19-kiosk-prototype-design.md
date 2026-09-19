# Kiosk Prototype: Design and Build Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make LiftSafe feel like a product a small business could start using tomorrow: a shared device at the shift-start station, workers sign in with a name tile and PIN, managers unlock their own area. Demoed on a laptop.

**Architecture:** Still a static site with no backend. The roster, PINs (salted SHA-256), records and settings live in the device's localStorage; the signed-in session lives in sessionStorage with an expiry. Pages guard themselves by role and send anyone without a session to the kiosk. This is prototype sign-in: checked in the browser, fine for a demo, and replaced by server auth plus cloud sync in the real product (roadmap slide).

**Tech Stack:** unchanged. Plain ES modules, WebCrypto for PIN hashing, `node --test`.

**Risk control:** the lift check and warm-up change in one place each (where the worker's name comes from). Guest mode keeps today's type-a-name flow, so a judge can try it without being on the roster.

## Pages

| Page | Who | What |
|---|---|---|
| `index.html` | anyone | Landing. Adds "Try the demo" → `app.html` |
| `app.html` | anyone | **First run:** business name, business type, manager PIN, add workers, or one-tap **Load demo business**. **After:** "Who's starting their shift?" name tiles (tick if checked in today), PIN pad, Manager button, Try as guest |
| `worker.html` | worker | Greeting, today's status, streak, certification status, Start warm-up / Lift check, my history and my top tip. Own data only. Sign out |
| `warmup.html`, `check.html` | worker or guest | Use the signed-in worker's name; finish → sign out → kiosk |
| `dashboard.html` | manager | Existing Today + certification views, behind the manager PIN |
| `team.html` | manager | Add/remove workers, reset PINs, business name, business type, recheck interval, export CSV |
| `record.html?id=` | manager | One worker's full history and a printable training record |

## Tasks

1. **`js/auth.js` + tests.** `validPin`, `makePin(pin)` → `{ salt, hash }`, `checkPin(pin, record)`, `startSession(role, worker, now)`, `currentSession(now)` (null when expired), `touchSession(now)`, `endSession()`, `requireRole(roles)`. Worker sessions last 10 min from last activity, manager 15 min.
2. **Roster in `js/store.js` + tests.** `db.business = { name, managerPin }`; workers gain `id` and `pin`. `setBusiness`, `addWorker` (rejects duplicate names), `removeWorker`, `setWorkerPin`, `findWorker`. `load` keeps roster members who have no records yet. `exportCsv(db)`.
3. **Demo business.** Sample workers get ids and a known PIN (1234); manager PIN 9999, shown on the kiosk only in demo mode.
4. **`app.html`** setup + kiosk + PIN pad.
5. **`worker.html`.**
6. **Wire `check.js`, `warmup.js`, `dashboard.js`** to the session (name source, finish → sign out, manager guard).
7. **`team.html`** with settings and CSV export.
8. **`record.html`** printable record.
9. Browser pass, deploy, real run.

## Pitch-only (roadmap slide)
Cloud sync so the owner sees the dashboard from any device · server-side accounts · time-clock integration · weekly email digest · multiple sites · more movement packs.
