import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { useModalAnimation } from './hooks/use-modal-animation';
import { useBodyScrollLock } from './hooks/use-body-scroll-lock';
import { useCompact } from './hooks/use-compact';
import { getAppScroller, scrollPositions } from './utils/app-scroll';
import { STORAGE_KEYS, getString, setString, getBool, setBool, getJSON, setJSON } from './utils/storage';
import HomePage from './pages/home-page';
import PokemonPage from './pages/pokemon-page';
import ComparePage from './pages/compare-page';
import TeamPage from './pages/team-page';
import LorePage from './pages/lore-page';
import NewsPage from './pages/news-page';
import TypesPage from './pages/types-page';
import PokeballsPage from './pages/pokeballs-page';
import BerriesPage from './pages/berries-page';
import MovesPage from './pages/moves-page';
import BadgesPage from './pages/badges-page';
import GymLeadersPage from './pages/gym-leaders-page';
import TCGPocketPage from './pages/tcgp-page';
import TCGPocketAccessoriesPage from './pages/tcgp-accessories-page';
import ChangelogPage from './pages/changelog-page';
import AboutPage from './pages/about-page';
import SearchPage from './pages/search-page';
import TransitionVeil from './components/transition-veil';
import SwipeDismiss from './components/swipe-dismiss';
import GlobalSearch from './components/global-search';
import { RetroProvider } from './hooks/use-retro-sprites';

// section flags:
//   `divider: true` draws a hairline above the section. dividers go above
//                   every labeled category (browse/tools/world) and above
//                   the trailing `about` link so each header category
//                   reads as a distinct group.
//   `label`         renders a small uppercase subheading above the section
//                   so the eye can lock onto a category in one scan rather
//                   than reading 9 sibling links
const NAV_SECTIONS = [
  // news sits at the very top alone — it's the landing page, gets visual
  // primacy. pokedex sits in its own divided section right below so the
  // user can scan the menu and immediately see "news" + "the dex" as two
  // distinct anchor points before the labeled sections begin.
  {
    items: [
      { to: '/news', label: 'news' },
    ],
  },
  {
    divider: true,
    items: [
      { to: '/pokedex', label: 'pokedex' },
    ],
  },
  // visual catalogs. world content (gym leaders + lore) folded in here so
  // the catalog/world distinction collapses into one bucket — both are
  // browsable trainer/encyclopedic catalogs.
  {
    divider: true,
    label:   'gallery',
    items: [
      { to: '/badges',    label: 'badges' },
      { to: '/berries',   label: 'berries' },
      { to: '/pokeballs', label: 'pokéballs' },
      { to: '/leaders',   label: 'gym leaders'    },
      { to: '/lore',      label: 'lore & legends' },
    ],
  },
  {
    divider: true,
    label: 'tools',
    items: [
      { to: '/compare', label: 'compare' },
      { to: '/team',    label: 'team builder' },
      { to: '/types',   label: 'type chart' },
      { to: '/moves',   label: 'moves' },
    ],
  },
  // separate game gets its own section. links inside lose the "tcg pocket"
  // prefix since the section header already says it.
  {
    divider: true,
    label: 'tcg pocket',
    items: [
      { to: '/tcgp',             label: 'cards' },
      { to: '/tcgp-accessories', label: 'accessories' },
    ],
  },
  { divider: true, items: [{ to: '/about',     label: 'about' }] },
  { divider: true, items: [{ to: '/changelog', label: 'changelog' }] },
];

// flat path → label lookup, derived from NAV_SECTIONS, for the chip shown
// inside the burger so the header always names the current section.
const NAV_LABELS = NAV_SECTIONS.reduce((m, s) => {
  s.items.forEach(it => { m[it.to] = it.label; });
  return m;
}, {});

// the section label for the current route. exact nav matches win; sub-routes
// that have no nav entry of their own fall back to their parent section
// (pokemon detail pages read as "pokedex", the global search as "search").
function navLabelFor(pathname) {
  // root redirects to /news; label it as news for the brief pre-redirect frame.
  if (pathname === '/') return 'news';
  // tcg pocket items keep their section as a prefix so "cards" / "accessories"
  // aren't left contextless once the in-page titles are gone.
  if (pathname === '/tcgp')             return 'tcgp cards';
  if (pathname === '/tcgp-accessories') return 'tcgp accessories';
  if (NAV_LABELS[pathname]) return NAV_LABELS[pathname];
  if (pathname.startsWith('/pokemon')) return 'pokedex';
  if (pathname.startsWith('/search'))  return 'search';
  return 'menu';
}

// does this nav link represent the page we're on? detail pages count as their
// parent list (/pokemon/6 → pokedex) so the menu still marks where you are.
function isCurrentLink(to, pathname) {
  if (pathname === to) return true;
  if (to === '/news' && pathname === '/') return true;
  if (to === '/pokedex' && pathname.startsWith('/pokemon')) return true;
  return false;
}
// label of the collapsible nav section holding the current page (or null)
function currentNavSection(pathname) {
  const s = NAV_SECTIONS.find(sec => sec.label && sec.items.some(f => isCurrentLink(f.to, pathname)));
  return s ? s.label : null;
}

const THEMES = ['auto', 'light', 'dark', 'ereader', 'retro', 'nitro'];

// every base starter across gen 1 → gen 9, plus pichu. shuffled on mount and
// doubled (JSX below) so the keyframe's `translateX(-50%)` lands sprite[count]
// exactly where sprite[0] started. the inner `.header-sprites` element is
// `width: max-content` in CSS, so -50% is always half the real content width
// regardless of this roster's length — adding or removing entries here just
// works, no CSS update needed.
const HEADER_SPRITE_IDS = [
  // gen 1
  1, 4, 7,
  // gen 2 (+ pichu)
  152, 155, 158, 172,
  // gen 3
  252, 255, 258,
  // gen 4
  387, 390, 393,
  // gen 5
  495, 498, 501,
  // gen 6
  650, 653, 656,
  // gen 7
  722, 725, 728,
  // gen 8
  810, 813, 816,
  // gen 9
  906, 909, 912,
];

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// animation durations for the sprite strip (milliseconds).
// normal is the default drift; a11y slows it ~73% so motion-sensitive users
// still get a living header without it whipping past.
const SPRITE_ANIM_NORMAL_MS = 52000;
const SPRITE_ANIM_A11Y_MS   = 90000;

function HeaderSprites({ a11y }) {
  // shuffle once per mount so the ordering is random per session but stable
  // across re-renders (otherwise the strip would reshuffle on every state
  // change in the header and jitter mid-animation).
  const strip = useMemo(() => {
    const shuffled = shuffle(HEADER_SPRITE_IDS);
    return [...shuffled, ...shuffled];
  }, []);

  // JS-managed animation via the Web Animations API rather than CSS. two
  // reasons: (1) on a11y toggle we can retime the running animation in place
  // — compute current progress, update duration, seek currentTime to preserve
  // that progress — so sprites keep moving without a reset. CSS animation
  // changes would restart from 0. (2) the universal
  // `[data-a11y='true'] * { animation: none !important }` rule in main.scss
  // only kills CSS animations; WAAPI animations are on a separate track and
  // sail right past it.
  const stripRef = useRef(null);
  const animRef  = useRef(null);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    animRef.current = el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-50%)' },
      ],
      {
        duration:   a11y ? SPRITE_ANIM_A11Y_MS : SPRITE_ANIM_NORMAL_MS,
        iterations: Infinity,
        easing:     'linear',
      },
    );
    return () => animRef.current?.cancel();
    // intentionally mount-only: a11y-driven retime is handled by the next
    // effect so we don't cancel+restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    const timing      = anim.effect?.getComputedTiming?.();
    const oldDuration = typeof timing?.duration === 'number' ? timing.duration : SPRITE_ANIM_NORMAL_MS;
    const currentTime = Number(anim.currentTime) || 0;
    const progress    = (currentTime % oldDuration) / oldDuration;
    const newDuration = a11y ? SPRITE_ANIM_A11Y_MS : SPRITE_ANIM_NORMAL_MS;
    anim.effect?.updateTiming({ duration: newDuration });
    // seek so the visual position survives the retime; without this the
    // strip would jump backward/forward to whatever spot corresponds to the
    // raw currentTime in the new duration.
    anim.currentTime = newDuration * progress;
  }, [a11y]);

  // structural note: outer `.header-sprites-clip` handles positioning + the
  // header-width clip box. inner `.header-sprites` has `width: max-content`
  // so its `-50%` transform translates by exactly half the content width —
  // one full copy — landing sprite[count] where sprite[0] started. merging
  // the clip and the animated element would force the animated element's
  // width to match the header, breaking the loop math.
  return (
    <div className="header-sprites-clip" aria-hidden="true">
      <div className="header-sprites" ref={stripRef}>
        {strip.map((id, i) => (
          <img
            key={i}
            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`}
            alt=""
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}


// saves scroll positions per location key and restores them on back navigation
// only scrolls to top when the pathname actually changes — search param changes (e.g. form switching) are ignored
function ScrollManager() {
  const location   = useLocation();
  const navType    = useNavigationType();
  const prevPath   = useRef(location.pathname);

  useEffect(() => {
    const scroller = getAppScroller();
    if (!scroller) return;
    const save = () => { scrollPositions.set(location.key, scroller.scrollTop); };
    scroller.addEventListener('scroll', save, { passive: true });
    return () => scroller.removeEventListener('scroll', save);
  }, [location.key]);

  useEffect(() => {
    const scroller = getAppScroller();
    if (!scroller) return;
    if (navType === 'POP') {
      // back/forward → restore saved scroll instantly so the user lands
      // exactly where they left off. note: pages that load content async
      // (e.g. HomePage's pokemon grid) re-apply this themselves once
      // their data renders, since the initial commit here is too short
      // to seek a deep saved offset.
      scroller.scrollTo(0, scrollPositions.get(location.key) ?? 0);
    } else {
      // forward navigation → reset scroll to top when (a) pathname changed
      // or (b) the navigation explicitly opted in via state.scrollTop.
      // (b) covers mega-evo card clicks where only ?form= changes — same
      // pathname but the user expects to land at the top of the new view.
      const pathChanged = location.pathname !== prevPath.current;
      const explicitTop = location.state?.scrollTop === true;
      const optedOut    = location.state?.noScroll === true;
      if (!optedOut && (pathChanged || explicitTop)) {
        // INSTANT, synchronous reset — must happen before the browser
        // paints the new route or the user sees the old scrollTop bleed
        // through (e.g. clicking a card from a deep scroll on /pokedex
        // would briefly show /pokemon/:id halfway down its detail page).
        // smooth-scroll-from-old-position was the previous behavior and
        // is what produced that flash.
        scroller.scrollTop = 0;
      }
    }
    prevPath.current = location.pathname;
  }, [location.key, navType, location.pathname]);

  return null;
}

// header lives inside BrowserRouter so it can use useSearchParams
function AppHeader({ theme, setTheme, a11y, setA11y }) {
  const [visualsOpen,  setVisualsOpen]  = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useCompact();
  const sectionLabel = navLabelFor(location.pathname);
  const onSearchPage = location.pathname.startsWith('/search');

  // expanded state for collapsible nav categories (browse / tools / world).
  // accordion behavior — only one section open at a time. opening a new
  // section collapses any others; clicking the same section toggles it
  // off. cuts the dropdown height roughly in half on mobile when nav
  // groups stack and removes the scroll-to-find-the-header friction
  // when multiple sections were left open from a prior session. state
  // persists as `{[label]: true}` for the open section only (or `{}`).
  const [navExpanded, setNavExpanded] = useState(() => getJSON(STORAGE_KEYS.NAV_EXPANDED, {}));
  const toggleNavSection = (label) => {
    setNavExpanded(prev => {
      const next = prev[label] ? {} : { [label]: true };
      setJSON(STORAGE_KEYS.NAV_EXPANDED, next);
      return next;
    });
  };

  // lock body scroll while either dropdown is open. without this, dragging
  // on the dropdown surface (especially on ipad / iphone) chains the touch
  // through to the page beneath, which scrolls under the open menu — feels
  // broken. flips off the moment both dropdowns close.
  useBodyScrollLock(visualsOpen || featuresOpen);
  const { displayed: visualsShown,  isClosing: visualsClosing }  = useModalAnimation(visualsOpen);
  const { displayed: featuresShown, isClosing: featuresClosing } = useModalAnimation(featuresOpen);
  const visualsRef    = useRef(null);
  const featuresRef   = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (visualsRef.current  && !visualsRef.current.contains(e.target))  setVisualsOpen(false);
      if (featuresRef.current && !featuresRef.current.contains(e.target)) setFeaturesOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Escape closes whichever dropdown is open. only bind while one is — avoids
  // catching Escape that might be meaningful elsewhere (e.g. in a modal).
  useEffect(() => {
    if (!visualsOpen && !featuresOpen) return;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      setVisualsOpen(false);
      setFeaturesOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visualsOpen, featuresOpen]);

  // burger-menu keyboard nav: arrow up/down moves between feature-links,
  // first item gets focus on open so the user can start arrow-ing immediately.
  // Tab still works as a fallback. Enter on a focused link navigates (browser
  // default for anchors). only the burger gets this treatment because the
  // visuals dropdown contains a native <select> and a div toggle, which
  // already handle their own keyboard semantics inconsistently — out of scope
  // for this pass.
  useEffect(() => {
    if (!featuresOpen) return;
    const root = featuresRef.current?.querySelector('.features-modal');
    if (!root) return;
    const items = [...root.querySelectorAll('.feature-link')];
    if (!items.length) return;
    // defer focus to the next frame so the dropdown's open animation doesn't
    // get interrupted by a focus-driven repaint mid-frame
    requestAnimationFrame(() => items[0]?.focus());

    const handler = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const focused = document.activeElement;
      let idx = items.indexOf(focused);
      if (idx === -1) idx = 0;
      else            idx = e.key === 'ArrowDown'
                              ? (idx + 1) % items.length
                              : (idx - 1 + items.length) % items.length;
      items[idx]?.focus();
    };
    root.addEventListener('keydown', handler);
    return () => root.removeEventListener('keydown', handler);
  }, [featuresOpen]);

  // the two control groups render in the header on wider screens and in
  // the floating bottom bar on phones (compact). same elements, same state —
  // only where they mount changes.
  const menuAnchor = (
    <div className="settings-anchor" ref={featuresRef}>
      <button
        className="settings-btn settings-burger"
        onClick={() => {
          // opening the menu reveals where you are: expand the section
          // holding the current page (accordion — only that one) so its
          // highlighted link is visible without digging.
          if (!featuresOpen) {
            const cur = currentNavSection(location.pathname);
            if (cur) { setNavExpanded({ [cur]: true }); setJSON(STORAGE_KEYS.NAV_EXPANDED, { [cur]: true }); }
          }
          setFeaturesOpen(o => !o);
        }}
        aria-label={`menu — ${sectionLabel}`}
        aria-expanded={featuresOpen}
      >
        {compact && featuresOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect y="2" width="16" height="2" rx="1"/>
            <rect y="7" width="16" height="2" rx="1"/>
            <rect y="12" width="16" height="2" rx="1"/>
          </svg>
        )}
        {compact && <span className="bottom-bar__label">{onSearchPage ? 'menu' : sectionLabel}</span>}
      </button>
      {featuresShown && (
        <div className={`settings-modal features-modal${featuresClosing ? ' closing' : ''}`}>
          {NAV_SECTIONS.map((section, si) => {
            // labeled sections collapse by default. unlabeled sections
            // (news, about) always render their items inline (no
            // collapsible wrapper needed).
            const isExpanded = section.label ? !!navExpanded[section.label] : true;
            const renderItem = (f) => (
              <Link
                key={f.to}
                to={f.to}
                className={`feature-link${section.label ? ' feature-link--nested' : ''}${isCurrentLink(f.to, location.pathname) ? ' is-current' : ''}`}
                aria-current={isCurrentLink(f.to, location.pathname) ? 'page' : undefined}
                onClick={() => {
                  setFeaturesOpen(false);
                  // collapse all nav sections on any navigation. simpler
                  // than treating top-level vs nested items differently;
                  // every fresh menu-open starts from a clean state
                  // instead of carrying expanded sections from prior
                  // sessions.
                  setNavExpanded({});
                  setJSON(STORAGE_KEYS.NAV_EXPANDED, {});
                }}
              >
                {f.label}
              </Link>
            );
            return (
              <Fragment key={si}>
                {section.divider && <div className="dropdown-divider" />}
                {section.label ? (
                  <>
                    <button
                      type="button"
                      className={`nav-section-label nav-section-label--toggle${isExpanded ? ' is-expanded' : ''}${section.items.some(f => isCurrentLink(f.to, location.pathname)) ? ' has-current' : ''}`}
                      onClick={() => toggleNavSection(section.label)}
                      aria-expanded={isExpanded}
                    >
                      <span>{section.label}</span>
                      <span className="nav-section-label__chevron" aria-hidden="true">›</span>
                    </button>
                    {/* always-mounted collapsible wrapper — items stay
                        in the DOM so the grid-track animation can
                        smoothly expand/collapse height instead of
                        popping in/out. */}
                    <div
                      className={`nav-section-items${isExpanded ? ' is-expanded' : ''}`}
                      aria-hidden={!isExpanded}
                    >
                      <div className="nav-section-items__inner">
                        {section.items.map(renderItem)}
                      </div>
                    </div>
                  </>
                ) : (
                  section.items.map(renderItem)
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );

  const settingsAnchor = (
    <div className="settings-anchor" ref={visualsRef}>
      <button className="settings-btn settings-cog" onClick={() => setVisualsOpen(o => !o)} aria-label="settings" aria-expanded={visualsOpen}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
        </svg>
        {compact && <span className="bottom-bar__label">settings</span>}
      </button>

      {visualsShown && (
        <div className={`settings-modal${visualsClosing ? ' closing' : ''}`}>
          <span className="settings-label">visuals</span>

          <div className="settings-section">
            <span className="settings-sublabel">theme</span>
            <select
              className="theme-select"
              value={theme}
              onChange={e => setTheme(e.target.value)}
            >
              {THEMES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="dropdown-divider" />

          <div className="settings-section">
            <span className="settings-sublabel">a11y</span>
            <label className="toggle-row">
              <span>a11y mode</span>
              <div
                className={`toggle-switch${a11y ? ' on' : ''}`}
                onClick={() => setA11y(v => !v)}
              />
            </label>
            <p className="settings-hint">adds patterns to stat bars, removes animations, increases font size and spacing, boosts contrast</p>
          </div>

        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <>
        <header className="site-header site-header--compact">
          <HeaderSprites a11y={a11y} />
        </header>
        {/* body portal: pull-to-refresh transforms #root, which would drag a
            fixed bar along with it (same reason as the footer strip). */}
        {createPortal(
          <>
          {/* dims the page while a sheet is open; tapping it closes the
              sheet via the document-level outside-click handler */}
          {(featuresShown || visualsShown) && (
            <div className={`bottom-bar-scrim${(featuresClosing || visualsClosing) ? ' closing' : ''}`} aria-hidden="true" />
          )}
          <nav className={`bottom-bar${onSearchPage ? ' bottom-bar--search' : ''}`} aria-label="app">
            {menuAnchor}
            <button
              type="button"
              className={`settings-btn bottom-bar__search${onSearchPage ? ' is-current' : ''}`}
              onClick={() => navigate('/search?focus=1')}
              aria-label="search"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
              <span className="bottom-bar__label">search</span>
            </button>
            {settingsAnchor}
          </nav>
          </>,
          document.body,
        )}
      </>
    );
  }

  return (
    <header className="site-header">
      <HeaderSprites a11y={a11y} />

      <div className="header-left">
        {menuAnchor}
      </div>

      <div className="header-right">
        <GlobalSearch />
        {settingsAnchor}
      </div>
    </header>
  );
}

// applies and persists theme + a11y preferences.
// 'auto' follows the OS prefers-color-scheme setting live — we watch matchMedia so a
// system-level toggle (e.g. macOS light→dark at sundown) updates the site immediately
// without a reload. selecting any explicit theme overrides the OS preference.
function useVisualSettings() {
  const [theme, setTheme] = useState(() => {
    const saved = getString(STORAGE_KEYS.THEME, '');
    // migrate old 'warm'/'cream' values to 'light'
    if (saved === 'warm' || saved === 'cream') return 'light';
    // new/unset users default to 'auto' so first visit matches their system.
    return saved || 'auto';
  });
  const [a11y, setA11y] = useState(() => getBool(STORAGE_KEYS.A11Y, false));

  useEffect(() => {
    setString(STORAGE_KEYS.THEME, theme);
    if (theme !== 'auto') {
      document.documentElement.setAttribute('data-theme', theme);
      return;
    }
    // auto: resolve to light/dark from OS, and re-resolve on system change.
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.setAttribute('data-theme', mql.matches ? 'dark' : 'light');
    };
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-a11y', a11y);
    setBool(STORAGE_KEYS.A11Y, a11y);
  }, [a11y]);

  return { theme, setTheme, a11y, setA11y };
}

export default function App() {
  const { theme, setTheme, a11y, setA11y } = useVisualSettings();

  // tag <html data-standalone> when launched from the ios home-screen icon.
  // we deliberately don't rely solely on `@media (display-mode: standalone)` —
  // ios safari's match for that query is inconsistent across versions, and
  // some standalone-launched sessions don't match it at all. JS detection
  // covers both modern (`display-mode`) and legacy (`navigator.standalone`).
  // CSS rules in _base.scss are keyed off `html[data-standalone]` so the
  // body bg / overscroll overrides apply deterministically.
  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator?.standalone === true;
    if (!standalone) return;
    document.documentElement.setAttribute('data-standalone', '');
    return () => document.documentElement.removeAttribute('data-standalone');
  }, []);

  return (
    <RetroProvider>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ScrollManager />
      <SwipeDismiss />
      <AppHeader
        theme={theme} setTheme={setTheme}
        a11y={a11y} setA11y={setA11y}
      />
      <TransitionVeil />
      <main className="app-scroll">
        <Routes>
          <Route path="/"            element={<Navigate to="/news" replace />} />
          <Route path="/news"        element={<NewsPage />} />
          <Route path="/pokedex"     element={<HomePage />} />
          <Route path="/pokemon/:id" element={<PokemonPage />} />
          <Route path="/compare"     element={<ComparePage />} />
          <Route path="/types"       element={<TypesPage />} />
          <Route path="/moves"       element={<MovesPage />} />
          <Route path="/pokeballs"   element={<PokeballsPage />} />
          <Route path="/berries"     element={<BerriesPage />} />
          <Route path="/badges"      element={<BadgesPage />} />
          <Route path="/leaders"     element={<GymLeadersPage />} />
          <Route path="/tcgp"        element={<TCGPocketPage />} />
          <Route path="/tcgp-accessories" element={<TCGPocketAccessoriesPage />} />
          <Route path="/team"        element={<TeamPage />} />
          <Route path="/lore"        element={<LorePage />} />
          <Route path="/about"       element={<AboutPage />} />
          <Route path="/changelog"   element={<ChangelogPage />} />
          <Route path="/search"      element={<SearchPage />} />
        </Routes>
      </main>
      {/* footer chrome strip — rendered as a body-portal sibling of #root so
          pull-to-refresh's transform on #root doesn't translate it (ptr only
          owns #root; if the footer were a flex child of #root, it'd slide
          down with the rest of the page during a pull). position: fixed
          anchors it to the visual viewport; .app-scroll has padding-bottom
          equal to the footer's height so content doesn't tuck behind it.
          it carries no content now — in iOS PWA standalone, height collapses to
          env(safe-area-inset-bottom) and content is clipped via overflow,
          so the band claims the home-indicator zone as intentional UI. */}
      {typeof document !== 'undefined' && createPortal(
        <footer className="site-footer-strip" />,
        document.body,
      )}
    </BrowserRouter>
    </RetroProvider>
  );
}
