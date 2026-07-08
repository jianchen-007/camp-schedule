# Camp Week Schedule app — working notes for Claude

Single-file PWA (`index.html`) deployed via GitHub Pages. Pushing to `main` IS the
deployment; everyone's installed app updates on next open (network-first service worker).

## The usual task: fold in photographed camp sheets

Jian photographs the camp's printed sheets and attaches them (or drops JPGs in the
repo folder). Transcribe them into `index.html`:

- **"Whatzappening?!" daily sheets** → activity descriptions. Data lives in the
  `SCHEDULE` object: per day (`sat`..`fri`), sections `sunrise` / `noon` / `sunset`,
  entries `a('time','Title',"description")`.
- **Titles ending in `*`** = advance sign-up required (shaded on printed sheets);
  the app renders the `*` as an orange SIGN-UP chip. Keep the convention.
- **Kids Groups** get one combined description: `CRAWDADS: ...\n\nMERGANSERS: ...\n\n
  CHICKAREES: ...\n\nMARMOTS: ...`
- **Menus** live in the `MENU` object; verify against the printed "Summer 2026
  Weekly Menu" if changed. Map hotspots live in `MAP_SPOTS`.
- Photos are often rotated or upside-down — rotate before reading. Transcribe
  faithfully (keep the staff's jokes and tone); fix only obvious typos.

## Rules for every change

1. Bump the cache version in `sw.js` (`camp-app-vN` → `vN+1`).
2. Verify the page still renders (open index.html / check JS parses) before pushing.
3. Commit with a descriptive message and push to `main`.

## Status (update as the week goes)

- Sat Jul 4 – Sat Jul 11, 2026. Detail descriptions complete through Wednesday
  afternoon (Tue evening + full Wed morning/afternoon added from Whatzappening sheets).
- Still missing: Wednesday-evening onward "Whatzappening" detail sheets (Wed evening
  + Thu/Fri activities have titles/times from the master grid, no descriptions yet).
