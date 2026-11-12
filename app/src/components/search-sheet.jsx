import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchAll } from '../utils/global-search';
import { STORAGE_KEYS, getJSON, setJSON } from '../utils/storage';
import { useBodyScrollLock } from '../hooks/use-body-scroll-lock';
import Img from './img';

// ─── SearchSheet ─────────────────────────────────────────────────────────────
// phones: the bottom bar's search opens this panel over the current page
// instead of navigating away. the field sits at the bottom (thumb reach) and
// rides on top of the keyboard; grouped results stack above it. close it by
// swiping down, tapping outside, "close", or the search button again — the
// page underneath never moves. "see all results" goes to /search.
//
// the parent mounts it while open (and through the close animation) and owns
// the input ref: it has to mount the sheet AND focus the field inside the
// same tap (ios only raises the keyboard for a focus() made during the
// gesture), so it flushSyncs the open, then focuses.
//
// swipe-down comes free from SwipeDismiss (the overlay is in its list): a
// finished swipe clicks the overlay, which closes like a tap outside.

const RECENT_MAX = 6;

export default function SearchSheet({ open, closing, onClose, inputRef, onKeyboard }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(() => getJSON(STORAGE_KEYS.RECENT_SEARCHES, []) || []);
  const [kb, setKb] = useState(0);   // keyboard height in px (0 = down)
  const [vvh, setVvh] = useState(0); // visible height above the keyboard

  useBodyScrollLock(open);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  // keyboard tracking: on ios the visual viewport shrinks under the keyboard
  // while fixed elements stay sized to the layout viewport, so lift the sheet
  // by the difference. the parent tucks the bottom bar away meanwhile.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const update = () => {
      const h = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setKb(h > 80 ? h : 0);
      setVvh(Math.round(vv.height));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, [open]);
  useEffect(() => { onKeyboard?.(open && kb > 0); }, [open, kb, onKeyboard]);

  // scroll-vs-tap: a finger that moved, or a tap that only stopped a fling,
  // shouldn't pick a result.
  const touch = useRef({ y: 0, moved: false, lastScroll: 0 });
  const onTouchStart = (e) => { touch.current.y = e.touches[0].clientY; touch.current.moved = false; };
  const onTouchMove  = (e) => { if (Math.abs(e.touches[0].clientY - touch.current.y) > 6) touch.current.moved = true; };
  const onScroll     = () => { touch.current.lastScroll = performance.now(); };
  const wasScroll    = () => touch.current.moved || performance.now() - touch.current.lastScroll < 120;

  const q = query.trim();
  const groups = useMemo(() => searchAll(q), [q]);

  const remember = (term) => {
    const t = term.trim();
    if (!t) return;
    const next = [t, ...recent.filter(r => r.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
    setRecent(next);
    setJSON(STORAGE_KEYS.RECENT_SEARCHES, next);
  };

  const go = (entry) => {
    if (wasScroll()) return;
    remember(q);
    onClose();
    navigate(entry.route, entry.routeState ? { state: entry.routeState } : undefined);
  };
  const seeAll = () => {
    if (!q) return;
    remember(q);
    onClose();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  // ios also scrolls the layout viewport up when the field focuses, so the
  // sheet's height has to come from the VISIBLE height (vv.height), not
  // 100dvh — otherwise its top lands above the screen.
  const style = kb ? { '--search-kb': `${kb}px`, '--search-vvh': `${vvh}px` } : undefined;

  return (
    <div
      className={`search-sheet-overlay${closing ? ' closing' : ''}${kb ? ' has-kb' : ''}`}
      onClick={onClose}
      style={style}
    >
      <section className="search-sheet" role="dialog" aria-label="search" onClick={e => e.stopPropagation()}>
        <div className="search-sheet__grab" aria-hidden="true" />

        {/* short lists hug the field; long ones start at the best match */}
        <div className="search-sheet__results" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onScroll={onScroll}>
          <div className="search-sheet__inner">
            {!q ? (
              <>
                {recent.length > 0 && (
                  <>
                    <div className="search-sheet__group">recent</div>
                    <div className="search-sheet__chips">
                      {recent.map(r => (
                        <button key={r} type="button" onClick={() => { setQuery(r); inputRef.current?.focus(); }}>{r}</button>
                      ))}
                    </div>
                  </>
                )}
                <p className="search-sheet__empty">search pokémon, abilities, moves, cards, leaders, berries…</p>
              </>
            ) : groups.length === 0 ? (
              <p className="search-sheet__empty">no matches for “{q}”</p>
            ) : (
              <>
                {groups.map(g => (
                  <div key={g.type}>
                    <div className="search-sheet__group">{g.label}</div>
                    {g.results.map(entry => (
                      <button key={`${entry.type}-${entry.slug}`} type="button" className="search-sheet__hit" onClick={() => go(entry)}>
                        {entry.sprite
                          ? <Img src={entry.sprite} alt="" loading="lazy" wrapClassName="search-sheet__sprite" />
                          : <span className="search-sheet__sprite search-sheet__sprite--empty" aria-hidden="true" />}
                        <span className="search-sheet__text">
                          <span className="search-sheet__name">{entry.displayName}</span>
                          {entry.subtitle && <span className="search-sheet__sub">{entry.subtitle}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                <button type="button" className="search-sheet__all" onClick={seeAll}>
                  see all results for “{q}” →
                </button>
              </>
            )}
          </div>
        </div>

        <form className="search-sheet__field" onSubmit={e => { e.preventDefault(); seeAll(); }}>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search pokémon, cards, items…"
            aria-label="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <button type="button" className="search-sheet__close" onClick={onClose}>close</button>
        </form>
      </section>
    </div>
  );
}
