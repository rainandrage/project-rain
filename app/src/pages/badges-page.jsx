import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { useModalCycleNav } from '../hooks/use-modal-cycle-nav';
import { pulseElement } from '../utils/pulse';
import { crossModalNavigate } from '../utils/cross-modal-nav';
import { STORAGE_KEYS, getString } from '../utils/storage';
import badges from '../data/badges.json';
import leaders from '../data/gym-leaders.json';

// region order matches the games' release sequence — kanto first, paldea last.
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

// merge BW + B2W2 into a single unova section. the same badge name often
// appears in both gen-5 games with different leaders or cities (basic badge:
// lenora @ nacrene in BW vs cheren @ aspertia in B2W2). when that happens,
// fold the entries into one card and comma-join the differing fields — same
// pattern as galar where version-exclusive sword/shield gyms each get their
// own row but the shared 6 just appear once.
//   data file stays granular (unova-bw and unova-b2w2 are separate regions);
//   the merge is done at page-load so it's trivial to revisit later.
function mergeUnova(all) {
  const unovaSrc  = all.filter(b => b.region === 'unova-bw' || b.region === 'unova-b2w2');
  const byName    = new Map();
  for (const b of unovaSrc) {
    if (!byName.has(b.name)) {
      byName.set(b.name, {
        ...b,
        region:       'unova',
        region_label: 'unova',
        id:           b.id.replace(/-unova-(bw|b2w2)$/, '-unova'),
      });
      continue;
    }
    const existing = byName.get(b.name);
    const merge = (key) => {
      const a = existing[key], c = b[key];
      if (!a || !c || a === c) return;
      if (a.split(', ').includes(c)) return;
      existing[key] = `${a}, ${c}`;
    };
    merge('leader');
    merge('city');
  }
  return [...byName.values()];
}

const allBadges = [
  ...badges.filter(b => b.region !== 'unova-bw' && b.region !== 'unova-b2w2'),
  ...mergeUnova(badges),
];

const SECTIONED_BADGES = REGIONS
  .map(r => ({ ...r, items: allBadges.filter(b => b.region === r.slug) }))
  .filter(s => s.items.length);

// trio badge stores its type as "grass, fire, water" because the striaton gym
// has three rotating leaders. split on comma so the modal can render each as
// its own colored badge instead of a single mismatched class.
function splitTypes(t) {
  return (t || '').split(',').map(s => s.trim()).filter(Boolean);
}

// split a comma-separated multi-value field, dedupe (the trio + legend
// badges in the unova roster have repeated leader names from the scraper's
// alt-leader column), preserve first-seen order.
function splitDedup(s) {
  const seen = new Set();
  return (s || '').split(/,\s*/).filter(Boolean).filter(v => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

// derive a leader's id (matches gym-leaders.json conventions: <name-slug>-<region>)
// from a name + region pair so the modal can deep-link straight to the leader.
// returns the leader record if found, null otherwise — falls back to plain
// text rendering when there's no match (legacy data, future leaders, etc.).
function findLeader(name, region) {
  const slug = name.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  // unova badges live as -unova in the merged page but leaders.json keeps the
  // bw/b2w2 split — try the merged id first (matches gym-leaders-page output),
  // then fall back to the granular ids.
  const tries = [`${slug}-${region}`, `${slug}-${region}-bw`, `${slug}-${region}-b2w2`];
  for (const id of tries) {
    const hit = leaders.find(l => l.id === id);
    if (hit) return hit;
  }
  return null;
}

function BadgeModal({ badge, modalRef, onClose, closing }) {
  const navigate = useNavigate();


  const types       = splitTypes(badge.type);
  const leaderNames = splitDedup(badge.leader);
  const cityNames   = splitDedup(badge.city);

  // hand-off across pages — strategy chosen by the visuals settings picker
  // (MOCKUP). dispatches to one of snap/view/dip/curtain in cross-modal-nav.js.
  // modalRef passed so snap can fade the source via inline opacity (skips
  // the bouncy CSS pop-out animation that was reading as "trashed text").
  const goToLeader = (e, leaderId) => {
    e.preventDefault();
    const mode = getString(STORAGE_KEYS.XFADE_MODE, 'snap');
    crossModalNavigate(mode, {
      modalRef,
      onClose,
      navigate,
      toPath: '/leaders',
      openId: leaderId,
    });
  };

  return (
    <div className={`ability-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div ref={modalRef} className="ball-modal ball-modal--badge" onClick={e => e.stopPropagation()}>
        <div className="ball-modal__header">
          <div className="ball-modal__title">
            <h2>{badge.name}</h2>
          </div>
        </div>

        {badge.sprite && (
          <div className="ball-modal__hero">
            <img src={badge.sprite} alt={badge.name} referrerPolicy="no-referrer" />
          </div>
        )}

        <div className="ball-modal__meta">
          <div className="info-cell">
            <span className="info-cell__label">earned by defeating</span>
            <span className="info-cell__value info-cell__value--inline-list">
              {leaderNames.length === 0
                ? '—'
                : leaderNames.map((name, i) => {
                    const leader = findLeader(name, badge.region);
                    return (
                      <span key={name} className="inline-list-item">
                        {i > 0 && <span className="inline-list-pipe" aria-hidden="true">|</span>}
                        {leader
                          ? <a href="/leaders"
                               className="info-cell__link"
                               onClick={(e) => goToLeader(e, leader.id)}>{name}</a>
                          : <span>{name}</span>}
                      </span>
                    );
                  })}
            </span>
          </div>
          <div className="info-cell">
            <span className="info-cell__label">location</span>
            <span className="info-cell__value">{cityNames.length ? cityNames.join(' | ') : '—'}</span>
          </div>
          <div className="info-cell">
            <span className="info-cell__label">gym type</span>
            <span className="info-cell__value info-cell__value--types">
              {types.length
                ? types.map(t => <span key={t} className={`type-badge type-${t}`}>{t}</span>)
                : '—'}
            </span>
          </div>
          <div className="info-cell">
            <span className="info-cell__label">obey to</span>
            <span className="info-cell__value">{badge.obedience ? `lv. ${badge.obedience}` : '—'}</span>
          </div>
          <div className="info-cell">
            <span className="info-cell__label">unlocks</span>
            <span className="info-cell__value">{badge.hm || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BadgesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // pre-open via initial state for the View Transitions path; same render-
  // time wiring used by gym-leaders-page so behavior is consistent both
  // directions of the hand-off.
  const initialOpenId = location.state?.openId ?? null;
  const { current: currentBadge, modalRef, open, close } =
    useModalCycleNav(SECTIONED_BADGES, initialOpenId);
  const { displayed: shownBadge, isClosing } = useModalAnimation(currentBadge);

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
      <p className="items-page__sub">{allBadges.length} badges across {SECTIONED_BADGES.length} regions</p>

      {SECTIONED_BADGES.map((section, sectionIdx) => (
        <div key={section.slug} className="items-section">
          <h2 className="items-section__label">{section.label}</h2>
          <div className="ball-grid">
            {section.items.map((b, index) => (
              <button key={b.id} className="ball-thumb"
                      onClick={(e) => {
                        // capture the target before the async open() — once the
                        // modal mounts, react may pool / nullify the synthetic
                        // event's currentTarget by the time the timeout fires.
                        const t = e.currentTarget;
                        // pulse is sized + timed to peak before the modal's
                        // backdrop fades in (otherwise the dim overlay buries
                        // the animation). 70ms delay lets the peak land while
                        // the thumb is still fully visible.
                        pulseElement(t, { scale: 1.07, duration: 220, offset: 0.3 });
                        setTimeout(() => open(sectionIdx, index), 70);
                      }}>
                {b.sprite && <img src={b.sprite} alt={b.name} loading="lazy" referrerPolicy="no-referrer" />}
                <span>{b.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {shownBadge && (
        <BadgeModal
          badge={shownBadge}
          modalRef={modalRef}
          onClose={close}
          closing={isClosing}
        />
      )}
    </div>
  );
}
