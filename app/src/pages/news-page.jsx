// ─── NewsPage ────────────────────────────────────────────────────────────────
//
// on mount we show a loading state and fetch live data from the cloudflare
// worker. if the fetch fails (network error, timeout, bad payload) we fall
// back to the bundled news.json and show a "using cached copy" pill.

import { useCallback, useEffect, useState } from 'react';
import PullToRefresh from '../components/pull-to-refresh';
import Spotlight from '../components/spotlight';
import bundledNews from '../data/news.json';

// the live news endpoint served by the cloudflare worker. the worker's
// source lives at worker/src/index.js in this repo; `wrangler deploy`
// from the worker/ directory prints the real url when it finishes. paste
// it in here after the first deploy.
//
// you can override this at build time by setting VITE_NEWS_API in
// app/.env.local, which is handy when testing a local `wrangler dev`:
//
//   VITE_NEWS_API=http://localhost:8787/news.json
//
// if both the constant and the env var are wrong/unreachable, the bundled
// news.json takes over transparently.
const NEWS_API_URL =
  import.meta.env.VITE_NEWS_API ||
  'https://pokedex-news.voltage770.workers.dev/news.json';

// how long we'll wait for the worker before giving up and showing the
// bundled fallback. the worker's cold-start + upstream fetch on a cache
// miss takes ~2–4 sec worst case, so 6 sec leaves headroom without making
// the page feel stuck on a slow network.
const FETCH_TIMEOUT_MS = 6000;

// "apr 13, 2026" — lowercased to match the rest of the interface. the browser's
// Intl.DateTimeFormat gives us "Apr 13, 2026" with a titlecased month abbrev,
// so we .toLowerCase() the result on the way out.
function formatDate(iso) {
  if (!iso) return 'undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'undated';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toLowerCase();
}

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const day  = 86400000;
  if (diff < 60000)      return 'just now';
  if (diff < 3600000)    return `${Math.floor(diff / 60000)}m ago`;
  if (diff < day)        return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * day)    return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day)   return `${Math.floor(diff / (7 * day))}w ago`;
  return null;
}

// thumbnail for a news row: the article image, a youtube entry's video still,
// or (no image) a tinted tile carrying the entry's label.
function newsThumb(entry) {
  if (entry.image) return entry.image;
  if (entry.youtube_id) return `https://i.ytimg.com/vi/${entry.youtube_id}/mqdefault.jpg`;
  return null;
}

// category pill colors — light tints so black text reads on every theme.
// known labels get a fixed color; anything new hashes into the palette.
const LABEL_COLORS = {
  'pokémon tcg':        '#f6c56b',
  'pokémon tcg pocket': '#f9a66c',
  'pokémon go':         '#8fd4a8',
  'pokémon champions':  '#f08d8d',
  'pokémon sleep':      '#b7a6ef',
  'pokémon cafe':       '#f2b5d4',
  'pokémon home':       '#9fd3f0',
  'pokémon masters':    '#d9c48a',
  'pokémon unite':      '#c5a2e6',
  'scarlet & violet':   '#f3a0a0',
  'legends z-a':        '#a8e0d8',
  'anime':              '#ffd98a',
  'competitive':        '#e8a5c4',
};
const LABEL_PALETTE = ['#9fd3f0', '#8fd4a8', '#f6c56b', '#f08d8d', '#b7a6ef', '#f2b5d4', '#a8e0d8', '#d9c48a'];
function labelColor(label = '') {
  const key = label.toLowerCase();
  if (LABEL_COLORS[key]) return LABEL_COLORS[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_PALETTE[h % LABEL_PALETTE.length];
}

// compact news row — the whole row is the link (no separate "read on…" link).
// thumb · 2-line headline · [label pill]  ·····  source · age (right).
function NewsEntry({ entry }) {
  const rel = formatRelative(entry.published);
  const age = rel ? rel.replace(/ ago$/, '') : formatDate(entry.published);
  const thumb = newsThumb(entry);
  return (
    <article className="news-row">
      <a className="news-row__link" href={entry.url || '#'} target="_blank" rel="noopener noreferrer">
        {thumb ? (
          <img className="news-row__thumb" src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="news-row__thumb news-row__thumb--empty" aria-hidden="true">{entry.label}</span>
        )}
        <span className="news-row__body">
          <span className="news-row__title">{entry.title}</span>
          <span className="news-row__meta">
            <span className="news-row__label" style={{ '--label-bg': labelColor(entry.label) }}>{entry.label}</span>
            <span className="news-row__src">
              {entry.source_name}{' · '}<time dateTime={entry.published || undefined}>{age}</time>
            </span>
          </span>
        </span>
      </a>
    </article>
  );
}

// fetches the live feed from the cloudflare worker with a short timeout. on
// any failure (network error, non-ok response, bad json, empty entries) the
// caller falls back to the bundled copy — the page always renders something.
// `bypassCache` appends ?refresh=1 which the worker honors to skip its 30-min
// edge cache — used by user-initiated pull-to-refresh so the gesture actually
// returns fresh data instead of the same cached payload.
async function fetchLiveNews(signal, bypassCache = false) {
  const url = bypassCache ? `${NEWS_API_URL}?refresh=1` : NEWS_API_URL;
  const res = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
    // worker responds with `cache-control: max-age=1800` so the browser caches
    // the response too. on a user-initiated pull we explicitly bypass that
    // — otherwise the second pull within 30 min returns the same browser-cached
    // payload and the page's "last updated" timestamp never moves.
    cache: bypassCache ? 'no-store' : 'default',
  });
  if (!res.ok) throw new Error(`worker ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.entries)) throw new Error('bad payload');
  return data;
}

const INITIAL_VISIBLE = 10;
const PAGE_STEP = 10;

// filter buckets for the news toggle, from each entry's label
const NEWS_FILTERS = ['all', 'tcg', 'games'];
function newsCategory(entry) {
  const label = (entry.label || '').toLowerCase();
  if (label.includes('tcg')) return 'tcg';
  if (label === 'anime' || label === 'competitive') return 'other';
  return 'games';
}

export default function NewsPage() {
  const [data, setData]     = useState(null);
  const [status, setStatus] = useState('loading');
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const [filter, setFilter] = useState('all');

  // shared refresh function — used both for the initial mount load and for
  // pull-to-refresh in standalone webapp mode. AbortController gives us
  // a 6-second timeout. on success the live payload replaces whatever
  // we're showing; on failure we fall back to the bundled copy.
  // `bypassCache=true` (passed by pull-to-refresh) skips the worker's edge
  // cache so the user sees fresh data, not the same 30-min-cached response.
  const refresh = useCallback(async (bypassCache = false) => {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const live = await fetchLiveNews(controller.signal, bypassCache);
      setData(live);
      setStatus('live');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setData(bundledNews);
      setStatus('fallback');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  const refreshFresh = useCallback(() => refresh(true), [refresh]);

  const { entries = [], updated } = data || {};
  // "2:12 am" when it's today, "nov 7, 2:12 am" otherwise
  const updatedText = (() => {
    if (!updated) return null;
    const d = new Date(updated);
    const today = d.toDateString() === new Date().toDateString();
    return d.toLocaleString('en-US', today
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase();
  })();

  const isInitialLoad = status === 'loading';

  // all / tcg / games filter (sits where the refresh button used to —
  // touch refreshes by pulling). anime + competitive only show under "all".
  const shown = filter === 'all' ? entries : entries.filter(e => newsCategory(e) === filter);

  return (
    <div className="news-page">
      <PullToRefresh onRefresh={refreshFresh} />
      <Spotlight />
      <header className="news-page__header">
        <div className="news-page__heading">
          <h1 className="news-page__title">news</h1>
          {!isInitialLoad && updatedText ? (
            <p className="news-page__updated">
              updated {updatedText}
              {status === 'fallback' && (
                <> · <span className="news-page__tag news-page__tag--warn">using cached copy</span></>
              )}
            </p>
          ) : null}
          <p className="news-page__hint">pull to refresh</p>
        </div>
        <div className="news-filter" role="group" aria-label="filter news">
          {NEWS_FILTERS.map(f => (
            <button
              key={f}
              type="button"
              className={`news-filter__opt${filter === f ? ' is-on' : ''}`}
              aria-pressed={filter === f}
              onClick={() => { setFilter(f); setVisible(INITIAL_VISIBLE); }}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {status === 'loading' ? (
        <div className="news-page__loading">
          <div className="news-page__loading-dots">
            <span /><span /><span />
          </div>
          <p>fetching latest news…</p>
        </div>
      ) : entries.length === 0 ? (
        <p className="news-page__empty">
          no entries yet — run <code>node news/fetch-news.mjs</code> from <code>scripts/</code>.
        </p>
      ) : shown.length === 0 ? (
        <p className="news-page__empty">no {filter} news right now.</p>
      ) : (
        <>
          <div className="news-list">
            {shown.slice(0, visible).map((e) => (
              <NewsEntry key={e.id} entry={e} />
            ))}
          </div>

          {visible < shown.length && (
            <button className="load-more-btn" onClick={() => setVisible(v => v + PAGE_STEP)}>
              show more
            </button>
          )}
        </>
      )}

    </div>
  );
}
