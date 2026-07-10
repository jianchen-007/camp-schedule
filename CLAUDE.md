# Camp Week Schedule app — working notes for Claude

PWA (`index.html` + `data.json`) deployed via GitHub Pages. Pushing to `main` IS the
deployment; everyone's installed app updates on next open (network-first service
worker, plus a 🔄 reload button in the header).

## The usual task: fold in photographed camp sheets

Jian photographs the camp's printed sheets and attaches them (or they land in the
shared Drive folder — see Automation below). Transcribe them into `data.json`:

- **"Whatzappening?!" daily sheets** → activity descriptions. Data lives in
  `data.json` under `schedule`: per day (`sat`..`fri`), sections
  `sunrise` / `noon` / `sunset`, entries `{time, title, desc?}`.
- **Titles ending in `*`** = advance sign-up required (shaded on printed sheets);
  the app renders the `*` as an orange SIGN-UP chip. Keep the convention.
- **Kids Groups** get one combined description: `CRAWDADS: ...\n\nMERGANSERS: ...\n\n
  CHICKAREES: ...\n\nMARMOTS: ...`
- **Menus** live in `data.json` under `menu`; verify against the printed "Summer 2026
  Weekly Menu" if changed. Map hotspots live in `MAP_SPOTS` in `index.html`.
- Photos are often rotated or upside-down — rotate before reading. Transcribe
  faithfully (keep the staff's jokes and tone); fix only obvious typos.

## Rules for every change

1. Bump the cache version in `sw.js` (`camp-app-vN` → `vN+1`).
2. Verify the page still renders (serve over HTTP — `data.json` is fetched, so
   `file://` won't load the schedule) before pushing.
3. Commit with a descriptive message and push to `main`.

## Automation (daily sheets from Google Drive)

Staff drop the day's sheet (PDF/photo, any file name) into the shared Drive folder
`1k5smIj_OZ34ZJmpBH5EFogbmuV99NgPN` around 5:45pm PT.
`.github/workflows/daily-schedule-update.yml` runs at 6:15pm and 8:00pm PT (and via
manual dispatch): `scripts/update-schedule.mjs` lists the folder, detects new files
by Drive `modifiedTime` (state in `.bot/last-processed.json`), transcribes them with
the Anthropic API, validates + merges into `data.json` (with a shrink-guard against
data loss), bumps `sw.js`, and the workflow commits to `main`.

Requires repo secrets `GDRIVE_SERVICE_ACCOUNT` (Viewer on the folder) and
`ANTHROPIC_API_KEY`. Failed runs email the repo owner; nothing is published when
validation fails.

The script now watches TWO folders (staff used a second one, "QR Code Whatz 2026",
id 1QsBxsYgTwzHoIrV3WkCE8THfSkaN5-LY, for the Jul 9 drop) and can extract text from
.docx uploads (staff upload docx, which the pipeline previously skipped). Folders
are listed one request each and inaccessible ones are skipped with a warning.
⚠️ The repo currently authenticates with GDRIVE_API_KEY (plain API key), which can
only see folders shared as "Anyone with the link: Viewer". "Whatz App" is; "QR Code
Whatz 2026" is NOT — ask camp staff to link-share it (or add a service account with
Viewer), otherwise that folder is only covered by Jian's local session checks.

## New week reset

To refresh the app for the next camp week: Actions tab → "New week reset" → Run
workflow with a new week key (e.g. `2026-wk5`), or locally
`node scripts/new-week.mjs 2026-wk5` + commit/push. This strips all activity
descriptions (the weekly skeleton of titles/times stays until new sheets arrive),
clears `.bot/last-processed.json`, bumps the SW cache, and changes `data.json`'s
`week` key — which makes every device clear last week's sign-ups on next open.

## Status (update as the week goes)

- Sat Jul 4 – Sat Jul 11, 2026. Detail descriptions COMPLETE for the whole week
  except Friday evening (camp never published detail text for it; grid titles/times
  are in place). Thu evening + Friday added Jul 9 from Drive doc "QR- 6 Stir_Fri"
  (transcribed manually in Jian's Mac session; marked processed in
  .bot/last-processed.json so the workflow won't redo it).
- Automation live: secrets verified, Drive listing works (green runs Jul 8).
