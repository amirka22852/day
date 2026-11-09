// app.js — интерфейс «Моего дня»
import {
  planDay, mskNow, hhmm, addDays, dowOf, mondayOf, daysBetween, dateText, DOW_FULL, DOW_SHORT,
  durText, courseName, COURSES, dueText, dueTs, urgency, kindOf, DEFAULT_SETTINGS, plural, toMin,
} from './planner.js';
import { quoteOf, tipOf, hanziOf } from './content.js';

const REPO = 'amirka22852/day';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('day.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('day.' + k, JSON.stringify(v)); } catch { return; } }, // приватный режим: без сохранения
};

const state = {
  view: 'today',
  date: null,
  weekStart: null,
  settings: { ...DEFAULT_SETTINGS, ...LS.get('settings', {}) },
  done: LS.get('done', {}),
  dlDone: LS.get('dlDone', {}),
  mine: LS.get('mine', []),
  data: { lessons: [], deadlines: [], extra: [], meta: null, loadedAt: 0, error: null },
  weather: LS.get('weather', null),
  intro: true,
  lastTickMin: null,
  hideInstall: LS.get('hideInstall', false),
};

// ───────── иконки ─────────
const I = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  week: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

// ───────── данные ─────────
async function loadJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadData() {
  const [s, d, x, m] = await Promise.allSettled(['data/schedule.json', 'data/deadlines.json', 'data/extra.json', 'data/meta.json'].map(loadJSON));
  if (s.status === 'fulfilled') state.data.lessons = s.value.lessons || [];
  if (d.status === 'fulfilled') state.data.deadlines = d.value.items || [];
  if (x.status === 'fulfilled') state.data.extra = x.value.items || [];
  if (m.status === 'fulfilled') state.data.meta = m.value;
  state.data.error = s.status === 'rejected' ? 'Нет связи — показываю сохранённые данные' : null;
  state.data.loadedAt = Date.now();
}

function controlsFromSchedule(fromYmd) {
  const map = new Map();
  for (const l of state.data.lessons) {
    if (kindOf(l.k) !== 'Контрольная' || l.d < fromYmd) continue;
    const id = `ctl-${l.d}-${l.c}`;
    const c = map.get(id) || { id, title: `Контрольная: ${courseName(l.c)}`, course: l.c, due: `${l.d}T${l.s}`, kind: 'control', src: 'hse', s: l.s, e: l.e, rooms: new Set() };
    if (toMin(l.s) < toMin(c.s)) { c.s = l.s; c.due = `${l.d}T${l.s}`; }
    if (toMin(l.e) > toMin(c.e)) c.e = l.e;
    if (l.r) c.rooms.add(l.r);
    map.set(id, c);
  }
  return [...map.values()].map((c) => ({ ...c, note: `${c.s}–${c.e} · ауд. ${[...c.rooms].join(', ')}`, rooms: undefined }));
}
function allDeadlines() {
  const today = mskNow().ymd;
  const list = [
    ...state.data.deadlines,
    ...state.data.extra.filter((d) => !d.until || d.until >= today),
    ...state.mine.map((d) => ({ ...d, src: 'mine' })),
    ...controlsFromSchedule(today),
  ];
  const seen = new Set();
  return list.filter((d) => d.due && !seen.has(d.id) && seen.add(d.id))
    .map((d) => ({ ...d, done: !!state.dlDone[d.id] }))
    .sort((a, b) => a.due.localeCompare(b.due));
}
const ctx = () => ({ lessons: state.data.lessons, deadlines: allDeadlines(), settings: state.settings, today: mskNow().ymd });

// ───────── погода (Open-Meteo, Москва) ─────────
const WMO = {
  0: 'ясно', 1: 'почти ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 48: 'изморозь',
  51: 'морось', 53: 'морось', 55: 'сильная морось', 56: 'ледяная морось', 57: 'ледяная морось',
  61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь', 66: 'ледяной дождь', 67: 'ледяной дождь',
  71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежная крупа', 80: 'ливень', 81: 'ливень', 82: 'сильный ливень',
  85: 'снегопад', 86: 'сильный снегопад', 95: 'гроза', 96: 'гроза с градом', 99: 'гроза с градом',
};
async function loadWeather(force = false) {
  if (!force && state.weather && Date.now() - state.weather.at < 40 * 60e3) return;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6173&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FMoscow&forecast_days=3&wind_speed_unit=ms';
    const r = await fetch(url);
    if (!r.ok) return;
    state.weather = { at: Date.now(), j: await r.json() };
    LS.set('weather', state.weather);
    if (state.view === 'today') render();
  } catch { return; } // без погоды — не страшно
}
function weatherFor(ymd) {
  const j = state.weather && state.weather.j;
  if (!j || !j.daily) return null;
  const i = j.daily.time.indexOf(ymd);
  if (i < 0) return null;
  const today = ymd === mskNow().ymd && j.current;
  const code = today ? j.current.weather_code : j.daily.weather_code[i];
  const t = today ? Math.round(j.current.temperature_2m) : Math.round(j.daily.temperature_2m_max[i]);
  const feels = today ? Math.round(j.current.apparent_temperature) : null;
  const min = Math.round(j.daily.temperature_2m_min[i]), max = Math.round(j.daily.temperature_2m_max[i]);
  const pp = j.daily.precipitation_probability_max[i] ?? 0;
  const advice = [];
  const cold = Math.min(min, feels ?? min);
  if (cold <= -10) advice.push('тёплая куртка, шапка, перчатки');
  else if (cold <= 0) advice.push('шапка и перчатки');
  else if (cold <= 8) advice.push('куртка');
  if ([61, 63, 65, 66, 67, 80, 81, 82, 51, 53, 55].includes(code) || (pp >= 50 && cold > 0)) advice.push('зонт');
  if ([71, 73, 75, 77, 85, 86, 56, 57, 66, 67].includes(code)) advice.push('скользко — обувь с протектором');
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + '°';
  return {
    v: `${sign(t)}, ${WMO[code] || '—'}`,
    s: `${today ? `ощущается ${sign(feels)} · ` : ''}днём ${sign(min)}…${sign(max)}${pp ? ` · осадки ${pp}%` : ''}`,
    advice: advice.length ? advice.join(', ') : 'одевайся по погоде',
  };
}

// ───────── утилиты интерфейса ─────────
function phaseOf(min) { return min < 300 ? 'night' : min < 600 ? 'dawn' : min < 1020 ? 'day' : min < 1260 ? 'dusk' : 'night'; }
function leftText(min) {
  min = Math.max(0, Math.ceil(min));
  if (min < 60) return { big: String(min), unit: 'мин' };
  return { big: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`, unit: 'ч' };
}
const colorVar = (type) => `var(--c-${type === 'deadline' ? 'deadline' : type})`;
function toast(text) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = text;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2600);
}
const saveSettings = () => LS.set('settings', state.settings);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function currentOf(plan, nowMin) {
  const W = plan.wake;
  if (nowMin < W) return { item: { type: 'sleep', title: 'Сон', start: plan.bed - 1440, end: W, sub: `подъём в ${hhmm(W)}` }, left: W - nowMin };
  const cur = plan.items.find((i) => i.type !== 'deadline' && i.start <= nowMin && nowMin < i.end);
  if (cur) return { item: cur, left: cur.end - nowMin };
  const next = plan.items.find((i) => i.type !== 'deadline' && i.start > nowMin);
  return next ? { next, left: next.start - nowMin } : null;
}

// ───────── циферблат ─────────
function dialSVG(plan, nowMin, isToday, deadlines) {
  const C = 160, R = 124;
  const ang = (m) => (((m % 1440) + 1440) % 1440) / 1440 * 360 + 180;
  const pt = (deg, r) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];
  const path = (m1, m2, r) => {
    let sweep = ((m2 - m1) / 1440) * 360; sweep = Math.min(sweep, 359.8);
    const a1 = ang(m1); const [x1, y1] = pt(a1, r); const [x2, y2] = pt(a1 + sweep, r);
    return { d: `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`, len: (r * sweep * Math.PI) / 180 };
  };
  let s = '';
  // деления
  for (let h = 0; h < 24; h++) {
    const major = h % 6 === 0;
    const [x1, y1] = pt(ang(h * 60), R + 14); const [x2, y2] = pt(ang(h * 60), R + (major ? 22 : 18));
    s += `<line class="tick${major ? ' major' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    if (major) { const [tx, ty] = pt(ang(h * 60), R + 34); s += `<text class="hour" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}">${String(h).padStart(2, '0')}</text>`; }
  }
  s += `<circle class="track" cx="${C}" cy="${C}" r="${R}"/>`;
  let i = 0;
  const arcs = [{ type: 'sleep', start: plan.bed - 1440, end: plan.wake }, ...plan.items.filter((it) => !['free', 'deadline', 'sleep'].includes(it.type))];
  for (const it of arcs) {
    if (it.end - it.start < 1) continue;
    const p = path(it.start, it.end, R);
    const cls = ['arc'];
    if (it.type === 'commute') cls.push('dash');
    if (['meal', 'morning', 'winddown'].includes(it.type)) cls.push('thin');
    if (isToday && it.end <= nowMin && it.type !== 'sleep') cls.push('past');
    const anim = it.type === 'commute' ? '' : ` style="--len:${p.len.toFixed(1)};stroke-dasharray:${p.len.toFixed(1)} 2000;--i:${i++}"`;
    s += `<path class="${cls.join(' ')}" d="${p.d}" stroke="${colorVar(it.type)}"${anim}/>`;
  }
  // дедлайны дня — ромбики снаружи
  for (const d of deadlines) {
    const m = toMin(d.due.slice(11, 16));
    const [x, y] = pt(ang(m), R + 6);
    s += `<rect class="dl-mark" x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" rx="1.5" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  if (isToday) {
    const a = ang(nowMin);
    const [hx, hy] = pt(a, R - 30); const [ex, ey] = pt(a, R + 12); const [dx, dy] = pt(a, R);
    s += `<line class="hand" x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"/>`;
    s += `<circle class="now-glow" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="13"/><circle class="now-dot" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="5.5"/>`;
  }
  return `<svg class="dial${state.intro ? ' intro' : ''}" viewBox="-20 -20 360 360" role="img" aria-label="Циферблат дня: 24 часа, полночь внизу">${s}</svg>`;
}

// ───────── экран «Сегодня» ─────────
function rowHTML(it, ctxNow) {
  const { isToday, nowMin } = ctxNow;
  const compact = ['commute', 'free', 'meal', 'morning', 'winddown'].includes(it.type);
  const done = it.type === 'deadline' ? !!state.dlDone[it.ref] : !!state.done[it.id];
  const cls = ['row', it.type];
  if (compact) cls.push('compact');
  if (isToday && it.type !== 'deadline') {
    if (it.end <= nowMin && it.type !== 'sleep') cls.push('past');
    else if (it.start <= nowMin && nowMin < it.end) cls.push('now');
  }
  if (done) cls.push('done');
  if (it.hot) cls.push('hot');
  const isNow = cls.includes('now');
  let title = esc(it.title), sub = it.sub ? esc(it.sub) : '', meta = [];
  if (it.type === 'class' || it.type === 'control') {
    sub = [esc(it.kind), it.online ? 'онлайн' : it.room ? `ауд.&nbsp;${esc(it.room)}` : '', esc(it.lecturer).replace(/ /g, '&nbsp;')].filter(Boolean).join(' · ');
    if (it.note) meta.push(`<span>${esc(it.note)}</span>`);
    if (it.url) meta.push(`<a href="${esc(it.url)}" target="_blank" rel="noopener">ссылка на пару</a>`);
  }
  if (it.type === 'study') {
    title = `${it.at === 'uni' ? 'Учёба в окне' : 'Учёба'} · ${durText(it.end - it.start)}`;
    sub = '';
    meta = [];
  }
  if (it.type === 'deadline' && it.url) meta.push(`<a href="${esc(it.url)}" target="_blank" rel="noopener">открыть в LMS</a>`);
  const nowTag = isNow ? `<span class="nowtag">ещё ${leftText(it.end - nowMin).big} ${leftText(it.end - nowMin).unit}</span>` : '';
  const tasks = it.type === 'study' && it.tasks ? `<ul class="tasks">${it.tasks.map((t) => `<li class="${t.hot ? 'hot' : ''}"><span class="tt">${esc(t.title)}</span>${t.sub ? `<span class="ts">${esc(t.sub)}</span>` : ''}</li>`).join('')}</ul>` : '';
  const checkable = it.check || it.type === 'deadline';
  const checkBtn = checkable
    ? `<button class="check" data-act="${it.type === 'deadline' ? 'dl-check' : 'check'}" data-id="${esc(it.type === 'deadline' ? it.ref : it.id)}" aria-pressed="${done}" aria-label="${done ? 'Отменить отметку' : 'Отметить сделанным'}: ${esc(it.checkLabel || it.title)}">${I.check}</button>`
    : '<span></span>';
  const end = it.end > it.start && !compact && it.type !== 'deadline' ? `<small>${hhmm(it.end)}</small>` : '';
  return `<li class="${cls.join(' ')}" style="--rc:${colorVar(it.type)}">
    <div class="time">${hhmm(it.start)}${end}</div>
    <div class="rail"></div>
    <div class="body"><div class="title">${title}${nowTag}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${tasks}${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div>
    ${checkBtn}
  </li>`;
}

function streak(type, fromYmd) {
  let n = 0, d = fromYmd;
  const has = (ymd) => Object.keys(state.done).some((k) => k.startsWith(`${ymd}|${type}|`));
  if (!has(d)) d = addDays(d, -1);
  while (has(d) && n < 400) { n++; d = addDays(d, -1); }
  return n;
}

function renderToday() {
  const now = mskNow();
  const ymd = state.date || now.ymd;
  const isToday = ymd === now.ymd;
  const nowMin = now.min;
  const c = ctx();
  const plan = planDay(ymd, c);
  const dayDeadlines = c.deadlines.filter((d) => d.due.slice(0, 10) === ymd && !d.done && d.kind !== 'control');
  document.documentElement.dataset.phase = isToday ? phaseOf(nowMin) : 'night';

  // центр циферблата
  let center;
  if (isToday) {
    const cur = currentOf(plan, nowMin);
    if (cur && cur.item) {
      const lt = leftText(cur.left);
      const where = cur.item.type === 'class' || cur.item.type === 'control' ? (cur.item.online ? 'онлайн' : `ауд. ${cur.item.room || '—'}`) : cur.item.type === 'study' && cur.item.tasks ? cur.item.tasks[0].title : cur.item.sub || '';
      center = `<div class="lbl">Сейчас · до ${hhmm(cur.item.end)}</div><div class="what">${esc(cur.item.type === 'study' ? 'Учёба' : cur.item.title)}</div><div class="timer">${lt.big}<small>${lt.unit}</small></div><div class="where">${esc(where).slice(0, 60)}</div>`;
    } else if (cur && cur.next) {
      const lt = leftText(cur.left);
      center = `<div class="lbl">Дальше в ${hhmm(cur.next.start)}</div><div class="what">${esc(cur.next.title)}</div><div class="timer">${lt.big}<small>${lt.unit}</small></div><div class="where">до начала</div>`;
    } else center = `<div class="lbl">День завершён</div><div class="what">Отбой</div>`;
  } else {
    const past = ymd < now.ymd;
    center = `<div class="lbl">${past ? 'Было' : daysBetween(now.ymd, ymd) === 1 ? 'Завтра' : 'План на'}</div><div class="what">${DOW_FULL[plan.dow]}</div><div class="timer">${plan.stats.classes}<small>${plural(plan.stats.classes, 'пара', 'пары', 'пар')}</small></div><div class="where">${plan.stats.firstClass ? `первая в ${plan.stats.firstClass}` : 'свободный от пар день'}</div>`;
  }

  // брифинг
  const quote = quoteOf(ymd), tip = tipOf(ymd, plan), [zh, py, ru] = hanziOf(ymd, plan);
  const w = weatherFor(ymd);
  const facts = [];
  facts.push(w
    ? `<div class="fact"><div class="k">Погода в Москве</div><div class="v">${esc(w.v)}</div><div class="s">${esc(w.advice)}</div></div>`
    : `<div class="fact"><div class="k">Погода</div><div class="v">—</div><div class="s">${isToday ? 'загружаю…' : 'прогноз ближе к дате'}</div></div>`);
  facts.push(`<div class="fact"><div class="k">Сон</div><div class="v">Отбой ${hhmm(plan.bed)}</div><div class="s">подъём ${state.settings.wake} · ${durText(state.settings.sleepMin)}</div></div>`);
  facts.push(`<div class="fact hanzi wide"><div class="zh" lang="zh">${zh}</div><div><div class="k">Слово дня · ${esc(py)}</div><div class="v">${esc(ru)}</div></div></div>`);

  // важное: дедлайны ближайших 7 дней + хвосты + контрольные (14 дней) + личное
  const from = mskEpoch0(ymd);
  const imp = c.deadlines.filter((d) => {
    if (d.done) return false;
    const ts = dueTs(d);
    if (d.open && ts < Date.now()) return true;
    if (ts < Math.max(Date.now(), from)) return false;
    const days = (ts - from) / 864e5;
    return days <= ((d.kind === 'control' || d.course === 'life') ? 14 : 7);
  }).sort((a, b) => Number(!!(a.open && dueTs(a) < Date.now())) - Number(!!(b.open && dueTs(b) < Date.now())) || a.due.localeCompare(b.due)).slice(0, 7);

  const dlRows = imp.map((d) => dlRowHTML(d)).join('') || `<div class="dl-empty">На неделе дедлайнов нет. Хороший момент забежать вперёд.</div>`;

  // прогресс
  const checkables = plan.items.filter((i) => i.check && i.type !== 'sleep');
  const doneN = checkables.filter((i) => state.done[i.id]).length;
  const pct = checkables.length ? Math.round((doneN / checkables.length) * 100) : 0;

  const legendTypes = ['class', 'study', 'gym', 'cs', 'clean', 'read', 'sleep'].filter((t) => t === 'sleep' || plan.items.some((i) => i.type === t));
  const legendNames = { class: 'пары', study: 'учёба', gym: 'зал', cs: 'CS2', clean: 'уборка', read: 'чтение', sleep: 'сон' };

  const install = !isStandalone() && !state.hideInstall && isIOS()
    ? `<div class="note" style="margin-top:12px">Добавь на экран «Домой»: «Поделиться» → «На экран „Домой“». Так уведомления и офлайн заработают. <button class="small" data-act="hide-install" style="text-decoration:underline">Скрыть</button></div>` : '';

  const meta = state.data.meta;
  const upd = meta && meta.updated ? new Date(meta.updated) : null;
  const updText = upd ? `данные: ${daysBetween(mskNow(upd).ymd, now.ymd) === 0 ? 'сегодня' : dateText(mskNow(upd).ymd)} в ${hhmm(mskNow(upd).min)}` : '';

  // завтра — вечером
  let tomorrow = '';
  if (isToday && nowMin >= 1080) {
    const tp = planDay(addDays(ymd, 1), c);
    const first = tp.items.find((i) => i.type === 'class' || i.type === 'control');
    const leave = tp.items.find((i) => i.type === 'commute');
    tomorrow = `<section class="section"><h2>Завтра</h2><div class="fact wide"><div class="v">${first ? `Первая пара в ${hhmm(first.start)} — ${esc(first.title)}` : 'Пар нет'}</div><div class="s">будильник ${state.settings.wake}${leave ? ` · выйти в ${hhmm(leave.start)}` : ''}${tp.items.some((i) => i.type === 'gym') ? ' · день зала — собери форму' : ''}</div></div></section>`;
  }

  const r = streak('read', now.ymd), sl = streak('sleep', now.ymd);
  const wk = mondayOf(now.ymd);
  const gymDone = Object.keys(state.done).filter((k) => k.includes('|gym|') && k.slice(0, 10) >= wk && k.slice(0, 10) <= addDays(wk, 6)).length;

  return `
  <header class="top">
    <div>
      <h1>${DOW_FULL[plan.dow]}</h1>
      <div class="date">${dateText(ymd)}${isToday ? '' : ' <button class="chip-today" data-act="today">К сегодня</button>'}</div>
    </div>
    <div class="navbtns">
      <button class="iconbtn" data-act="prev" aria-label="Предыдущий день">${I.left}</button>
      <button class="iconbtn" data-act="next" aria-label="Следующий день">${I.right}</button>
    </div>
  </header>
  ${install}
  ${state.data.error ? `<div class="note" style="margin-top:10px">${esc(state.data.error)}</div>` : ''}
  <div class="dial-wrap">${dialSVG(plan, nowMin, isToday, dayDeadlines)}<div class="dial-center">${center}</div></div>
  <div class="legend">${legendTypes.map((t) => `<span><i style="background:${colorVar(t)}"></i>${legendNames[t]}</span>`).join('')}</div>
  ${plan.notes.length ? `<div class="notes">${plan.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>` : ''}

  <blockquote class="quote"><p>${esc(quote.q)}</p><cite>${esc(quote.a)}</cite></blockquote>
  <div class="facts">${facts.join('')}<div class="fact wide tip">${I.bulb}<span>${esc(tip)}</span></div></div>

  <section class="section" aria-labelledby="h-imp">
    <h2 id="h-imp"><span>Важно</span><span class="aside">${esc(updText)}</span></h2>
    <div class="dl-list">${dlRows}</div>
  </section>

  <section class="section" aria-labelledby="h-plan">
    <h2 id="h-plan"><span>План дня</span><span class="aside">${doneN} из ${checkables.length}</span></h2>
    <div class="progress"><div class="bar"><i style="width:${pct}%"></i></div></div>
    <ol class="tl">${plan.items.map((it) => rowHTML(it, { isToday, nowMin })).join('')}</ol>
    <div class="habits">
      <span class="habit">Чтение подряд <b>${r}</b> ${plural(r, 'день', 'дня', 'дней')}</span>
      <span class="habit">Зал на неделе <b>${gymDone}/${state.settings.gymDays.length}</b></span>
      <span class="habit">Режим сна <b>${sl}</b> ${plural(sl, 'день', 'дня', 'дней')}</span>
    </div>
  </section>
  ${tomorrow}`;
}
const mskEpoch0 = (ymd) => Date.parse(`${ymd}T00:00:00+03:00`);

function dlRowHTML(d, withCheck = false) {
  const u = d.done ? 'done' : d.open && dueTs(d) < Date.now() ? 'late' : urgency(d);
  const when = d.open && dueTs(d) < Date.now() ? 'срок прошёл · сдача открыта' : d.kind === 'control' ? `${dueText(d)}` : dueText(d);
  const tags = [];
  if (d.kind === 'quiz') tags.push('тест');
  if (d.kind === 'control') tags.push('контрольная');
  if (d.mustPass) tags.push('must pass');
  if (d.src === 'mine') tags.push('моё');
  const course = courseName(d.course, true);
  const late = d.open && dueTs(d) < Date.now();
  const mline = d.kind === 'control'
    ? `<span class="when">${esc(dueText({ ...d, allDay: true }))}</span> · ${esc(d.note || '')}`
    : `${esc(course)} · <span class="when">${esc(when)}</span>${d.note && !late ? ` · ${esc(d.note)}` : ''}`;
  const link = withCheck && d.url ? ` · <a href="${esc(d.url)}" target="_blank" rel="noopener">открыть ↗</a>` : '';
  const inner = `<span class="bar"></span>
    <span><div class="t">${esc(d.title)}${tags.filter((t) => !(d.kind === 'control' && t === 'контрольная')).map((t) => `<span class="tag">${t}</span>`).join('')}</div>
    <div class="m">${mline}${link}</div></span>`;
  const right = withCheck
    ? `<span style="display:flex;gap:6px;align-items:center">${d.src === 'mine' ? `<button class="small" data-act="dl-del" data-id="${esc(d.id)}" aria-label="Удалить">✕</button>` : ''}<button class="check" style="--rc:var(--c-gym)" data-act="dl-check" data-id="${esc(d.id)}" aria-pressed="${!!d.done}" aria-label="Сделано: ${esc(d.title)}">${I.check}</button></span>`
    : `<span class="small">${d.url ? '↗' : ''}</span>`;
  if (!withCheck && d.url) return `<a class="dl ${u}" href="${esc(d.url)}" target="_blank" rel="noopener">${inner}${right}</a>`;
  return `<div class="dl ${u}">${inner}${right}</div>`;
}

// ───────── неделя ─────────
function renderWeek() {
  const now = mskNow();
  const mon = state.weekStart || mondayOf(now.ymd);
  const c = ctx();
  const S0 = toMin(state.settings.wake) - 30, S1 = S0 + 18 * 60; // окно полосы: от подъёма 18 часов
  const pos = (m) => Math.max(0, Math.min(100, ((m - S0) / (S1 - S0)) * 100));
  let totals = { classes: 0, study: 0, cs: 0, gym: 0 };
  const days = [];
  for (let i = 0; i < 7; i++) {
    const ymd = addDays(mon, i);
    const p = planDay(ymd, c);
    totals.classes += p.stats.classes; totals.study += p.stats.study; totals.cs += p.stats.cs; totals.gym += p.stats.gym ? 1 : 0;
    const segs = p.items.filter((it) => !['free', 'deadline', 'sleep'].includes(it.type) && it.end > S0 && it.start < S1)
      .map((it) => `<i class="${['meal', 'morning', 'winddown', 'commute'].includes(it.type) ? 'thin' : ''}" style="left:${pos(it.start)}%;width:${Math.max(0.6, pos(it.end) - pos(it.start))}%;background:${colorVar(it.type)}"></i>`).join('');
    const dls = c.deadlines.filter((d) => d.due.slice(0, 10) === ymd && !d.done).map((d) => `<b style="left:calc(${pos(toMin(d.due.slice(11, 16)))}% - 1px)"></b>`).join('');
    const bits = [];
    if (p.stats.classes) bits.push(`${p.stats.classes} ${plural(p.stats.classes, 'пара', 'пары', 'пар')} с ${p.stats.firstClass}`); else bits.push('без пар');
    if (p.stats.gym) bits.push('зал');
    if (p.stats.clean) bits.push('уборка');
    const nd = c.deadlines.filter((d) => d.due.slice(0, 10) === ymd && !d.done).length;
    if (nd) bits.push(`${nd} ${plural(nd, 'дедлайн', 'дедлайна', 'дедлайнов')}`);
    days.push(`<button class="wday${ymd === now.ymd ? ' today' : ''}" data-act="goto-day" data-ymd="${ymd}">
      <div class="h"><div class="d">${DOW_SHORT[p.dow]}<span>${dateText(ymd)}</span></div><div class="x">${esc(bits.join(' · '))}</div></div>
      <div class="strip">${segs}${dls}</div></button>`);
  }
  const lbl = `${dateText(mon).split(' ')[0]}–${dateText(addDays(mon, 6))}`;
  const scale = [0, 6, 12, 18].map((h) => hhmm(S0 + h * 60)).slice(0, 3);
  return `
  <div class="week-head">
    <h1>${lbl}</h1>
    <div class="navbtns">
      <button class="iconbtn" data-act="week-prev" aria-label="Прошлая неделя">${I.left}</button>
      <button class="iconbtn" data-act="week-next" aria-label="Следующая неделя">${I.right}</button>
    </div>
  </div>
  <div class="strip-scale" style="margin:0 15px 6px">${scale.map((s) => `<span>${s}</span>`).join('')}<span>${hhmm(S1)}</span></div>
  ${days.join('')}
  <div class="week-sum">
    <div class="fact"><div class="k">Пары</div><div class="v">${totals.classes}</div></div>
    <div class="fact"><div class="k">Учёба</div><div class="v">${durText(totals.study)}</div></div>
    <div class="fact"><div class="k">CS2</div><div class="v">${durText(totals.cs)}</div></div>
  </div>
  <p class="small" style="margin:14px 4px">Сон каждый день ${durText(state.settings.sleepMin)}: ${hhmm(toMin(state.settings.wake) + 1440 - state.settings.sleepMin)} → ${state.settings.wake}. Зал: ${totals.gym} ${plural(totals.gym, 'раз', 'раза', 'раз')}. Нажми на день, чтобы открыть план.</p>`;
}

// ───────── дедлайны ─────────
function renderDeadlines() {
  const all = allDeadlines();
  const nowTs = Date.now();
  const groups = { hot: [], week: [], later: [], tails: [], done: [] };
  for (const d of all) {
    if (d.done) { if (dueTs(d) > nowTs - 14 * 864e5) groups.done.push(d); continue; }
    const ts = dueTs(d);
    if (ts < nowTs) { if (d.open) groups.tails.push(d); continue; }
    const h = (ts - nowTs) / 36e5;
    if (h <= 48) groups.hot.push(d); else if (h <= 7 * 24) groups.week.push(d); else groups.later.push(d);
  }
  const sec = (title, list, aside = '') => list.length ? `<section class="section"><h2><span>${title}</span><span class="aside">${aside}</span></h2><div class="dl-list">${list.map((d) => dlRowHTML(d, true)).join('')}</div></section>` : '';
  const meta = state.data.meta;
  const lmsOk = meta && meta.lms && meta.lms.ok;
  return `
  <header class="top"><div><h1>Дедлайны</h1><div class="date">Smart LMS, контрольные из расписания и твои</div></div>
    <div class="navbtns"><button class="iconbtn" data-act="add-dl" aria-label="Добавить дедлайн">${I.plus}</button></div></header>
  ${sec('Горит — 48 часов', groups.hot)}
  ${sec('На этой неделе', groups.week)}
  ${sec('Позже', groups.later)}
  ${sec('Хвосты', groups.tails, 'срок прошёл, сдача открыта')}
  ${sec('Сделано', groups.done)}
  ${!all.length ? '<p class="muted" style="margin:20px 4px">Пока пусто.</p>' : ''}
  <div class="btn-row" style="margin-top:14px"><button class="btn block" data-act="add-dl">${I.plus.replace('<svg', '<svg width="18" height="18"')} Добавить свой дедлайн</button></div>
  <p class="small" style="margin:6px 4px">${lmsOk ? `Синхронизация с LMS: ${esc(fmtUpdated(meta.updated))}.` : 'Автосинхронизация с LMS включится, когда в GitHub появится секрет DAY_CONFIG (см. «Настройки»).'} Отметка «сделано» хранится на этом телефоне.</p>`;
}
function fmtUpdated(iso) {
  if (!iso) return '—';
  const n = mskNow(new Date(iso));
  const today = mskNow().ymd;
  return `${n.ymd === today ? 'сегодня' : dateText(n.ymd)} в ${hhmm(n.min)}`;
}

// ───────── настройки ─────────
function renderSettings() {
  const S = state.settings;
  const bed = hhmm(toMin(S.wake) + 1440 - S.sleepMin);
  const meta = state.data.meta || {};
  const push = LS.get('push', null);
  const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let pushBlock;
  if (!supportsPush || (isIOS() && !isStandalone())) {
    pushBlock = `<p class="small" style="padding:12px 0">Уведомления работают в приложении с экрана «Домой». Добавь его через «Поделиться» → «На экран „Домой“», открой оттуда и вернись сюда.</p>`;
  } else if (push && push.code && perm === 'granted') {
    pushBlock = `
      <p class="small" style="padding-top:12px">Осталось один раз передать код GitHub — и сводка будет приходить в 9:00:</p>
      <ol class="steps">
        <li>Нажми «Скопировать код».</li>
        <li>Открой «GitHub → секрет», в поле <b>Name</b> впиши <b>PUSH_CONFIG</b>, в <b>Secret</b> вставь код, нажми <b>Add secret</b>.</li>
      </ol>
      <div class="codebox">${esc(push.code)}</div>
      <div class="btn-row"><button class="btn primary" data-act="push-copy">Скопировать код</button>
      <a class="btn" href="https://github.com/${REPO}/settings/secrets/actions/new" target="_blank" rel="noopener">GitHub → секрет</a>
      <button class="btn" data-act="push-test">Проверить</button></div>`;
  } else {
    pushBlock = `<p class="small" style="padding-top:12px">Каждый день в 9:00 придёт уведомление: пары, зал, горящие дедлайны и фраза дня.</p>
      <div class="btn-row"><button class="btn primary" data-act="push-enable">Включить уведомления</button></div>`;
  }
  const dayBtns = [1, 2, 3, 4, 5, 6, 7].map((d) => `<button data-act="gym-day" data-d="${d}" aria-pressed="${S.gymDays.includes(d)}">${DOW_SHORT[d]}</button>`).join('');
  return `
  <header class="top"><div><h1>Настройки</h1><div class="date">Режим, привычки, уведомления</div></div></header>

  <section class="section"><h2>Режим сна</h2><div class="card">
    <div class="field"><div><label for="s-wake">Подъём</label><div class="hint">Отбой в ${bed} — ровно ${durText(S.sleepMin)} сна, каждый день</div></div><input id="s-wake" type="time" data-set="wake" value="${S.wake}"></div>
    <div class="field"><div><label for="s-sleep">Сон, минут</label><div class="hint">450 = 7,5 часа</div></div><input id="s-sleep" type="number" min="360" max="600" step="15" data-set="sleepMin" value="${S.sleepMin}"></div>
  </div></section>

  <section class="section"><h2>Привычки</h2><div class="card">
    <div class="field stack"><div><div class="lab">Дни зала</div><div class="hint">${S.gymDays.length} ${plural(S.gymDays.length, 'раз', 'раза', 'раз')} в неделю · лучше с перерывом 2–3 дня</div></div><div class="days">${dayBtns}</div></div>
    <div class="field"><label for="s-gym">Зал, минут</label><input id="s-gym" type="number" min="30" max="180" step="15" data-set="gymMin" value="${S.gymMin}"></div>
    <div class="field"><div><label for="s-cs">CS2, минут в день</label><div class="hint">Ставлю вечером и заканчиваю за 40 минут до сна</div></div><input id="s-cs" type="number" min="0" max="300" step="15" data-set="csMin" value="${S.csMin}"></div>
    <div class="field"><label for="s-read">Чтение, страниц</label><input id="s-read" type="number" min="1" max="100" data-set="readPages" value="${S.readPages}"></div>
    <div class="field"><div><label for="s-clean">Уборка</label><div class="hint">${DOW_FULL[S.cleanDay].toLowerCase()}, ${durText(S.cleanMin)}</div></div><select id="s-clean" data-set="cleanDay">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}"${d === S.cleanDay ? ' selected' : ''}>${DOW_FULL[d]}</option>`).join('')}</select></div>
    <div class="field"><div><label for="s-study">Учёба, минут в день</label><div class="hint">Больше в дни без пар, меньше в плотные; горящие дедлайны добавляют</div></div><input id="s-study" type="number" min="0" max="480" step="15" data-set="studyMin" value="${S.studyMin}"></div>
    <div class="field"><label for="s-commute">Дорога до Покровки, минут</label><input id="s-commute" type="number" min="5" max="150" step="5" data-set="commuteMin" value="${S.commuteMin}"></div>
  </div></section>

  <section class="section"><h2>Уведомление в 9:00</h2><div class="card">${pushBlock}</div></section>

  <section class="section"><h2>Данные</h2><div class="card">
    <div class="field"><div><div class="lab">Расписание</div><div class="hint">hse.ru · ${meta.schedule ? (meta.schedule.source === 'email' ? 'личное' : meta.schedule.source === 'group' ? 'по группе' : 'сохранённое') : '—'} · ${esc(fmtUpdated(meta.updated))}</div></div><span class="small">${state.data.lessons.length} пар</span></div>
    <div class="field"><div><div class="lab">Дедлайны Smart LMS</div><div class="hint">${meta.lms && meta.lms.ok ? 'синхронизируются каждое утро' : 'снимок от 9 ноября — добавь DAY_CONFIG для автообновления'}</div></div><span class="small">${state.data.deadlines.length}</span></div>
    <div class="btn-row"><button class="btn" data-act="refresh">Обновить сейчас</button><button class="btn" data-act="reset-today">Сбросить отметки за сегодня</button></div>
  </div></section>
  <p class="small" style="margin:16px 4px">Данные обновляются каждое утро около 8:20 на GitHub. Отметки и свои дедлайны хранятся только на этом устройстве.</p>`;
}

// ───────── шторка «добавить дедлайн» ─────────
function openSheet() {
  const t = addDays(mskNow().ymd, 1);
  const opts = Object.entries(COURSES).filter(([k]) => k !== 'other').map(([k, c]) => `<option value="${k}">${esc(c.name)}</option>`).join('') + '<option value="other">Другое</option>';
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
    <h3 id="sheet-h">Новый дедлайн</h3>
    <div class="grid">
      <label class="full">Что сдать<input name="title" required maxlength="120" placeholder="Например, эссе по английскому"></label>
      <label>Дата<input name="date" type="date" required value="${t}"></label>
      <label>Время<input name="time" type="time" required value="23:59"></label>
      <label class="full">Предмет<select name="course">${opts}</select></label>
    </div>
    <div class="btn-row"><button class="btn primary" type="submit">Добавить</button><button class="btn" type="button" data-close>Отмена</button></div>
  </form>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.hasAttribute('data-close')) close(); });
  wrap.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.mine.push({ id: 'mine-' + Date.now(), title: String(f.get('title')).trim(), due: `${f.get('date')}T${f.get('time')}`, course: f.get('course'), kind: 'assign' });
    LS.set('mine', state.mine); close(); render(); toast('Дедлайн добавлен');
  });
  setTimeout(() => wrap.querySelector('input[name="title"]').focus(), 50);
}

// ───────── уведомления: свои VAPID-ключи прямо на телефоне ─────────
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Уведомления не разрешены'); return; }
    const reg = await navigator.serviceWorker.ready;
    let keys = LS.get('vapid', null);
    if (!keys) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      keys = { pub: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)), priv: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d };
      LS.set('vapid', keys);
    }
    let sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(keys.pub) });
    const code = btoa(JSON.stringify({ s: sub.toJSON(), pub: keys.pub, priv: keys.priv }));
    LS.set('push', { code, at: Date.now() });
    render(); toast('Готово — осталось передать код GitHub');
  } catch (e) { toast('Не получилось: ' + e.message); }
}
async function testPush() {
  const reg = await navigator.serviceWorker.ready;
  const p = planDay(mskNow().ymd, ctx());
  const first = p.items.find((i) => i.type === 'class');
  await reg.showNotification(`${DOW_FULL[p.dow]}, ${dateText(p.ymd)}`, {
    body: `${p.stats.classes ? `${p.stats.classes} ${plural(p.stats.classes, 'пара', 'пары', 'пар')} с ${p.stats.firstClass}${first ? ` (${first.title})` : ''}` : 'Пар нет'} · отбой ${hhmm(p.bed)}`,
    icon: 'icon-192.png', badge: 'icon-192.png', tag: 'test',
  });
}

// ───────── каркас ─────────
function renderTabs() {
  const hot = allDeadlines().filter((d) => !d.done && dueTs(d) > Date.now() && dueTs(d) - Date.now() < 48 * 36e5).length;
  const tabs = [['today', 'Сегодня', I.today], ['week', 'Неделя', I.week], ['deadlines', 'Дедлайны', I.dl], ['settings', 'Настройки', I.set]];
  $('#tabs').innerHTML = tabs.map(([v, l, ic]) => `<button data-act="tab" data-v="${v}" ${state.view === v ? 'aria-current="page"' : ''}>${ic}<span>${l}</span>${v === 'deadlines' && hot ? `<span class="badge">${hot}</span>` : ''}</button>`).join('');
}
function render() {
  const app = $('#app');
  const html = state.view === 'week' ? renderWeek() : state.view === 'deadlines' ? renderDeadlines() : state.view === 'settings' ? renderSettings() : renderToday();
  app.innerHTML = html;
  renderTabs();
  state.intro = false;
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const today = mskNow().ymd;
  switch (act) {
    case 'tab':
      state.view = el.dataset.v;
      if (state.view === 'today') { state.date = null; state.intro = true; }
      if (state.view === 'week') state.weekStart = null;
      render(); window.scrollTo({ top: 0 }); break;
    case 'prev': state.date = addDays(state.date || today, -1); render(); break;
    case 'next': state.date = addDays(state.date || today, 1); render(); break;
    case 'today': state.date = null; state.intro = true; render(); break;
    case 'goto-day': state.date = el.dataset.ymd === today ? null : el.dataset.ymd; state.view = 'today'; state.intro = true; render(); window.scrollTo({ top: 0 }); break;
    case 'week-prev': state.weekStart = addDays(state.weekStart || mondayOf(today), -7); render(); break;
    case 'week-next': state.weekStart = addDays(state.weekStart || mondayOf(today), 7); render(); break;
    case 'check': {
      const id = el.dataset.id;
      if (state.done[id]) delete state.done[id]; else state.done[id] = 1;
      LS.set('done', state.done); render();
      if (state.done[id] && navigator.vibrate) navigator.vibrate(12);
      break;
    }
    case 'dl-check': {
      const id = el.dataset.id;
      if (state.dlDone[id]) delete state.dlDone[id]; else state.dlDone[id] = 1;
      LS.set('dlDone', state.dlDone); render();
      if (state.dlDone[id]) toast('Сдано. Так держать');
      break;
    }
    case 'dl-del': state.mine = state.mine.filter((d) => d.id !== el.dataset.id); LS.set('mine', state.mine); render(); break;
    case 'add-dl': openSheet(); break;
    case 'gym-day': {
      const d = Number(el.dataset.d);
      const set = new Set(state.settings.gymDays);
      set.has(d) ? set.delete(d) : set.add(d);
      state.settings.gymDays = [...set].sort(); saveSettings(); render(); break;
    }
    case 'refresh': await loadData(); loadWeather(true); render(); toast('Данные обновлены'); break;
    case 'reset-today':
      for (const k of Object.keys(state.done)) if (k.startsWith(today)) delete state.done[k];
      LS.set('done', state.done); render(); toast('Отметки за сегодня сброшены'); break;
    case 'push-enable': await enablePush(); break;
    case 'push-copy': {
      const p = LS.get('push', null);
      try { await navigator.clipboard.writeText(p.code); toast('Код скопирован'); } catch { toast('Выдели код и скопируй вручную'); }
      break;
    }
    case 'push-test': await testPush(); break;
    case 'hide-install': state.hideInstall = true; LS.set('hideInstall', true); render(); break;
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-set]');
  if (!el) return;
  const k = el.dataset.set;
  let v = el.value;
  if (el.type === 'number' || k === 'cleanDay') {
    v = Number(v);
    if (!Number.isFinite(v)) return;
    if (el.min) v = Math.max(Number(el.min), v);
    if (el.max) v = Math.min(Number(el.max), v);
  }
  if (k === 'wake' && !/^\d{2}:\d{2}$/.test(v)) return;
  state.settings[k] = v; saveSettings(); render(); toast('Сохранено');
});

// свайп влево/вправо — соседний день
let touch = null;
document.addEventListener('touchstart', (e) => { if (state.view === 'today' && e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touch || state.view !== 'today') return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 40 && Date.now() - touch.t < 600) {
    state.date = addDays(state.date || mskNow().ymd, dx < 0 ? 1 : -1); render();
  }
  touch = null;
});

// живое обновление: каждую минуту двигаем «сейчас», в 9:00 подтягиваем свежие данные
async function tick() {
  const n = mskNow();
  const prev = state.lastTickMin;
  state.lastTickMin = n.min;
  if (prev !== null && prev < 540 && n.min >= 540) { await loadData(); loadWeather(true); render(); toast('Брифинг на сегодня готов'); return; }
  if (state.view === 'today' && !document.querySelector('.sheet-backdrop')) render();
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - state.data.loadedAt > 15 * 60e3) { await loadData(); loadWeather(); }
  render();
});

async function boot() {
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
  }
  await loadData();
  render();
  loadWeather();
  setInterval(tick, 30e3);
}
boot();
