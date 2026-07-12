// Nightly schedule updater.
//
// Reads new Whatzappening sheets (PDF/photo) from the shared Google Drive
// folder, transcribes them with the Anthropic API, merges the result into
// data.json, and bumps the service-worker cache version. The workflow that
// runs this script commits whatever changed. Zero npm dependencies.
//
// Env: ANTHROPIC_API_KEY, plus ONE of:
//      GDRIVE_SERVICE_ACCOUNT — service-account key JSON with Viewer access
//        to the folder (works with a private folder), or
//      GDRIVE_API_KEY — a plain Google API key; requires the folder to be
//        shared as "Anyone with the link: Viewer".
// State: .bot/last-processed.json remembers which Drive files were handled,
//      so staff can name files anything — new/updated files are detected by
//      Drive's modifiedTime metadata.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// Staff have used two share folders: "Whatz App" and "QR Code Whatz 2026"
// (the Jul 9 sheet landed in the latter). Watch both.
const FOLDER_IDS = [
  '1k5smIj_OZ34ZJmpBH5EFogbmuV99NgPN',
  '1QsBxsYgTwzHoIrV3WkCE8THfSkaN5-LY',
];
const STATE_FILE = '.bot/last-processed.json';
// Staff keep planning spreadsheets and notes in the same folder — never
// transcribe those. The "Copy of N ... DO NOT EDIT" docs ARE the published
// weekly sheets (staff copy last week's docs and edit them for the new week;
// "DO NOT EDIT" addresses other staff, not us), so they are processed normally.
// Caution from Jul 11: copies made for the NEXT week can briefly hold the OLD
// week's text right after the Saturday reset — acceptable, since staff edits
// bump modifiedTime and get re-transcribed.
const SKIP_NAME = /^notes|wip 2026/i;
const DATA_FILE = 'data.json';
const SW_FILE = 'sw.js';
const MODEL = 'claude-fable-5';

const DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat2'];
const SECTION_KEYS = ['sunrise', 'noon', 'sunset'];
const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function driveToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    b64url(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    );
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + b64url(signature),
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// auth = {token} (service account) or {apiKey} (public link-shared folder).
function driveFetch(auth, path, params) {
  if (auth.apiKey) params.set('key', auth.apiKey);
  return fetch(`https://www.googleapis.com/drive/v3/${path}?${params}`, {
    headers: auth.token ? { authorization: `Bearer ${auth.token}` } : {},
  });
}

async function listFolder(auth) {
  // One request per folder: with API-key auth, a single combined query 403s
  // outright if ANY referenced folder isn't link-shared. A folder this
  // credential can't see shouldn't kill the run — the other may have sheets.
  const files = [];
  let anyOk = false;
  for (const id of FOLDER_IDS) {
    const res = await driveFetch(auth, 'files', new URLSearchParams({
      q: `'${id}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      orderBy: 'modifiedTime',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    }));
    if (!res.ok) {
      console.warn(`Drive list for folder ${id} failed: ${res.status} — skipping it (not shared with this credential?)`);
      continue;
    }
    anyOk = true;
    files.push(...(((await res.json()).files) || []));
  }
  if (!anyOk) throw new Error('Drive list failed for ALL folders — check credentials/sharing');
  return files;
}

async function downloadFile(auth, file) {
  // Google-native docs get exported to PDF; everything else downloads as-is.
  const native = file.mimeType.startsWith('application/vnd.google-apps');
  const res = native
    ? await driveFetch(auth, `files/${file.id}/export`, new URLSearchParams({ mimeType: 'application/pdf' }))
    : await driveFetch(auth, `files/${file.id}`, new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' }));
  if (!res.ok) throw new Error(`download of ${file.name} failed: ${res.status}`);
  const mediaType = native ? 'application/pdf' : file.mimeType;
  return { data: Buffer.from(await res.arrayBuffer()).toString('base64'), mediaType };
}

// Minimal .docx text extraction (a .docx is a zip; read word/document.xml via
// the central directory so we don't trust local-header sizes). Zero deps.
function docxToText(buf) {
  const eocd = buf.lastIndexOf(Buffer.from('504b0506', 'hex'));
  if (eocd < 0) throw new Error('not a zip');
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    if (name === 'word/document.xml') {
      const lho = buf.readUInt32LE(off + 42);
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const raw = buf.subarray(start, start + csize);
      const xml = (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
      return xml
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    }
    off += 46 + nlen + elen + clen;
  }
  throw new Error('word/document.xml not found');
}

function contentBlock({ data, mediaType }) {
  if (mediaType === 'application/pdf')
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  if (/^image\/(jpeg|png|gif|webp)$/.test(mediaType))
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  if (mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return { type: 'text', text: `Extracted text of the sheet:\n\n${docxToText(Buffer.from(data, 'base64'))}` };
  return null; // unsupported type — skipped by caller
}

const PROMPT = `You maintain data.json for a camp-week schedule PWA (Stanford Sierra Camp, week of Sat Jul 4 - Sat Jul 11, 2026). Attached is a newly published "Whatzappening?!" sheet (or menu sheet) photographed/scanned by camp staff, plus the app's current data.json content.

Transcribe the sheet and produce updates:
- Sheets are often rotated or upside-down - read them in whatever orientation works.
- Match sheet content to the day keys sat/sun/mon/tue/wed/thu/fri (plus sat2 = the final check-out Saturday, Jul 11) using the day headers printed on the sheet (e.g. "Wednesday Evening", "Thursday Morning/Afternoon").
- Sections: morning activities (before ~noon) -> "sunrise", afternoon (~noon-5:45pm) -> "noon", evening (5:45pm onward) -> "sunset". Follow the existing placement in data.json when an activity already exists.
- Each activity: {"time": "6:30-8am", "title": "Rowing*", "desc": "..."}. Omit "desc" if the sheet gives none. Titles that require advance sign-up (shaded on the printed sheet) keep a trailing "*" - preserve existing "*" markers when merging.
- Merge INTO the existing day: keep existing activities (update their desc/time if the sheet revises them), add new ones in chronological order. Do not drop activities that the sheet simply doesn't mention.
- Transcribe descriptions faithfully - keep the staff's jokes and tone; fix only obvious typos.
- Kids Groups get one combined desc: "CRAWDADS: ...\\n\\nMERGANSERS: ...\\n\\nCHICKAREES: ...\\n\\nMARMOTS: ..."
- If the sheet is a weekly menu, update the "menu" side instead, matching the existing shape: menu.<day>.<breakfast|lunch|dinner> = {"name": <string or null>, "groups": [["Group Label", ["item", ...]], ...]}.

Return ONLY a JSON object (no prose, no code fences) of this shape, including ONLY the days/meals the sheet covers:
{"schedule": {"<day>": {"sunrise": [...], "noon": [...], "sunset": [...]}}, "menu": {"<day>": {"lunch": {...}}}, "summary": "<one-line description of what was updated>"}
Each day object under "schedule" must be the COMPLETE replacement for that day (all three sections, merged as described). Omit "schedule" or "menu" entirely if the sheet has nothing for them.`;

async function transcribe(apiKey, block, currentData, fileName) {
  const body = {
    model: MODEL,
    max_tokens: 32000,
    messages: [
      {
        role: 'user',
        content: [
          block,
          {
            type: 'text',
            text: `${PROMPT}\n\nSheet file name (may hint at the day, but trust the printed headers): ${fileName}\n\nCurrent data.json:\n${currentData}`,
          },
        ],
      },
    ],
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const msg = await res.json();
      const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      const jsonText = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      return JSON.parse(jsonText);
    }
    if (attempt < 3 && (res.status === 429 || res.status >= 500 || res.status === 529)) {
      await new Promise((r) => setTimeout(r, attempt * 15000));
      continue;
    }
    throw new Error(`Anthropic API failed: ${res.status} ${await res.text()}`);
  }
}

function validateUpdates(u) {
  if (u.schedule !== undefined) {
    for (const [day, sections] of Object.entries(u.schedule)) {
      if (!DAY_KEYS.includes(day)) throw new Error(`bad day key "${day}"`);
      for (const [sec, items] of Object.entries(sections)) {
        if (!SECTION_KEYS.includes(sec)) throw new Error(`bad section "${sec}" in ${day}`);
        if (!Array.isArray(items)) throw new Error(`${day}.${sec} is not an array`);
        for (const it of items) {
          if (typeof it.title !== 'string' || !it.title) throw new Error(`missing title in ${day}.${sec}`);
          if (typeof it.time !== 'string') throw new Error(`bad time for "${it.title}"`);
          if (it.desc !== undefined && typeof it.desc !== 'string') throw new Error(`bad desc for "${it.title}"`);
          for (const k of Object.keys(it)) if (!['time', 'title', 'desc'].includes(k)) throw new Error(`unexpected key "${k}"`);
        }
      }
      // A replacement day must not be drastically emptier than what it replaces.
      if (!SECTION_KEYS.some((s) => (sections[s] || []).length)) throw new Error(`replacement for ${day} is empty`);
    }
  }
  if (u.menu !== undefined) {
    for (const [day, meals] of Object.entries(u.menu)) {
      if (!DAY_KEYS.includes(day)) throw new Error(`bad menu day "${day}"`);
      for (const [meal, m] of Object.entries(meals)) {
        if (!MEAL_KEYS.includes(meal)) throw new Error(`bad meal "${meal}"`);
        if (m === null) continue;
        if (!Array.isArray(m.groups)) throw new Error(`menu ${day}.${meal} missing groups`);
        for (const g of m.groups) {
          if (!Array.isArray(g) || g.length !== 2 || typeof g[0] !== 'string' || !Array.isArray(g[1]))
            throw new Error(`bad menu group in ${day}.${meal}`);
        }
      }
    }
  }
}

function applyUpdates(data, u) {
  for (const [day, sections] of Object.entries(u.schedule || {})) {
    const existing = data.schedule[day] || {};
    // Guard against the model accidentally dropping most of a day.
    const before = SECTION_KEYS.reduce((n, s) => n + (existing[s] || []).length, 0);
    const after = SECTION_KEYS.reduce((n, s) => n + (sections[s] || []).length, 0);
    if (after < Math.floor(before * 0.6))
      throw new Error(`update for ${day} shrinks it from ${before} to ${after} activities - refusing`);
    data.schedule[day] = { sunrise: sections.sunrise || [], noon: sections.noon || [], sunset: sections.sunset || [] };
  }
  for (const [day, meals] of Object.entries(u.menu || {})) {
    data.menu[day] = { ...(data.menu[day] || {}), ...meals };
  }
}

function bumpSwVersion() {
  const sw = readFileSync(SW_FILE, 'utf8');
  const bumped = sw.replace(/camp-app-v(\d+)/, (_, n) => `camp-app-v${Number(n) + 1}`);
  if (bumped === sw) throw new Error('could not find cache version in sw.js');
  writeFileSync(SW_FILE, bumped);
}

async function main() {
  const sa = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT || 'null');
  const gKey = process.env.GDRIVE_API_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set');
  if (!sa && !gKey) throw new Error('set GDRIVE_SERVICE_ACCOUNT or GDRIVE_API_KEY');

  let state = { processed: {} };
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* first run */ }

  const auth = sa ? { token: await driveToken(sa) } : { apiKey: gKey };
  const files = await listFolder(auth);
  const fresh = files.filter((f) => state.processed[f.id] !== f.modifiedTime);
  console.log(`Drive folder has ${files.length} file(s); ${fresh.length} new/updated.`);
  if (!fresh.length) return;

  let changed = false;
  let failures = 0;
  for (const file of fresh) {
    console.log(`Processing "${file.name}" (${file.mimeType}, modified ${file.modifiedTime})`);
    if (SKIP_NAME.test(file.name)) {
      console.log(`  -> template/notes file (name matches skip-list), marking as seen`);
      state.processed[file.id] = file.modifiedTime;
      continue;
    }
    // One poison file must not discard the whole run: catch per-file errors,
    // leave the file unmarked so the next run retries it, and keep going.
    try {
      const block = contentBlock(await downloadFile(auth, file));
      if (!block) {
        console.log(`  -> unsupported type, skipping (marking as seen)`);
        state.processed[file.id] = file.modifiedTime;
        continue;
      }
      const currentData = readFileSync(DATA_FILE, 'utf8');
      const updates = await transcribe(apiKey, block, currentData, file.name);
      validateUpdates(updates);
      const data = JSON.parse(currentData);
      applyUpdates(data, updates);
      writeFileSync(DATA_FILE, JSON.stringify(data, null, 1) + '\n');
      state.processed[file.id] = file.modifiedTime;
      changed = true;
      console.log(`  -> ${updates.summary || 'updated'}`);
    } catch (e) {
      failures++;
      console.warn(`  -> FAILED on "${file.name}": ${e.message} — will retry next run`);
    }
  }
  if (failures && !changed && !Object.keys(state.processed).length) {
    throw new Error(`${failures} file(s) failed and nothing succeeded`);
  }
  if (failures) console.warn(`${failures} file(s) failed this run; they stay unmarked and will retry.`);

  if (changed) bumpSwVersion();
  mkdirSync('.bot', { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
