// scripts/update.mjs — ежедневное обновление данных.
// Запускается GitHub Action около 08:20 МСК (и вручную: Actions → Daily update → Run workflow).
//   1) личное расписание с hse.ru/api/timetable  → data/schedule.json
//   2) дедлайны из календаря Smart LMS (iCal)     → data/deadlines.json
//   3) сводка дня для уведомления в 9:00           → data/today.json, data/today.txt
// Секрет DAY_CONFIG (JSON): {"ical": "https://edu.hse.ru/calendar/export_execute.php?…"} (+ необязательный "email" для личного расписания)
// Без секрета: расписание берётся по группе с фильтром твоих подгрупп, дедлайны не трогаются.

import { readFile, writeFile } from 'node:fs/promises';
import { courseKey, kindOf, mskNow, addDays, daySummary, hhmm } from '../planner.js';
import { quoteOf } from '../content.js';

const DATA = new URL('../data/', import.meta.url);
const cfg = (() => { try { return JSON.parse(process.env.DAY_CONFIG || '{}'); } catch { console.warn('DAY_CONFIG: не JSON'); return {}; } })();
const GROUP_ID = 87942; // БМПЭФ264 — 1 курс МИЭФ, группа 4
const MY_GROUP = 4;
// подгруппы и потоки — для режима «по группе», если email не задан
const MY_CODES = [
  /_(МА|ТВИС|ОМ|ИР|ОРГ)_Г_\d+_4#/, /_(МА|ТВИС|ОМ|ИКСИПН.)_П_\d+_1#/, /_ИР_П_\d+_2#/,
  /_АЯ_С_\d+_5#/, /_ИКСИПН._С_\d+_5#/, /_КЯ_С_\d+_1#/, /_ВВФИСИМО_С_\d+_3#/,
];
const LMS_COURSE = {
  1199272: 'calc', 1199342: 'stats', 1199317: 'micro', 1203137: 'hist', 1199611: 'org', 1203648: 'py',
  1199659: 'ics', 1199626: 'eng', 1271519: 'chn', 1271421: 'fe', 1199651: 'bzh',
};

const readJSON = async (name, fallback) => { try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; } };
const writeJSON = (name, obj, compact = false) => writeFile(new URL(name, DATA), JSON.stringify(obj, null, compact ? 0 : 1) + '\n');
const dot = (ymd) => ymd.replace(/-/g, '.');

async function getJSON(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'day-planner (github actions)' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 3000 * (i + 1))); }
  }
  throw err;
}

const shortName = (n = '') => {
  const parts = n.replace(/^Вак_/, '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts.slice(1, 3).map((p) => p[0] + '.').join(' ')}`;
};

function compact(l) {
  return {
    d: l.date.replace(/\./g, '-'),
    s: l.beginLesson, e: l.endLesson,
    c: courseKey(l.discipline),
    k: kindOf(l.kindOfWork),
    r: l.auditorium || '',
    b: /покровск/i.test(l.building || '') ? 'Покровка' : (l.building || ''),
    p: shortName(l.lecturer),
    u: l.url1 || '',
    t: (l.discipline || '').replace(/\s*\((анг|рус)\)\s*$/, ''),
  };
}

async function updateSchedule(today) {
  const prev = await readJSON('schedule.json', { lessons: [] });
  const from = addDays(today, -7), to = addDays(today, 120);
  let raw, source;
  try {
    if (cfg.email) {
      source = 'email';
      raw = (await getJSON(`https://www.hse.ru/api/timetable/lessons?fromdate=${dot(from)}&todate=${dot(to)}&email=${encodeURIComponent(cfg.email)}`)).Lessons || [];
    } else {
      source = 'group';
      raw = ((await getJSON(`https://www.hse.ru/api/timetable/lessons?fromdate=${dot(from)}&todate=${dot(to)}&groupoid=${GROUP_ID}&receiverType=3`)).Lessons || [])
        .filter((l) => MY_CODES.some((re) => re.test(l.group || '')));
    }
  } catch (e) {
    console.warn('Расписание не обновлено:', e.message);
    return { ok: false, source: 'cache', count: prev.lessons.length, error: e.message };
  }
  const lessons = raw.map(compact).sort((a, b) => (a.d + a.s).localeCompare(b.d + b.s));
  const prevFuture = prev.lessons.filter((l) => l.d >= today).length;
  if (!lessons.some((l) => l.d >= today) && prevFuture > 0) {
    console.warn('API вернул пустое расписание — оставляю прежнее');
    return { ok: false, source: 'cache', count: prev.lessons.length, error: 'empty' };
  }
  await writeJSON('schedule.json', { updated: new Date().toISOString(), source, from, to, lessons }, true);
  return { ok: true, source, count: lessons.length };
}

// ── iCal из Smart LMS ──
function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0];
      cur[key] = line.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    }
  }
  return out;
}
const icsToMsk = (v = '') => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v);
  if (!m) return null;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}T23:59`;
  const ts = m[7] ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+03:00`);
  return new Date(ts + 3 * 36e5).toISOString().slice(0, 16);
};
// «Group 1 and Group 11», «gr 2, 8», «Groups 1 - 4», «(1 and 11 groups only!)» → номера групп
export function groupsIn(s) {
  const nums = new Set(); let found = false;
  const addSpec = (spec) => {
    found = true;
    for (const part of spec.split(/\s{0,}(?:,|and|&|\bи\b|group|группа)\s{0,}/i)) {
      const r = /(\d+)\s*[-–—]\s*(\d+)/.exec(part);
      if (r) { for (let n = +r[1]; n <= +r[2] && n - r[1] < 30; n++) nums.add(n); }
      else for (const d of part.match(/\d+/g) || []) nums.add(+d);
    }
  };
  for (const m of s.matchAll(/(?:\bgroups?\b|\bgr\b\.?|групп[аы]?|\bгр\b\.?)\s*#?\s*(\d+(?:\s*(?:,|and|&|и|[-–—])\s*(?:groups?\s*)?\d+)*)/gi)) addSpec(m[1]);
  for (const m of s.matchAll(/(\d+(?:\s*(?:,|and|&|и)\s*\d+)*)\s*(?:groups?|групп[аы]?)\b/gi)) addSpec(m[1]);
  return found ? nums : null;
}
function cleanTitle(t, cat) {
  let title = t.replace(/\s*-\s*must pass\s*$/i, '').replace(/\s+closes$/i, '').replace(/^Submit\s+/i, '').trim();
  if (/ТАЯ/.test(cat || '')) title = `Промежуточный тест по английскому: ${title}`;
  return title;
}

async function updateDeadlines(today) {
  if (!cfg.ical) return { skipped: true };
  const prev = await readJSON('deadlines.json', { items: [] });
  const prevById = new Map(prev.items.map((d) => [d.id, d]));
  let text;
  try {
    const r = await fetch(cfg.ical, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('не iCal (истёк токен?)');
  } catch (e) {
    console.warn('Дедлайны не обновлены:', e.message);
    return { ok: false, error: e.message, count: prev.items.length };
  }
  const n = mskNow();
  const minDue = `${n.ymd}T${hhmm(n.min)}`; // прошедшие события из iCal не показываем — их статус неизвестен
  const items = [];
  for (const ev of parseICS(text)) {
    const sum = ev.SUMMARY || '';
    if (/attendance/i.test(sum) || /\bopens?$/i.test(sum)) continue;
    const g = groupsIn(sum);
    if (g && !g.has(MY_GROUP)) continue;
    const due = icsToMsk(ev.DTSTART);
    if (!due || due < minDue) continue;
    const id = 'lms-' + String(ev.UID || '').split('@')[0];
    const cat = ev.CATEGORIES || '';
    const lmsId = (/^(\d{6,})/.exec(cat) || [])[1];
    const course = (lmsId && LMS_COURSE[lmsId]) || (/ТАЯ/.test(cat) ? 'eng' : courseKey(sum));
    const old = prevById.get(id) || {};
    items.push({
      id, title: cleanTitle(sum, cat), course, due,
      kind: /closes$/i.test(sum) ? 'quiz' : 'assign',
      mustPass: /must pass/i.test(sum) || undefined,
      src: 'lms',
      url: old.url || `https://edu.hse.ru/calendar/view.php?view=day&time=${Math.floor(Date.parse(due + ':00+03:00') / 1000)}`,
    });
  }
  items.sort((a, b) => a.due.localeCompare(b.due));
  await writeJSON('deadlines.json', { updated: new Date().toISOString(), items });
  return { ok: true, count: items.length };
}

async function main() {
  const { ymd: today } = mskNow();
  const schedule = await updateSchedule(today);
  const lms = await updateDeadlines(today);
  console.log('schedule:', schedule, '\nlms:', lms);

  // сводка дня для 9:00
  const lessons = (await readJSON('schedule.json', { lessons: [] })).lessons;
  const extra = (await readJSON('extra.json', { items: [] })).items.filter((d) => !d.until || d.until >= today);
  const deadlines = [...(await readJSON('deadlines.json', { items: [] })).items, ...extra];
  const quote = quoteOf(today);
  const s = daySummary(today, { lessons, deadlines }, quote);
  await writeJSON('today.json', { ymd: today, title: s.title, body: s.body });
  await writeFile(new URL('today.txt', DATA), `${s.title}\n${s.body}\n`);
  await writeJSON('meta.json', { updated: new Date().toISOString(), ymd: today, schedule, lms });
  console.log('\n' + s.title + '\n' + s.body);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
