// Reset the app for a new camp week.
//
// Keeps the weekly skeleton (titles/times repeat week to week) but strips all
// activity descriptions, sets the new week key (which makes every device clear
// last week's sign-ups on next open), clears the Drive-processing state so the
// new week's sheets get picked up, and bumps the service-worker cache.
// The daily updater then fills in descriptions as staff publish sheets.
//
// Usage: node scripts/new-week.mjs 2026-wk5

import { readFileSync, writeFileSync } from 'node:fs';

const week = process.argv[2];
if (!week || !/^[\w-]+$/.test(week)) {
  console.error('usage: node scripts/new-week.mjs <week-key, e.g. 2026-wk5>');
  process.exit(1);
}

const data = JSON.parse(readFileSync('data.json', 'utf8'));
if (data.week === week) {
  console.error(`data.json is already on ${week} — refusing to double-reset.`);
  process.exit(1);
}
let stripped = 0;
for (const day of Object.values(data.schedule))
  for (const section of Object.values(day))
    for (const item of section)
      if (item.desc !== undefined) { delete item.desc; stripped++; }
data.week = week;
writeFileSync('data.json', JSON.stringify(data, null, 1) + '\n');

writeFileSync('.bot/last-processed.json', JSON.stringify({ processed: {} }, null, 1) + '\n');

const sw = readFileSync('sw.js', 'utf8');
const bumped = sw.replace(/camp-app-v(\d+)/, (_, n) => `camp-app-v${Number(n) + 1}`);
if (bumped === sw) throw new Error('could not find cache version in sw.js');
writeFileSync('sw.js', bumped);

console.log(`Reset for ${week}: ${stripped} descriptions stripped, Drive state cleared, sign-ups will reset on devices, SW bumped.`);
