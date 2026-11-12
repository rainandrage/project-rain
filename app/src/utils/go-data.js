// pokémon go live data for /go — events, raids, eggs, research and rocket
// lineups from ScrapedDuck (a LeekDuck scrape published to github, CORS-open,
// refreshed several times a day). fetched straight from the browser; the last
// good copy is kept in localStorage so the page paints instantly and still
// works offline. (could move behind the news worker later for edge caching.)

import { NAME_TO_ID, FORM_TO_BASE_ID } from './api';

const BASE = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/';
export const GO_FEEDS = ['events', 'raids', 'eggs', 'research', 'rocketLineups'];
const CACHE_KEY = 'goData';
const TIMEOUT_MS = 8000;

export function readGoCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

export async function fetchGoData() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await Promise.all(GO_FEEDS.map(n =>
      fetch(`${BASE}${n}.min.json`, { signal: ctrl.signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })));
    const data = { fetchedAt: Date.now() };
    GO_FEEDS.forEach((n, i) => { data[n] = Array.isArray(res[i]) ? res[i] : []; });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* quota / private mode */ }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// event times are local wall-clock with no zone ("2026-11-13T20:00:00.000"),
// which Date parses as local time — exactly what GO means by them.
export const goTime = (s) => (s ? new Date(s).getTime() : null);

// ── GO name → our dex route ────────────────────────────────────────────────
// "Shadow Poliwhirl", "Galarian Meowth", "Mega Banette", "Zacian (Crowned
// Sword)", "Tornadus (Incarnate)" → /pokemon/:id(?form=slug). null if we
// can't place it (then the row just doesn't link).
const REGIONAL = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' };
const slugify = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/♀/g, '-f').replace(/♂/g, '-m')
  .replace(/['’.:]/g, '').trim().replace(/\s+/g, '-');

const cache = new Map();
export function goMonRoute(name) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);
  let n = name.trim();
  const shadow = /^shadow\s+/i.test(n);
  n = n.replace(/^(shadow|purified)\s+/i, '');
  n = n.replace(/\s+\d+$/, ''); // pattern variants: "Spinda 4" → spinda
  let mega = null;
  const m = n.match(/^mega\s+(.+?)(?:\s+([xy]))?$/i);
  if (m) { n = m[1]; mega = m[2] ? `mega-${m[2].toLowerCase()}` : 'mega'; }
  let region = null;
  const r = n.match(/^(alolan|galarian|hisuian|paldean)\s+(.+)$/i);
  if (r) { region = REGIONAL[r[1].toLowerCase()]; n = r[2]; }
  let paren = null;
  const p = n.match(/^(.+?)\s*\((.+)\)$/);
  if (p) { n = p[1]; paren = slugify(p[2].replace(/\s+forme?$/i, '')); }
  const base = slugify(n);

  const candidates = [];
  if (mega) candidates.push(`${base}-${mega}`);
  if (region) candidates.push(`${base}-${region}`);
  if (paren) {
    candidates.push(`${base}-${paren}`);
    candidates.push(`${base}-${paren.split('-')[0]}`);
  }
  candidates.push(base);

  let route = null;
  for (const slug of candidates) {
    if (NAME_TO_ID[slug] != null) { route = `/pokemon/${NAME_TO_ID[slug]}`; break; }
    if (FORM_TO_BASE_ID[slug] != null) { route = `/pokemon/${FORM_TO_BASE_ID[slug]}?form=${slug}`; break; }
  }
  const out = route ? { route, shadow } : null;
  cache.set(name, out);
  return out;
}
