// Reset the app for a new camp week.
//
// Rebuilds every day from scripts/wip-baseline.json (the parsed "WIP 2026"
// master Week-in-Preview grid) so one-off events from previous weeks — guest
// activities, Margarita Monday, etc. — do NOT carry forward. Also clears the
// per-day "confirmed" map (days show as subject-to-change until that day's
// Whatzappening sheet is processed), sets the new week key (devices clear last
// week's sign-ups on next open), and bumps the service-worker cache.
// The check-out Saturday tab (sat2) is kept as-is minus descriptions.
// Drive-processing state is intentionally KEPT (stale files are guarded by
// modifiedTime; wiping state would re-process old files).
//
// Usage: node scripts/new-week.mjs wk-2026-08-29

import { readFileSync, writeFileSync } from 'node:fs';

const week = process.argv[2];
if (!week || !/^[\w-]+$/.test(week)) {
  console.error('usage: node scripts/new-week.mjs <week-key, e.g. wk-2026-08-29>');
  process.exit(1);
}

const data = JSON.parse(readFileSync('data.json', 'utf8'));
if (data.week === week) {
  console.log(`data.json is already on ${week} — nothing to do.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync('scripts/wip-baseline.json', 'utf8')).schedule;
const sat2 = data.schedule.sat2;
data.schedule = JSON.parse(JSON.stringify(baseline)); // fresh template week
if (sat2) {
  for (const sec of Object.values(sat2)) for (const it of sec) delete it.desc;
  data.schedule.sat2 = sat2;
}
data.confirmed = {}; // no day is confirmed until its Whatzappening sheet lands
data.week = week;
writeFileSync('data.json', JSON.stringify(data, null, 1) + '\n');

const sw = readFileSync('sw.js', 'utf8');
const bumped = sw.replace(/camp-app-v(\d+)/, (_, n) => `camp-app-v${Number(n) + 1}`);
if (bumped === sw) throw new Error('could not find cache version in sw.js');
writeFileSync('sw.js', bumped);

const n = Object.values(baseline).reduce((a, d) => a + Object.values(d).reduce((b, s) => b + s.length, 0), 0);
console.log(`Reset for ${week}: schedule rebuilt from WIP baseline (${n} activities), sign-ups will reset on devices, SW bumped (Drive state kept).`);
