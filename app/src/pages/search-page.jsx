import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchAll } from '../utils/global-search';
import Img from '../components/img';

// full-page results for a global search query. mounted at /search?q=… —
// hit enter in the header search input to land here. groups are stacked
// vertically with a horizontal divider between each. clicking a result
// routes to its full destination (same routes the header dropdown uses).
//
// for each category we ask searchAll for up to 100 results — generous cap
// that covers nearly every realistic query without showing the entire
// 1000+ pokemon list for a 1-char query.
export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = searchParams.get('q') || '';
  const q = raw.trim();

  // the page has its own field (phones reach search from the bottom bar,
  // which opens this page with ?focus=1). typing rewrites ?q in place.
  const inputRef = useRef(null);
  const wantsFocus = searchParams.get('focus') === '1';
  useEffect(() => { if (wantsFocus) inputRef.current?.focus(); }, [wantsFocus]);
  const onType = (e) => {
    const next = e.target.value;
    setSearchParams(next ? { q: next } : {}, { replace: true });
  };

  const groups = useMemo(() => searchAll(q, { limit: 100 }), [q]);
  const totalCount = groups.reduce((n, g) => n + g.results.length, 0);

  const handleClick = (entry) => {
    navigate(entry.route, entry.routeState ? { state: entry.routeState } : undefined);
  };

  return (
    <div className="search-page">
      <input
        ref={inputRef}
        type="search"
        className="search-page__input"
        placeholder="search pokémon, cards, items…"
        aria-label="search"
        value={raw}
        onChange={onType}
        enterKeyHint="search"
        autoComplete="off"
      />
      <header className="search-page__header">
        <h1 className="search-page__title">
          {q ? <>results for <span className="search-page__query">“{q}”</span></> : 'search'}
        </h1>
        {q && (
          <p className="search-page__count">
            {totalCount === 0
              ? 'no matches'
              : `${totalCount} match${totalCount === 1 ? '' : 'es'} across ${groups.length} categor${groups.length === 1 ? 'y' : 'ies'}`}
          </p>
        )}
      </header>

      {!q && <p className="search-page__empty">start typing to search everything.</p>}

      {groups.map((g, gi) => (
        <section key={g.type} className="search-page__group">
          {gi > 0 && <hr className="search-page__divider" />}
          <h2 className="search-page__group-label">{g.label} <span className="search-page__group-count">({g.results.length})</span></h2>
          <div className="search-page__results">
            {g.results.map((entry) => (
              <button
                key={`${entry.type}-${entry.slug}`}
                type="button"
                className="search-page__result"
                onClick={() => handleClick(entry)}
              >
                {entry.sprite && (
                  <Img
                    src={entry.sprite}
                    alt=""
                    className="search-page__result-sprite"
                    loading="lazy"
                  />
                )}
                <span className="search-page__result-text">
                  <span className="search-page__result-name">{entry.displayName}</span>
                  {entry.subtitle && (
                    <span className="search-page__result-subtitle">{entry.subtitle}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
