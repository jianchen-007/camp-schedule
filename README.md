# Camp Week Schedule 2026 🏕️

A self-contained PWA with the Stanford Sierra Camp week schedule, dining menus, an
interactive camp map, and a personal sign-up tracker. Live at:

**https://jianchen-007.github.io/camp-schedule/** — scan `qr-code.png` to open it.

## How it works

- **The whole app is `index.html`** — HTML, CSS, JS, and all schedule/menu data in one
  file. No build step, no dependencies. Edit it, push, done.
- Schedule data lives in the `SCHEDULE` object (per day: `sunrise` / `noon` / `sunset`
  arrays of `a(time, title, description)`). Menus live in `MENU`. Map hotspots in
  `MAP_SPOTS`.
- Titles ending in `*` render an orange **SIGN-UP** chip (activities that need advance
  sign-up in the notebook — the shaded rows on the camp's printed sheets).
- Users' checked-off activities are saved in `localStorage` on their device only.
  There is no server or account.

## Making changes — two rules

1. **Bump the cache version in `sw.js`** (`camp-app-v8` → `-v9`, etc.) with every
   content change, or phones may serve stale copies.
2. **Pushing to `main` deploys.** GitHub Pages serves this repo directly — everyone's
   installed app picks up the new version on next open (the service worker is
   network-first with a 3s offline fallback).

## Data sources

Content is transcribed from the camp's printed "Whatzappening?!" daily sheets, the
"Week in Preview" master grid, and the "Summer 2026 Weekly Menu". Days/times change —
the printed board is authoritative. Map hotspots come from
whatzappening.com/interactive-map, adapted for touch.
