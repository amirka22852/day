// planner.js — логика «Моего дня». Чистые функции без DOM:
// один и тот же код строит план в приложении и в ежедневном GitHub Action.

export const TZ = 'Europe/Moscow';

export const DEFAULT_SETTINGS = {
  wake: '07:30',     // подъём каждый день, включая выходные
  sleepMin: 450,     // 7,5 часа сна → отбой в 00:00
  commuteMin: 50,    // дорога до Покровки, мин
  gymDays: [2, 5],   // 1 = пн … 7 = вс → вторник и пятница
  gymMin: 90,
  csMin: 150,        // CS2 — 2,5 часа
  readPages: 10,
  cleanDay: 1,       // понедельник
  cleanMin: 120,
  studyMin: 180,     // базовая норма самостоятельной учёбы в день
  reviewDay: 7,      // воскресенье — план на неделю
  group: 4,
};

// Курсы: ключ → название и как его узнать в расписании/LMS. Порядок важен (py раньше ics).
export const COURSES = {
  calc:  { name: 'Матанализ',            re: /математическ|calculus/i },
  stats: { name: 'Теорвер и статистика', re: /вероятност|probability/i },
  micro: { name: 'Микроэкономика',       re: /микроэконом|microeconom/i },
  hist:  { name: 'История России',       re: /истори[яи] росс|russian history|отечественная/i },
  org:   { name: 'Основы российской государственности', short: 'ОРГ', re: /государственност|statehood/i },
  py:    { name: 'ICS · Python',         re: /python/i },
  ics:   { name: 'ICS · Excel',          re: /информационные компьютерные|information\s*\S?omputer/i },
  eng:   { name: 'Английский',           re: /английск|english/i },
  chn:   { name: 'Китайский',            re: /китайск|chinese/i },
  fe:    { name: 'Фин. инжиниринг + ML', re: /финансов\S* инжиниринг|financial engineering/i },
  bzh:   { name: 'Безопасность жизнедеятельности', short: 'БЖД', re: /безопасн|safe living/i },
  life:  { name: 'Личное',               re: /^$/ },
  other: { name: 'Другое',               re: /^$/ },
};

export function courseKey(text = '') {
  for (const [k, c] of Object.entries(COURSES)) if (c.re.test(text)) return k;
  return 'other';
}
export const courseName = (k, short = false) =>
  (COURSES[k] && (short && COURSES[k].short ? COURSES[k].short : COURSES[k].name)) || 'Другое';

// ───────── время ─────────
export const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
export const hhmm = (m) => {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
export const durText = (min) => {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} мин`;
  if (!m) return h === 1 ? '1 ч' : `${String(h)} ч`;
  if (m === 30) return `${h},5 ч`;
  return `${h} ч ${m} мин`;
};

// «сейчас» по Москве — не зависит от часового пояса устройства/сервера
export function mskNow(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return { ymd, min: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60, ts: date.getTime() };
}
export const mskEpoch = (ymd, hm = '00:00') => Date.parse(`${ymd}T${hm.length === 5 ? hm : hhmm(toMin(hm))}:00+03:00`);
export const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
export const dowOf = (ymd) => { const d = new Date(ymd + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
export const mondayOf = (ymd) => addDays(ymd, 1 - dowOf(ymd));
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

export const DOW_FULL = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const DOW_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const dateText = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS_GEN[m - 1]}`; };

// Дедлайн: due — «YYYY-MM-DDTHH:MM» по Москве
export const dueTs = (d) => Date.parse(`${d.due}:00+03:00`);
export function dueText(d, nowTs = Date.now()) {
  const ts = dueTs(d);
  const now = mskNow(new Date(nowTs));
  const dYmd = d.due.slice(0, 10), t = d.due.slice(11, 16);
  const diff = daysBetween(now.ymd, dYmd);
  const time = d.allDay ? '' : t === '23:59' ? 'до 23:59' : `в ${t}`;
  if (d.allDay && diff === 0) return 'сегодня';
  if (ts < nowTs) return `просрочено · было ${dateText(dYmd)}`;
  if (diff === 0) return `сегодня ${time}`;
  if (diff === 1) return `завтра ${time}`;
  if (diff < 7) return `${DOW_SHORT[dowOf(dYmd)].toLowerCase()}, ${dateText(dYmd)} ${time}`;
  return `${dateText(dYmd)} ${time}`;
}
export function urgency(d, nowTs = Date.now()) {
  const h = (dueTs(d) - nowTs) / 36e5;
  if (h < 0) return 'late';
  if (h <= 36) return 'hot';
  if (h <= 96) return 'soon';
  return 'later';
}

// ───────── занятия ─────────
export function kindOf(k = '') {
  if (/контрол|экзам|зач[её]т/i.test(k)) return 'Контрольная';
  if (/лекц/i.test(k)) return 'Лекция';
  if (/семинар/i.test(k)) return 'Семинар';
  if (/практич/i.test(k)) return 'Практика';
  return k || 'Занятие';
}

// склеиваем дубли (одна контрольная в трёх аудиториях, лекция+семинар в одно время)
export function lessonsOn(ymd, lessons) {
  const map = new Map();
  for (const l of lessons) {
    if (l.d !== ymd) continue;
    const key = `${l.s}|${l.c}`;
    const prev = map.get(key);
    if (!prev) { map.set(key, { ...l, rooms: [l.r].filter(Boolean), kinds: [l.k] }); continue; }
    if (l.r && !prev.rooms.includes(l.r)) prev.rooms.push(l.r);
    if (!prev.kinds.includes(l.k)) prev.kinds.push(l.k);
    if (toMin(l.e) > toMin(prev.e)) prev.e = l.e;
  }
  return [...map.values()].sort((a, b) => toMin(a.s) - toMin(b.s)).map((l) => ({
    ...l,
    r: l.rooms.join(' / '),
    k: l.kinds.length > 1 ? l.kinds.join(' или ') : l.k,
    note: l.kinds.length > 1 ? 'В расписании два варианта — уточни у старосты' : l.note,
  }));
}

const isOnline = (l) => /online|онлайн/i.test(`${l.r || ''} ${l.b || ''}`);

// ───────── интервалы ─────────
function subtract(free, s, e) {
  const out = [];
  for (const iv of free) {
    if (e <= iv.s || s >= iv.e) { out.push(iv); continue; }
    if (s > iv.s) out.push({ ...iv, e: s });
    if (e < iv.e) out.push({ ...iv, s: e });
  }
  return out;
}

// ───────── задачи для учебных блоков ─────────
function buildTasks(ymd, ctx, S, todaysLessons) {
  const tasks = [];
  const dayStart = mskEpoch(ymd, '00:00');
  const deadlines = ctx.deadlines || [];
  for (const d of deadlines) {
    if (d.done || !d.due) continue;
    if (d.kind === 'event' && d.course !== 'life') continue;
    const daysLeft = (dueTs(d) - dayStart) / 864e5; // от начала планируемого дня
    const cname = courseName(d.course, true);
    if (d.open && daysLeft < 0) {
      if (ctx.today && ymd !== ctx.today) continue; // старые хвосты — только в сегодняшнем плане
      tasks.push({ pr: 3.5, min: 60, title: `Досдать: ${d.title}`, sub: `${cname} · срок прошёл, но сдача в LMS ещё открыта`, ref: d.id });
      continue;
    }
    if (daysLeft < 0) continue;
    if (d.course === 'life') {
      if (daysLeft <= 6) tasks.push({ pr: 2 + daysLeft / 10, min: 60, title: `Подготовка: ${d.title}`, sub: `${dueText(d, dayStart)}`, ref: d.id });
      continue;
    }
    const quiz = d.kind === 'quiz';
    if (daysLeft <= 2) {
      tasks.push({ pr: 1 + daysLeft / 3, min: quiz ? 30 : 90, title: `${quiz ? 'Пройти тест' : 'Сделать'}: ${d.title}`, sub: `${cname} · ${dueText(d, dayStart + 8 * 36e5)}`, ref: d.id, hot: true });
    } else if (daysLeft <= (quiz ? 7 : 10)) {
      tasks.push({ pr: 4 + daysLeft / 10, min: quiz ? 30 : 60, title: `${quiz ? 'Тест' : 'Начать'}: ${d.title}`, sub: `${cname} · ${dueText(d, dayStart + 8 * 36e5)}`, ref: d.id });
    }
  }
  // контрольные из расписания в ближайшие 14 дней
  const controls = (ctx.lessons || []).filter((l) => kindOf(l.k) === 'Контрольная' && l.d >= ymd && daysBetween(ymd, l.d) <= 14);
  const seen = new Set();
  for (const l of controls) {
    if (seen.has(l.c + l.d)) continue; seen.add(l.c + l.d);
    const n = daysBetween(ymd, l.d);
    if (n === 0) continue;
    tasks.push({ pr: n <= 3 ? 1.5 : 3 + n / 10, min: n <= 3 ? 90 : 60, title: `Подготовка к контрольной: ${courseName(l.c)}`, sub: n === 1 ? 'контрольная завтра — ляг вовремя' : `через ${n} дн. · ${dateText(l.d)}, ${l.s}`, control: true });
  }
  // семинары завтра
  const tomorrow = lessonsOn(addDays(ymd, 1), ctx.lessons || []);
  const prepped = new Set();
  for (const l of tomorrow) {
    const k = kindOf(l.k);
    if (k === 'Лекция' || k === 'Контрольная' || prepped.has(l.c)) continue;
    prepped.add(l.c);
    const lang = l.c === 'eng' || l.c === 'chn';
    const how = { calc: 'реши задачи из домашки', stats: 'реши задачи из домашки', micro: 'реши задачи и нарисуй графики', hist: 'прочитай материалы, набросай тезисы', org: 'прочитай материалы, набросай тезисы', py: 'повтори код с прошлой практики', fe: 'повтори код и формулы с прошлого занятия' }[l.c] || 'подготовься по материалам';
    tasks.push({ pr: 6, min: lang ? 30 : 45, title: lang ? `${courseName(l.c)}: домашка к завтра` : `Семинар завтра: ${courseName(l.c, true)}`, sub: lang ? `занятие в ${l.s}` : `${how} · ${l.s}, ауд. ${l.r || '—'}` });
  }
  // разбор сегодняшних лекций
  for (const l of todaysLessons) {
    if (kindOf(l.k) !== 'Лекция') continue;
    tasks.push({ pr: 7, min: 30, title: `Разобрать лекцию: ${courseName(l.c, true)}`, sub: 'перескажи конспект своими словами', after: toMin(l.e) });
  }
  // запасной вариант — ротация по дням недели
  const rot = {
    1: ['Матан: задачи из домашки', 'реши 4–5 задач без подсказок'],
    2: ['Статистика: задачи', 'разбери 3 задачи из последнего задания'],
    3: ['Микро: задачи и графики', 'нарисуй графики из лекции сам'],
    4: ['Python: практика', 'одна задачка из курса или Codewars'],
    5: ['Английский: эссе и слова', '20 новых слов фразами'],
    6: ['Китайский: иероглифы', '15 минут прописей + повтор слов'],
    7: ['Повторение недели', 'пробегись по конспектам всех предметов'],
  };
  const r = rot[dowOf(ymd)];
  tasks.push({ pr: 9, min: 60, title: r[0], sub: r[1] });
  tasks.push({ pr: 10, min: 60, title: 'Повторение конспектов', sub: 'активное повторение: закрой и вспомни' });
  return tasks.sort((a, b) => a.pr - b.pr);
}

// ───────── главный планировщик ─────────
export function planDay(ymd, ctx = {}) {
  const S = { ...DEFAULT_SETTINGS, ...(ctx.settings || {}) };
  const dow = dowOf(ymd);
  const W = toMin(S.wake);
  const B = W + 1440 - S.sleepMin;       // отбой (минуты от начала дня, может быть > 1440)
  const C = S.commuteMin;
  const windStart = B - 40;              // экран off
  const items = [];
  const notes = [];
  const add = (start, end, type, title, extra = {}) => {
    const it = { id: `${ymd}|${type}|${Math.round(start)}`, start, end, type, title, ...extra };
    items.push(it); return it;
  };

  const lessons = lessonsOn(ymd, ctx.lessons || []);
  let busy = [];
  const morningEnd = W + 40;
  add(W, morningEnd, 'morning', 'Подъём', { sub: 'Вода, душ, завтрак. Первые 10 минут без телефона' });

  // кампус: дорога → пары (окна остаются свободными, но «в Вышке»)
  const runs = [];
  for (const l of lessons) {
    const s = toMin(l.s), e = toMin(l.e), online = isOnline(l);
    const last = runs[runs.length - 1];
    if (last && last.online === online && s - last.e <= (online ? 40 : 2 * C + 60)) {
      last.e = Math.max(last.e, e); last.lessons.push(l);
    } else runs.push({ s, e, online, lessons: [l] });
  }
  const presence = [];
  let uniLunch = false;
  for (const run of runs) {
    if (!run.online) {
      const leave = run.s - C;
      if (leave < morningEnd) notes.push('Утро короткое: выходить уже в ' + hhmm(leave));
      add(leave, run.s, 'commute', 'Дорога в Вышку', { sub: `${C} мин · Покровский б-р, 11` });
      add(run.e, run.e + C, 'commute', 'Дорога домой', { sub: `${C} мин` });
      busy.push([leave, run.s], [run.e, run.e + C]);
      presence.push([run.s, run.e]);
    }
    for (const l of run.lessons) {
      const k = kindOf(l.k);
      add(toMin(l.s), toMin(l.e), k === 'Контрольная' ? 'control' : 'class',
        k === 'Контрольная' ? `Контрольная: ${courseName(l.c)}` : courseName(l.c), {
          kind: k, room: l.r, lecturer: l.p, url: l.u, course: l.c, online: run.online, note: l.note,
        });
      busy.push([toMin(l.s), toMin(l.e)]);
    }
    if (!run.online && run.s < 750 && run.e > 780) {
      const clash = run.lessons.some((l) => toMin(l.s) < 780 && toMin(l.e) > 750);
      if (!clash) { add(750, 780, 'meal', 'Обед', { sub: 'Большой перерыв · столовая', at: 'uni' }); busy.push([750, 780]); uniLunch = true; }
    }
  }

  // вечер: экран off → чтение → сон
  add(windStart, B - 25, 'winddown', 'Экран off', { sub: `Душ, вещи на завтра, будильник на ${S.wake}` });
  add(B - 25, B - 5, 'read', `Чтение · ${S.readPages} страниц`, { sub: 'Бумажная книга или читалка без подсветки', check: true });
  add(B, B + S.sleepMin, 'sleep', 'Сон', { sub: `${hhmm(B)} → ${S.wake} · ${durText(S.sleepMin)}`, check: true, checkLabel: 'Лёг вовремя' });

  // свободные интервалы с пометкой «дома / в Вышке»
  let free = [{ s: morningEnd, e: windStart }];
  for (const [s, e] of busy) free = subtract(free, s, e);
  free = free.flatMap((iv) => {
    // разрезаем по присутствию в Вышке
    let parts = [iv];
    for (const [ps, pe] of presence) {
      parts = parts.flatMap((p) => {
        if (pe <= p.s || ps >= p.e) return [{ ...p, loc: p.loc || 'home' }];
        const out = [];
        if (ps > p.s) out.push({ s: p.s, e: ps, loc: p.loc || 'home' });
        out.push({ s: Math.max(p.s, ps), e: Math.min(p.e, pe), loc: 'uni' });
        if (pe < p.e) out.push({ s: pe, e: p.e, loc: p.loc || 'home' });
        return out;
      });
    }
    return parts.map((p) => ({ ...p, loc: p.loc || 'home' }));
  }).filter((iv) => iv.e - iv.s >= 1).sort((a, b) => a.s - b.s);

  const take = (s, e) => { free = subtract(free, s, e).filter((iv) => iv.e - iv.s >= 1); };
  const home = () => free.filter((iv) => iv.loc === 'home');
  const arrivals = runs.filter((r) => !r.online).map((r) => r.e + C);

  // еда дома
  if (!uniLunch) {
    const iv = home().find((v) => v.s <= 810 && v.e >= 840);
    const arr = arrivals.find((a) => a >= 750 && a <= 990);
    if (iv) { add(810, 840, 'meal', 'Обед'); take(810, 840); }
    else if (arr && home().some((v) => v.s <= arr && v.e >= arr + 30)) { add(arr, arr + 30, 'meal', 'Обед'); take(arr, arr + 30); }
  }
  {
    const iv = home().find((v) => v.s <= 1140 && v.e >= 1180);
    const late = arrivals.find((a) => a > 1140 && a <= B - 100);
    if (iv) { add(1140, 1180, 'meal', 'Ужин'); take(1140, 1180); }
    else if (late && home().some((v) => v.s <= late && v.e >= late + 30)) { add(late, late + 30, 'meal', 'Ужин', { sub: 'Поздний — пары до вечера' }); take(late, late + 30); }
    else {
      const any = home().find((v) => v.s >= 1080 && v.e - v.s >= 30);
      if (any) { add(any.s, any.s + 30, 'meal', 'Ужин'); take(any.s, any.s + 30); }
    }
  }

  // уборка (понедельник)
  if (dow === S.cleanDay) {
    const iv = home().find((v) => v.e - v.s >= S.cleanMin && v.e > 720);
    if (iv) {
      const s = Math.max(iv.s, 720);
      if (iv.e - s >= S.cleanMin) { add(s, s + S.cleanMin, 'clean', 'Уборка', { sub: `${durText(S.cleanMin)} · комната, кухня, вещи`, check: true }); take(s, s + S.cleanMin); }
    } else {
      const best = home().sort((a, b) => (b.e - b.s) - (a.e - a.s))[0];
      if (best && best.e - best.s >= 60) {
        const len = Math.min(S.cleanMin, best.e - best.s);
        add(best.s, best.s + len, 'clean', 'Уборка', { sub: `${durText(len)} — сегодня короче`, check: true }); take(best.s, best.s + len);
        notes.push('Уборка не влезла целиком — добери в выходные');
      }
    }
  }

  // зал
  if (S.gymDays.includes(dow)) {
    const lastEnd = arrivals.length ? Math.max(...arrivals) : 0;
    const minStart = lastEnd ? 0 : 600;
    const fits = (v) => v.e - Math.max(v.s + 15, minStart) >= S.gymMin;
    let iv = home().find((v) => v.s >= 840 && fits(v)) || home().find(fits);
    if (iv) {
      const s = Math.max(iv.s + 15, minStart);
      add(s, s + S.gymMin, 'gym', 'Зал', { sub: `${durText(S.gymMin)} · после — белок и вода`, check: true }); take(s, s + S.gymMin);
    } else notes.push('Зал сегодня не влезает — перенеси на ближайший свободный день');
  }

  // план недели (воскресенье)
  if (dow === S.reviewDay) {
    const iv = home().find((v) => v.s >= 1080 && v.e - v.s >= 20) || home().find((v) => v.e - v.s >= 20);
    if (iv) { add(iv.s, iv.s + 20, 'review', 'План на неделю', { sub: 'Дедлайны, контрольные, дни зала', check: true }); take(iv.s, iv.s + 20); }
  }

  // CS2: вечером до «экран off», иначе днём перед выходом, иначе сколько влезет
  let cs = null;
  {
    const eve = home().find((v) => v.e === windStart);
    if (eve && eve.e - eve.s >= S.csMin) cs = [windStart - S.csMin, windStart];
    else {
      const aft = home().filter((v) => v.s >= 720 && v.e - v.s >= S.csMin + 20 && v.e < windStart).sort((a, b) => b.e - a.e)[0];
      if (aft) cs = [aft.e - S.csMin, aft.e];
      else if (eve && eve.e - eve.s >= 30) { cs = [eve.s, eve.e]; notes.push(`CS2 сегодня ${durText(eve.e - eve.s)}: вечер занят парами`); }
      else notes.push('CS2 сегодня не влезает — день под завязку');
    }
  }

  // учебные задачи и норма
  const tasks = buildTasks(ymd, ctx, S, lessons);
  const heavy = lessons.length >= 4, light = lessons.length <= 2;
  const hotNeed = tasks.filter((t) => t.pr < 2).reduce((a, t) => a + t.min, 0);
  let target = S.studyMin + (heavy ? -30 : 0) + (light && dow <= 5 ? 60 : 0);
  target = Math.max(target, Math.min(hotNeed, 300));

  // горит дедлайн и времени мало → урезаем CS2 (но не меньше часа)
  if (cs) {
    const cap = free.filter((v) => !(v.s >= cs[0] && v.e <= cs[1])).reduce((a, v) => {
      const s = v.s, e = v.e;
      const cut = Math.max(0, Math.min(e, cs[1]) - Math.max(s, cs[0]));
      const len = e - s - cut;
      return a + (len >= 30 ? len : 0);
    }, 0);
    if (hotNeed && cap < hotNeed) {
      const deficit = Math.min(hotNeed - cap, (cs[1] - cs[0]) - 60);
      if (deficit > 0) { cs[0] += deficit; notes.push('Горит дедлайн — CS2 сегодня короче'); }
    }
    add(cs[0], cs[1], 'cs', 'CS2', { sub: cs[1] - cs[0] < S.csMin ? `${durText(cs[1] - cs[0])} из ${durText(S.csMin)}` : `${durText(cs[1] - cs[0])} · сначала дела, потом игра`, check: true });
    take(cs[0], cs[1]);
  }

  // заполняем окна учёбой, остаток — свободное время
  let studied = 0;
  const blocks = [];
  for (const iv of [...free].sort((a, b) => a.s - b.s)) {
    let s = iv.s;
    const minBlock = iv.loc === 'uni' ? 30 : 40;
    while (iv.e - s >= minBlock && studied < target) {
      const want = Math.max(minBlock, target - studied);
      const len = Math.min(90, iv.e - s, want);
      const b = add(s, s + len, 'study', iv.loc === 'uni' ? 'Учёба в окне' : 'Учёба', { at: iv.loc, check: true, tasks: [] });
      blocks.push(b); studied += len; s += len;
      if (iv.e - s >= 40) s += 10;
    }
    const rest = iv.e - s;
    const beforeLeave = items.some((i) => i.type === 'commute' && i.title === 'Дорога в Вышку' && Math.abs(i.start - iv.e) < 1);
    if (iv.loc === 'uni' && rest >= 25) add(s, iv.e, 'free', 'Окно в Вышке', { at: 'uni', sub: 'кофе, прогулка или библиотека' });
    else if (iv.loc !== 'uni' && beforeLeave && rest >= 10) add(s, iv.e, 'free', 'Без спешки', { at: 'home', sub: 'собраться, проверить рюкзак и пропуск' });
    else if (iv.loc !== 'uni' && rest >= 20) add(s, iv.e, 'free', rest >= 60 ? 'Свободное время' : 'Пауза', { at: 'home', sub: rest >= 60 ? 'отдых, прогулка, друзья' : 'выдохни, разомнись' });
  }

  // раскладываем задачи по блокам
  const queue = [...tasks];
  for (const b of blocks) {
    let cap = b.end - b.start;
    for (let i = 0; i < queue.length && cap > 0; i++) {
      const t = queue[i];
      if (t.after && b.start < t.after) continue;
      if (b.tasks.length && t.min > cap) continue;
      b.tasks.push(t); cap -= t.min; queue.splice(i, 1); i--;
    }
    if (!b.tasks.length) b.tasks.push({ title: 'Повторение конспектов', sub: 'активное повторение' });
    b.hot = b.tasks.some((t) => t.hot || t.pr < 1);
    b.title = b.tasks[0].title;
    b.sub = b.tasks.length > 1 ? `+ ${b.tasks.slice(1).map((t) => t.title).join(' · ')}` : b.tasks[0].sub;
  }

  // дедлайны сегодня — отметки на таймлайне
  for (const d of ctx.deadlines || []) {
    if (!d.due || d.due.slice(0, 10) !== ymd || d.done) continue;
    const m = toMin(d.due.slice(11, 16));
    add(m, m, 'deadline', d.title, { sub: `${courseName(d.course, true)} · ${d.due.slice(11, 16) === '23:59' ? 'до 23:59' : 'в ' + d.due.slice(11, 16)}`, url: d.url, ref: d.id });
  }

  items.sort((a, b) => a.start - b.start || (a.type === 'deadline' ? 1 : 0) - (b.type === 'deadline' ? 1 : 0));

  const sum = (t) => items.filter((i) => i.type === t).reduce((a, i) => a + (i.end - i.start), 0);
  const classes = items.filter((i) => i.type === 'class' || i.type === 'control');
  return {
    ymd, dow, items, notes, wake: W, bed: B,
    stats: {
      classes: classes.length,
      firstClass: classes[0] ? hhmm(classes[0].start) : null,
      lastClass: classes.length ? hhmm(classes[classes.length - 1].end) : null,
      study: sum('study'), cs: sum('cs'), gym: sum('gym') > 0, clean: sum('clean') > 0,
    },
  };
}

// краткая сводка для уведомления в 9:00 и today.txt
export function daySummary(ymd, ctx, quote) {
  const p = planDay(ymd, ctx);
  const title = `${DOW_FULL[p.dow]}, ${dateText(ymd)}`;
  const parts = [];
  if (p.stats.classes) {
    const first = p.items.find((i) => i.type === 'class' || i.type === 'control');
    parts.push(`${p.stats.classes} ${plural(p.stats.classes, 'пара', 'пары', 'пар')} с ${p.stats.firstClass} (${first.title})`);
  } else parts.push('пар нет');
  const g = p.items.find((i) => i.type === 'gym');
  if (g) parts.push(`зал в ${hhmm(g.start)}`);
  if (p.stats.clean) parts.push('уборка');
  const c = p.items.find((i) => i.type === 'cs');
  if (c) parts.push(`CS2 в ${hhmm(c.start)}`);
  parts.push(`отбой ${hhmm(p.bed)}`);
  const lines = [parts.join(' · ')];
  const nowTs = mskEpoch(ymd, '09:00');
  const hot = (ctx.deadlines || []).filter((d) => !d.done && d.due && dueTs(d) > nowTs && dueTs(d) - nowTs < 3 * 864e5)
    .sort((a, b) => dueTs(a) - dueTs(b)).slice(0, 2);
  for (const d of hot) lines.push(`⏰ ${courseName(d.course, true)}: ${d.title} — ${dueText(d, nowTs)}`);
  const ctl = (ctx.lessons || []).find((l) => kindOf(l.k) === 'Контрольная' && l.d >= ymd && daysBetween(ymd, l.d) <= 7);
  if (ctl) lines.push(`📝 Контрольная: ${courseName(ctl.c, true)} — ${daysBetween(ymd, ctl.d) === 0 ? 'сегодня' : dateText(ctl.d)}, ${ctl.s}`);
  if (quote) lines.push(`«${quote.q}» — ${quote.a}`);
  return { title, body: lines.join('\n'), plan: p };
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
