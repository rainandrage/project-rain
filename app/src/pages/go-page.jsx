import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchGoData, readGoCache, goTime, goMonRoute } from '../utils/go-data';

// ─── GoPage ──────────────────────────────────────────────────────────────────
// /go — pokémon go "what's happening now". top to bottom:
//   1. next spotlight hour + next raid hour
//   2. tabs: raids (by tier, w/ end dates when announced) · eggs (by km) ·
//      research · rocket lineups (capture-eligible pokémon highlighted)
//   3. events: happening now (time left + end) · coming up (next 7 days)
// every pokémon links into our dex when we can place it. "new since your
// last visit" dots mark events / tab content you haven't seen yet.

const SEEN_KEY = 'goSeen';
const NOW_SHOW = 4;
const WEEK = 7 * 86400000;

const EVENT_COLORS = {
  'event': '#9fd3f0', 'community-day': '#8fd4a8', 'raid-battles': '#f08d8d', 'raid-hour': '#f08d8d',
  'raid-day': '#f08d8d', 'pokemon-spotlight-hour': '#f6c56b', 'max-battles': '#c5a2e6', 'max-mondays': '#c5a2e6',
  'wild-area': '#b7a6ef', 'go-battle-league': '#a8e0d8', 'timed-research': '#f2b5d4', 'research': '#f2b5d4',
  'season': '#d9c48a', 'go-pass': '#d9c48a', 'pokemon-go-tour': '#f9a66c',
};

function dur(ms) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 2) return `${d}d`;
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}
const fmtDay  = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase();
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const fmtShort = (ms) => `${fmtDay(ms).replace(',', '')} · ${fmtTime(ms).replace(':00', '').replace(' ', '')}`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');

// ── seen-tracking (red dots) ──
function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
const tabIds = (d) => ({
  raids:    d.raids.map(r => `raid:${r.name}`),
  eggs:     d.eggs.map(e => `egg:${e.eggType}:${e.name}`),
  research: d.research.map(q => `q:${stripTags(q.text)}`),
  rocket:   d.rocketLineups.map(g => `r:${g.name}:${(g.firstPokemon || []).map(p => p.name).join(',')}`),
});

// ── small pieces ──
function Mon({ name, className = '', children }) {
  const hit = goMonRoute(name);
  return hit
    ? <Link to={hit.route} className={className}>{children}</Link>
    : <div className={className}>{children}</div>;
}

const Shiny = () => <span className="go-shiny" title="can be shiny" aria-label="can be shiny">✨</span>;

function TypeChips({ types }) {
  return (
    <span className="go-types">
      {types.map(t => { const n = t.name || t; return <span key={n} className={`type-badge type-${n}`}>{n}</span>; })}
    </span>
  );
}

function HourCard({ label, event, now }) {
  if (!event) return null;
  const s = goTime(event.start);
  const live = s <= now;
  const what = event.name
    .replace(/(pokémon\s+)?spotlight hour|raid hour/i, '')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '');
  return (
    <div className="go-hour">
      <b>{!live && <i>next </i>}{label}</b>
      <span className="go-hour__time">
        {live ? <span className="go-soon">on now</span> : <>
          {fmtShort(s)}
          {s - now < 86400000 && <span className="go-soon"> · in {dur(s - now)}</span>}
        </>}
      </span>
      {what && <span className="go-hour__what">{what}</span>}
    </div>
  );
}

function EventCard({ e, now, isNew }) {
  const s = goTime(e.start), en = goTime(e.end);
  const live = s && s <= now;
  return (
    <a className="go-ev" href={e.link} target="_blank" rel="noopener noreferrer">
      {isNew && <span className="go-new" aria-label="new" />}
      <img src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <span className="go-ev__body">
        <span className="go-ev__name">{e.name}</span>
        <span className="go-ev__pill" style={{ background: EVENT_COLORS[e.eventType] || 'var(--border)' }}>
          {(e.heading || e.eventType || '').toLowerCase()}
        </span>
        <span className="go-ev__when">
          {live
            ? (en ? <><b>{dur(en - now)} left</b><span>until {fmtDay(en)} · {fmtTime(en)}</span></> : <b>ongoing</b>)
            : <>
                <b>starts {fmtDay(s)} · {fmtTime(s)}</b>
                {en && <span>until {sameDay(s, en) ? fmtTime(en) : `${fmtDay(en)} · ${fmtTime(en)}`}</span>}
              </>}
        </span>
      </span>
    </a>
  );
}

// ── tab panels ──
function RaidsPanel({ raids, events, now }) {
  // a boss's end date, when a live raid event names it (5★ / mega / shadow
  // legendaries are announced with dates; 1★ / 3★ rotate quietly)
  const until = (r) => {
    const base = r.name.replace(/^(shadow|mega)\s+/i, '').split(' (')[0].toLowerCase();
    const ev = events.find(e => /raid/.test(e.eventType) && goTime(e.start) <= now && goTime(e.end) > now && e.name.toLowerCase().includes(base));
    return ev ? fmtShort(goTime(ev.end)) : null;
  };
  const tiers = [...new Set(raids.map(r => r.tier))].sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0) || a.localeCompare(b));
  return tiers.map(tier => {
    const n = parseInt(tier);
    return (
      <section key={tier}>
        <h3 className="go-tier">
          {isNaN(n) ? tier.toLowerCase() : <><span className="go-stars">{'★'.repeat(n)}</span> raids</>}
        </h3>
        {raids.filter(r => r.tier === tier).map(r => {
          const u = until(r);
          return (
            <Mon key={r.name} name={r.name} className="go-mon">
              <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
              <span className="go-mon__body">
                <span className="go-mon__name">{r.name} {r.canBeShiny && <Shiny />}</span>
                {u && <span className="go-until">until {u}</span>}
                <TypeChips types={r.types || []} />
                {r.combatPower && (
                  <span className="go-cp">
                    catch cp {r.combatPower.normal.min}–{r.combatPower.normal.max} · boosted {r.combatPower.boosted.min}–{r.combatPower.boosted.max}
                  </span>
                )}
              </span>
              <span className="go-wx">
                {(r.boostedWeather || []).map(w => <img key={w.name} src={w.image} alt={w.name} title={`boosted in ${w.name}`} referrerPolicy="no-referrer" />)}
              </span>
            </Mon>
          );
        })}
      </section>
    );
  });
}

function EggsPanel({ eggs }) {
  const kms = useMemo(() => [...new Set(eggs.map(e => e.eggType))].sort((a, b) => parseInt(a) - parseInt(b)), [eggs]);
  const [km, setKm] = useState(null);
  const cur = kms.includes(km) ? km : kms[0];
  return (
    <>
      <div className="go-chips">
        {kms.map(k => (
          <button key={k} type="button" className={k === cur ? 'is-on' : ''} onClick={() => setKm(k)}>{k}</button>
        ))}
      </div>
      <div className="go-grid">
        {eggs.filter(e => e.eggType === cur).map(e => (
          <Mon key={e.name + e.isAdventureSync} name={e.name} className="go-cell">
            {e.canBeShiny && <span className="go-cell__shiny"><Shiny /></span>}
            <img src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span>{e.name}</span>
            {e.isAdventureSync && <span className="go-tag">adventure sync</span>}
            {e.isGiftExchange && <span className="go-tag">gift</span>}
            {e.isRegional && <span className="go-tag">regional</span>}
          </Mon>
        ))}
      </div>
    </>
  );
}

function ResearchPanel({ research }) {
  return research.map((q, i) => (
    <div key={i} className="go-task">
      <p>{stripTags(q.text)}</p>
      <div className="go-rewards">
        {(q.rewards || []).map(r => (
          <Mon key={r.name} name={r.name} className="go-reward">
            <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
            {r.name}{r.canBeShiny && <> <Shiny /></>}
          </Mon>
        ))}
      </div>
    </div>
  ));
}

function RocketPanel({ lineups }) {
  return (
    <>
      <p className="go-key"><span className="go-key__swatch" /> eligible for capture</p>
      {lineups.map(g => (
        <div key={g.name} className="go-grunt">
          <div className="go-grunt__head"><b>{g.name}</b> <small>{g.title}</small></div>
          <div className="go-slots">
            {['firstPokemon', 'secondPokemon', 'thirdPokemon'].map(k => (
              <div key={k} className="go-slot">
                {(g[k] || []).map(p => (
                  <Mon
                    key={p.name}
                    name={p.name}
                    className={`go-slot__mon${p.isEncounter ? ' is-capture' : ''}`}
                  >
                    <img src={p.image} alt={p.name} title={p.isEncounter ? `${p.name} — eligible for capture` : p.name} loading="lazy" referrerPolicy="no-referrer" />
                  </Mon>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const TABS = ['raids', 'eggs', 'research', 'rocket'];

export default function GoPage() {
  const [data, setData] = useState(() => readGoCache());
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState('raids');
  const [showAllNow, setShowAllNow] = useState(false);
  // what you'd seen BEFORE this visit — frozen for the visit so dots don't
  // vanish mid-read; the store updates for next time
  const [seenBefore] = useState(readSeen);
  const firstVisit = seenBefore.size === 0;
  const isNew = (id) => !firstVisit && !seenBefore.has(id);
  const [openedTabs, setOpenedTabs] = useState(() => new Set(['raids']));

  useEffect(() => {
    let alive = true;
    fetchGoData()
      .then(d => { if (alive) { setData(d); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // remember everything on screen as seen (for the next visit)
  useEffect(() => {
    if (!data) return;
    const ids = [...data.events.map(e => e.eventID), ...Object.values(tabIds(data)).flat()];
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seenBefore, ...ids])])); } catch { /* ignore */ }
  }, [data, seenBefore]);

  const now = Date.now();
  const view = useMemo(() => {
    if (!data) return null;
    const dated = data.events.filter(e => e.start);
    const live = dated.filter(e => goTime(e.start) <= now && (!e.end || goTime(e.end) >= now))
      .sort((a, b) => (goTime(a.end) || Infinity) - (goTime(b.end) || Infinity));
    const soon = dated.filter(e => goTime(e.start) > now && goTime(e.start) - now < WEEK)
      .sort((a, b) => goTime(a.start) - goTime(b.start));
    const next = (type) => data.events
      .filter(e => e.eventType === type && e.start && goTime(e.end) > now)
      .sort((a, b) => goTime(a.start) - goTime(b.start))[0];
    const season = data.events.find(e => e.eventType === 'season' && goTime(e.start) <= now && goTime(e.end) > now);
    const ids = tabIds(data);
    const newTabs = new Set(TABS.filter(t => ids[t].some(isNew)));
    return { live, soon, spotlight: next('pokemon-spotlight-hour'), raidHour: next('raid-hour'), season, newTabs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const pickTab = (t) => { setTab(t); setOpenedTabs(s => new Set(s).add(t)); };

  const frame = view && {
    raids: 'current bosses',
    eggs: 'current pool · events may change it',
    research: view.season ? `until ${fmtDay(goTime(view.season.end))}` : 'this season',
    rocket: 'current lineups',
  }[tab];

  return (
    <div className="go-page">
      <header className="go-page__head">
        <h1>pokémon go</h1>
        <p className="go-page__sub">
          {data
            ? <>updated {fmtTime(data.fetchedAt)} · from leekduck{failed && <> · <span className="news-page__tag news-page__tag--warn">using cached copy</span></>}</>
            : failed ? "couldn't load the go feed — try again in a bit." : 'loading…'}
        </p>
      </header>

      {view && (
        <>
          <div className="go-hours">
            <HourCard label="spotlight hour" event={view.spotlight} now={now} />
            <HourCard label="raid hour" event={view.raidHour} now={now} />
          </div>

          <div className="go-tabs" role="tablist" aria-label="pokémon go data">
            {TABS.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'is-on' : ''}
                onClick={() => pickTab(t)}
              >
                {t}
                {view.newTabs.has(t) && !openedTabs.has(t) && <span className="go-new go-new--tab" aria-label="new" />}
              </button>
            ))}
          </div>
          <p className="go-frame">{frame}</p>
          <div className="go-panel" role="tabpanel">
            {tab === 'raids'    && <RaidsPanel raids={data.raids} events={data.events} now={now} />}
            {tab === 'eggs'     && <EggsPanel eggs={data.eggs} />}
            {tab === 'research' && <ResearchPanel research={data.research} />}
            {tab === 'rocket'   && <RocketPanel lineups={data.rocketLineups} />}
          </div>

          <h2 className="go-h2">happening now <span className="go-count">{view.live.length}</span></h2>
          <div className="go-events">
            {(showAllNow ? view.live : view.live.slice(0, NOW_SHOW)).map(e => (
              <EventCard key={e.eventID} e={e} now={now} isNew={isNew(e.eventID)} />
            ))}
            {!showAllNow && view.live.length > NOW_SHOW && (
              <button type="button" className="go-more" onClick={() => setShowAllNow(true)}>show {view.live.length - NOW_SHOW} more</button>
            )}
          </div>

          <h2 className="go-h2">coming up <span className="go-count">{view.soon.length}</span></h2>
          <div className="go-events">
            {view.soon.length
              ? view.soon.map(e => <EventCard key={e.eventID} e={e} now={now} isNew={isNew(e.eventID)} />)
              : <p className="go-page__sub">nothing in the next week.</p>}
          </div>
        </>
      )}
    </div>
  );
}
