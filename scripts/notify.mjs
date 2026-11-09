// scripts/notify.mjs — отправляет сводку дня на телефон (Web Push) в 9:00.
// Секрет PUSH_CONFIG создаётся в приложении: «Настройки → Уведомление в 9:00».
import { readFile } from 'node:fs/promises';
import webpush from 'web-push';

const raw = (process.env.PUSH_CONFIG || '').trim();
if (!raw) { console.log('PUSH_CONFIG не задан — уведомление пропускаю'); process.exit(0); }
let cfg;
try { cfg = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
catch { console.error('PUSH_CONFIG повреждён — скопируй код в приложении ещё раз'); process.exit(1); }

const today = JSON.parse(await readFile(new URL('../data/today.json', import.meta.url), 'utf8'));
const site = `https://${(process.env.GITHUB_REPOSITORY_OWNER || 'amirka22852').toLowerCase()}.github.io/day/`;
webpush.setVapidDetails(site, cfg.pub, cfg.priv);
try {
  const r = await webpush.sendNotification(cfg.s, JSON.stringify({ title: today.title, body: today.body, url: site }), { TTL: 6 * 3600, urgency: 'high' });
  console.log('Уведомление отправлено:', r.statusCode);
} catch (e) {
  console.error('Ошибка push:', e.statusCode, e.body || e.message);
  if (e.statusCode === 404 || e.statusCode === 410) console.error('Подписка устарела — включи уведомления в приложении заново и обнови секрет');
  process.exit(1);
}
