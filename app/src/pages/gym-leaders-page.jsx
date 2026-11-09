import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { useModalCycleNav } from '../hooks/use-modal-cycle-nav';
import { pulseElement } from '../utils/pulse';
import { crossModalNavigate } from '../utils/cross-modal-nav';
import { STORAGE_KEYS, getString } from '../utils/storage';
import leaders from '../data/gym-leaders.json';
import badges from '../data/badges.json';
import Img from '../components/img';

// region order matches the games' release sequence — kanto first, paldea last.
// unova merges B/W and B2/W2 into one section at render time, same pattern as
// the badges page; the data file keeps them granular so we can revisit later.
const REGIONS = [
  { slug: 'kanto',  label: 'kanto'  },
  { slug: 'johto',  label: 'johto'  },
  { slug: 'hoenn',  label: 'hoenn'  },
  { slug: 'sinnoh', label: 'sinnoh' },
  { slug: 'unova',  label: 'unova'  },
  { slug: 'kalos',  label: 'kalos'  },
  { slug: 'galar',  label: 'galar'  },
  { slug: 'paldea', label: 'paldea' },
];

// merge unova-bw + unova-b2w2: leaders that appear in BOTH sub-rosters
// (Burgh, Elesa, Clay, Skyla, Drayden) collapse to one card. when fields
// differ across the two appearances, comma-join — same convention as the
// badges page uses for inheriting gyms across gens.
function mergeUnova(all) {
  const src = all.filter(l => l.region === 'unova-bw' || l.region === 'unova-b2w2');
  const byName = new Map();
  for (const l of src) {
    if (!byName.has(l.name)) {
      byName.set(l.name, {
        ...l,
        region:       'unova',
        region_label: 'unova',
        id:           l.id.replace(/-unova-(bw|b2w2)$/, '-unova'),
      });
      continue;
    }
    const existing = byName.get(l.name);
    const merge = (key) => {
      const a = existing[key], c = l[key];
      if (!a || !c || a === c) return;
      if (String(a).split(', ').includes(String(c))) return;
      existing[key] = `${a}, ${c}`;
    };
    merge('city');
    merge('city_jp');
  }
  return [...byName.values()];
}

const allLeaders = [
  ...leaders.filter(l => l.region !== 'unova-bw' && l.region !== 'unova-b2w2'),
  ...mergeUnova(leaders),
];

const SECTIONED_LEADERS = REGIONS
  .map(r => ({ ...r, items: allLeaders.filter(l => l.region === r.slug) }))
  .filter(s => s.items.length);

// resolve the badge entry for a leader → render its sprite and link to /badges.
// the gym-leaders scraper records `badge` as a slug (e.g. "boulder"), and the
// badges.json id is `<slug>-<region>` so we look up by both. unova merge means
// a leader's region might be "unova" while badge ids are still "unova-bw" /
// "unova-b2w2" — try both.
function findBadge(leader) {
  const tries = [
    `${leader.badge}-${leader.region}`,
    `${leader.badge}-${leader.region}-bw`,
    `${leader.badge}-${leader.region}-b2w2`,
  ];
  for (const id of tries) {
    const hit = badges.find(b => b.id === id);
    if (hit) return hit;
  }
  return null;
}

// split a comma-separated multi-value field into a deduped, ordered list.
function splitDedup(s) {
  const seen = new Set();
  return (s || '').split(/,\s*/).filter(Boolean).filter(v => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

// trim noise from scraped flavor text so the modal copy doesn't waste a
// line or two on info already shown elsewhere in the modal:
//   - "(Japanese: <jp> <romaji>)" parenthetical — already rendered as the
//     subtitle directly under the leader's name in the modal header.
//   - ", known officially as the X Gym" — always restates "Gym Leader of
//     X City's Gym" earlier in the same sentence; redundant.
// preserves `\n\n` paragraph breaks so the page can split + render each
// paragraph as its own <p>; only collapses spaces/tabs within a paragraph.
function tightenFlavor(text) {
  if (!text) return text;
  return text
    .split('\n\n')
    .map(para => para
      .replace(/\s*\([^)]*Japanese:[^)]*\)\s*/, ' ')
      .replace(/,\s*known officially as the [^,.]+(?=[,.])/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim()
    )
    .filter(Boolean)
    .join('\n\n');
}

function LeaderModal({ leader, modalRef, onClose, closing }) {
  const navigate = useNavigate();


  const badge = findBadge(leader);
  const cityNames = splitDedup(leader.city);
  const heroSrc = leader.portrait_url || leader.sprite;

  // hand-off across pages — strategy chosen by the visuals settings picker
  // (MOCKUP). each strategy lives in cross-modal-nav.js; this just reads
  // the active mode out of localStorage and dispatches. modalRef passed
  // through so the snap strategy can fade the source modal via inline
  // opacity (sidesteps the bouncy modal-pop-out CSS animation).
  const goToBadge = (e, badgeId) => {
    e.preventDefault();
    const mode = getString(STORAGE_KEYS.XFADE_MODE, 'snap');
    crossModalNavigate(mode, {
      modalRef,
      onClose,
      navigate,
      toPath: '/badges',
      openId: badgeId,
    });
  };

  return (
    <div className={`ability-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div ref={modalRef} className="ball-modal ball-modal--leader" onClick={e => e.stopPropagation()}>
        <div className="ball-modal__header">
          <div className="ball-modal__title">
            <h2>{leader.name}</h2>
            {leader.name_jp && (
              <span className="leader-modal__jp">
                {leader.name_jp}{leader.romaji ? ` [${leader.romaji}]` : ''}
              </span>
            )}
          </div>
        </div>

        {/* everything below the header scrolls together — hero + info chart
            + flavor. only the title bar stays pinned so the user can see the
            current leader's name while reading the bio. previously the hero
            and chart were also pinned and only the flavor scrolled, which
            left a tiny window for reading on shorter viewports. */}
        <div className="leader-modal__scroll">
          {/* TEST RUN — `portrait_url` is the alphabetically-first image from
              each leader's bulbagarden archives category (scrape-leader-portraits.js).
              falls back to the VS sprite when missing. evaluating whether this
              yields a more standardized art style than the scattered VS sprites
              that the original scraper picked up; keep the grid thumb on `sprite`
              for now since some first-images are group shots (e.g. cilan's first
              image is the BW trio) and would read wrong as a single-leader thumb. */}
          {heroSrc && (
            <div className="ball-modal__hero leader-modal__hero">
              <Img
                src={heroSrc}
                alt={leader.name}
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          <div className="ball-modal__meta">
            <div className="info-cell">
              <span className="info-cell__label">location</span>
              <span className="info-cell__value">{cityNames.length ? cityNames.join(' | ') : '—'}</span>
            </div>
            <div className="info-cell">
              <span className="info-cell__label">type</span>
              <span className="info-cell__value info-cell__value--types">
                {leader.type
                  ? <span className={`type-badge type-${leader.type}`}>{leader.type}</span>
                  : '—'}
              </span>
            </div>
            <div className="info-cell info-cell--badge">
              <span className="info-cell__label">badge</span>
              <span className="info-cell__value">
                {badge ? (
                  <a href="/badges"
                     className="leader-modal__badge-link"
                     onClick={(e) => goToBadge(e, badge.id)}>
                    {badge.sprite && <img src={badge.sprite} alt={badge.name} referrerPolicy="no-referrer" />}
                    <span>{badge.name}</span>
                  </a>
                ) : (
                  leader.badge ? `${leader.badge} badge` : '—'
                )}
              </span>
            </div>
          </div>

          {/* flavor_text is stored with `\n\n` between paragraphs (multi-
              paragraph scrape); split + render each as its own <p> so the
              paragraph spacing survives the trip from the scraper. */}
          {leader.flavor_text && (
            <div className="leader-modal__flavor">
              {tightenFlavor(leader.flavor_text).split('\n\n').map((para, i) => (
                <p key={i} className="ball-modal__flavor">{para}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GymLeadersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // cross-modal arrivals: pre-open the targeted modal on the very first
  // render via useState's lazy initializer. needed for the View Transitions
  // mode where flushSync(navigate) must produce a synchronous render with
  // the modal already in the DOM — otherwise the browser's snapshot lands
  // on a blank destination. snap/dip/curtain don't strictly need this, but
  // it's a uniform path that also lets back/forward + auto-open share the
  // same code instead of two separate effects.
  const initialOpenId = location.state?.openId ?? null;
  const { current: currentLeader, modalRef, open, close } =
    useModalCycleNav(SECTIONED_LEADERS, initialOpenId);
  const { displayed: shownLeader, isClosing } = useModalAnimation(currentLeader);

  // consume-once: clear location.state after first render so back/forward
  // to this same history entry doesn't re-fire. soft pulse 60ms after the
  // commit so the auto-opened modal gets a soft scale bump in addition to
  // the default fade-in (snap/dip/curtain modes — the View Transitions
  // mode skips this and lets the browser handle the entrance instead).
  useEffect(() => {
    if (!initialOpenId) return;
    navigate(location.pathname, { replace: true, state: null });
    const mode = getString(STORAGE_KEYS.XFADE_MODE, 'snap');
    if (mode !== 'view') {
      setTimeout(() => { if (modalRef.current) pulseElement(modalRef.current); }, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="items-page">
      <p className="items-page__sub">{allLeaders.length} leaders across {SECTIONED_LEADERS.length} regions</p>

      {SECTIONED_LEADERS.map((section, sectionIdx) => (
        <div key={section.slug} className="items-section">
          <h2 className="items-section__label">{section.label}</h2>
          <div className="ball-grid leader-grid">
            {section.items.map((l, index) => (
              <button key={l.id} className={`ball-thumb leader-thumb leader-thumb--${l.type || 'unknown'}`}
                      onClick={(e) => {
                        const t = e.currentTarget;
                        pulseElement(t, { scale: 1.07, duration: 220, offset: 0.3 });
                        setTimeout(() => open(sectionIdx, index), 70);
                      }}>
                {/* thumbnail prefers thumb_url (Masters EX VS portrait —
                    uniform headshot framing across leaders) over the
                    full-body portrait_url. modal hero uses portrait_url
                    so the user sees the full character art on tap. */}
                {(l.thumb_url || l.portrait_url || l.sprite) && (
                  <img
                    src={l.thumb_url || l.portrait_url || l.sprite}
                    alt={l.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                )}
                <span>{l.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {shownLeader && (
        <LeaderModal
          leader={shownLeader}
          modalRef={modalRef}
          onClose={close}
          closing={isClosing}
        />
      )}
    </div>
  );
}
