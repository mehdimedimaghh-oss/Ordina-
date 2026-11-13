// Menu sections (fixed). Dishes and prices live in the database (owner can edit them).
export const SECTIONS = [
  { id: 'primi', tab: 'Primi', it: 'Primi piatti', en: 'First courses', icon: 'pasta', h: 28, start: 'Ristorante Hotel Concordia', food: true },
  { id: 'secondi', tab: 'Secondi', it: 'Secondi piatti', en: 'Main courses', icon: 'plate', h: 5, food: true },
  { id: 'dolci', tab: 'Dolci', it: 'Dolci', en: 'Desserts', icon: 'cake', h: 330, food: true },
  { id: 'pinsa', tab: 'Pinsa', it: 'Pinsa Romana 72h', en: 'Roman pinsa', icon: 'pinsa', h: 42, start: 'Fugari Bistrot', food: true },
  { id: 'aperitivo', tab: 'Aperitivo', it: 'Aperitif Experience', en: 'Drink + homemade bites', icon: 'board', h: 95 },
  { id: 'caffe', tab: 'Caffè', it: 'Caffetteria', en: 'Coffee & hot drinks', icon: 'cup', h: 24 },
  { id: 'bibite', tab: 'Bibite', it: 'Soft drinks', en: 'Cold drinks', icon: 'soda', h: 200 },
  { id: 'cocktail', tab: 'Cocktail', it: 'Cocktails', en: 'All € 15', icon: 'cocktail', h: 14 },
  { id: 'vino', tab: 'Vino', it: 'Vino e birra', en: 'Wine & beer', icon: 'wine', h: 345 },
  { id: 'champagne', tab: 'Champagne', it: 'Champagne', en: 'Champagne & Franciacorta · bottle', icon: 'flute', h: 45 },
  { id: 'liquori', tab: 'Liquori', it: 'Amari e distillati', en: 'Spirits', icon: 'shot', h: 262 },
];
export const SECTION = Object.fromEntries(SECTIONS.map(s => [s.id, s]));
export const TABLES = 30;
export const LATE_MIN = 20;

export const eur = n => '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
export const eurShort = n => eur(n).replace('€ ', '€');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// Days are always Italian days (Europe/Rome), whatever the device clock zone is.
const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = ms => fmtDay.format(new Date(ms));
export const today = () => dayKey(Date.now());
export const hhmm = ms => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
export const parseDay = k => { const [Y, M, D] = k.split('-').map(Number); return new Date(Date.UTC(Y, M - 1, D, 12)); };
export const addDays = (k, n) => { const d = parseDay(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayLabel = (k, long) => {
  const it = document.documentElement.lang === 'it';
  if (k === today()) return it ? 'Oggi' : 'Today';
  if (k === addDays(today(), -1)) return it ? 'Ieri' : 'Yesterday';
  return parseDay(k).toLocaleDateString(it ? 'it-IT' : 'en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
};
// table service (coperto): guests × price per person used in that order
export const coverAmt = o => (o.covers || 0) * (o.coverFee || 0);
export const ms = v => typeof v === 'number' ? v : (v ? Date.parse(v) : 0);
export const roomLabel = o => [o.building || '', (o.roomNo ?? o.room_no ?? '').trim()].filter(Boolean).join(' ');
export const uid = () => 'o' + Date.now() + Math.random().toString(36).slice(2, 7);
