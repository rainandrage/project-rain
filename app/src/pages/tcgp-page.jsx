import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { useModalCycleNav } from '../hooks/use-modal-cycle-nav';
import { pulseElement } from '../utils/pulse';
import { STORAGE_KEYS, getString } from '../utils/storage';
import Img from '../components/img';
import TcgpJumpNav from '../components/tcgp-jump-nav';
import rawCards from '../data/tcg-pocket.json';

// most card images hot-link limitless's cdn (absolute urls). sets limitless
// doesn't carry (e.g. SP1) are self-hosted under public/assets/tcgp/ and stored
// as relative paths — prefix vite's base so they resolve under /project-xr/.
const BASE = import.meta.env?.BASE_URL || '/';
const resolveImg = (u) => (u && !/^https?:/.test(u) ? BASE + u : u);
const cards = rawCards.map(c => (/^https?:/.test(c.image_url)
  ? c
  : { ...c, image_url: resolveImg(c.image_url), image_full: resolveImg(c.image_full) }));

// flat list of sets in newest-first order. used by:
//   - the set filter dropdown (always shows sets in this order)
//   - the progressive disclosure path (default mode reveals one older set at
//     a time when groupBy === 'set' and no explicit set filter is active)
// label format `[CODE] Set Name` matches the dropdown rendering so the
// section heading and the filter pill stay in sync.
const SECTIONED_CARDS = (() => {
  const bySet = new Map();
  for (const c of cards) {
    if (!bySet.has(c.set)) {
      bySet.set(c.set, {
        slug: c.set,
        label: `[${c.set}] ${c.set_name}`,
        release: c.set_release,
        items: [],
      });
    }
    bySet.get(c.set).items.push(c);
  }
  return [...bySet.values()].sort((a, b) => b.release.localeCompare(a.release));
})();

// quick lookup of set→release used by the "card number" sort (which falls
// back to set release date when items span multiple sets, e.g. when grouping
// by rarity or with grouping off).
const SET_RELEASE = (() => {
  const m = new Map();
  for (const c of cards) m.set(c.set, c.set_release);
  return m;
})();

const RARITY_LABELS = {
  C:   'Common',         U:  'Uncommon',         R:  'Rare',
  RR:  'Double Rare',    AR: 'Art Rare',         SR: 'Super Rare',
  SAR: 'Special Art Rare', IM: 'Immersive Rare', UR: 'Crown Rare',
  S:   'Shiny',          SSR:'Shiny Super Rare',
  AN:  'Anomaly',
};

// canonical orders for filter dropdown — rarity ascends from common to crown,
// element follows the energy-color sequence used everywhere in tcg pocket
// (fire→water→…) so the filter feels predictable.
const RARITY_ORDER  = ['C','U','R','RR','AR','SR','SAR','IM','UR','S','SSR','AN'];
const ELEMENT_ORDER = ['fire','water','grass','lightning','psychic','fighting','darkness','metal','colorless','dragon','fairy'];

// ── alt-print "echoes" ─────────────────────────────────────────────────────
// two cards are echoes (alt prints of one another) when they're functionally
// IDENTICAL — same name, type, hp, stage, evolves-from, weakness, retreat, and
// the exact same attacks + ability — differing only in artwork / rarity / set.
// this is why grouping by name alone is wrong: e.g. "Charizard ex" has two
// distinct functional cards (Slash/Crimson Storm vs Stoke/Steam Artillery),
// each with several art prints — the signature keeps them apart. cross-set
// reprints of an identical card ARE echoes (same function, new art).
function echoSignature(c) {
  return JSON.stringify([
    c.name, c.element, c.card_type, c.stage, c.evolves_from, c.hp,
    c.weakness, c.retreat,
    (c.attacks || []).map(a => [a.cost, a.name, a.damage, a.effect]),
    c.ability ? [c.ability.name, c.ability.effect] : null,
  ]);
}

// uid → the full sorted print group (including the card itself), only for cards
// that actually have >1 print. computed once from the full dataset.
const ECHOES = (() => {
  const bySig = new Map();
  for (const c of cards) {
    const k = echoSignature(c);
    let group = bySig.get(k);
    if (!group) bySig.set(k, group = []);
    group.push(c);
  }
  const byUid = new Map();
  for (const group of bySig.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      a.set_release === b.set_release
        ? Number(a.number) - Number(b.number)
        : (a.set_release < b.set_release ? -1 : 1));
    for (const c of group) byUid.set(c.uid, sorted);
  }
  return byUid;
})();

// total cards per set → the "N/total" card-number format (e.g. 36/286). the
// denominator is the highest number in the set (numbering is contiguous 1..N).
const SET_TOTALS = (() => {
  const m = new Map();
  for (const c of cards) {
    const n = Number(c.number);
    if (Number.isFinite(n)) m.set(c.set, Math.max(m.get(c.set) || 0, n));
  }
  return m;
})();
const cardNumber = (c) => {
  const total = SET_TOTALS.get(c.set);
  return total ? `${c.number}/${total}` : `#${c.number}`;
};


const RARITY_OPTIONS  = RARITY_ORDER.filter(r  => cards.some(c => c.rarity === r));
const ELEMENT_OPTIONS = ELEMENT_ORDER.filter(e => cards.some(c => c.element === e));

// ── packs ("pulled from") ───────────────────────────────────────────────────
// every card lists the booster pack(s) it can be pulled from (flibustier's
// `packs`). sets with several packs (genetic apex: mewtwo / pikachu /
// charizard) have some cards exclusive to one pack and some in all of them.
const SET_PACKS = (() => {
  const m = new Map();
  for (const c of cards) {
    if (!m.has(c.set)) m.set(c.set, new Set());
    for (const p of c.packs || []) m.get(c.set).add(p);
  }
  return m;
})();

// short human label for where this print comes from within its own set, or
// null when the set name alone says it (single-pack sets).
function packText(c) {
  const packs = c.packs || [];
  if (!packs.length) return 'not in booster packs';
  if (c.set.startsWith('PROMO')) return `${packs.join(' / ')} promo pack`;
  const all = SET_PACKS.get(c.set);
  if (!all || all.size < 2) return null;
  if (packs.length === all.size) return 'any pack';
  // "Dual Fusion Pikachu" in set "Dual Fusion" → "Pikachu"
  const short = packs.map(p => (p.startsWith(c.set_name + ' ') ? p.slice(c.set_name.length + 1) : p));
  return `${short.join(' or ')} pack`;
}

// same-art prints: identical function (echo signature) AND same illustrator
// AND same rarity — i.e. a straight reprint of this exact card, like genetic
// apex Bulbasaur (A1-1) reappearing in deluxe pack: ex as A4b-1 (plain) and
// A4b-2 (foil). drives the "pulled from" list so a card shows every set/pack
// that can give you that art. (alt arts — different illustrator or rarity —
// stay in "other prints" only.) two copies inside ONE set only count as the
// same art in deluxe sets (plain + foil); elsewhere same-set twins are real
// variants — e.g. SP1's red / green / blue anomaly Mews — and we can't tell
// which of them a cross-set reprint matches, so such groups are skipped.
const isDeluxe = (c) => /deluxe/i.test(c.set_name);
const SAME_ART = (() => {
  const bySig = new Map();
  for (const c of cards) {
    const k = `${echoSignature(c)}|${c.illustrator}|${c.rarity}`;
    if (!bySig.has(k)) bySig.set(k, []);
    bySig.get(k).push(c);
  }
  const byUid = new Map();
  for (const group of bySig.values()) {
    if (group.length < 2) continue;
    const perSet = new Map();
    for (const c of group) if (!isDeluxe(c)) perSet.set(c.set, (perSet.get(c.set) || 0) + 1);
    if ([...perSet.values()].some(n => n > 1)) continue;
    const sorted = [...group].sort((a, b) =>
      a.set_release === b.set_release
        ? Number(a.number) - Number(b.number)
        : (a.set_release < b.set_release ? -1 : 1));
    for (const c of group) byUid.set(c.uid, sorted);
  }
  return byUid;
})();

// rows for the "pulled from" block: one per set (deluxe's plain + foil copies
// collapse into one row listing both numbers), this print's own set first.
function pulledFrom(card) {
  const prints = SAME_ART.get(card.uid) || [card];
  const rows = new Map();
  for (const p of prints) {
    const key = `${p.set}|${packText(p)}`;
    if (!rows.has(key)) rows.set(key, { set_name: p.set_name, pack: packText(p), numbers: [], current: false });
    const row = rows.get(key);
    row.numbers.push(cardNumber(p));
    if (p.uid === card.uid) row.current = true;
  }
  return [...rows.values()].sort((a, b) => b.current - a.current);
}

// attribute filter groups — second dropdown. options encode as `{group}:{value}`
// strings inside selectedAttrs so a single Set can hold a mix of categories.
// filter logic is AND across groups, OR within each group.
const ATTR_GROUPS = [
  {
    key:   'rarity',
    label: 'rarity',
    options: RARITY_OPTIONS.map(r => ({ value: r, label: `[${r}] ${RARITY_LABELS[r] || r}` })),
  },
  {
    key:   'element',
    label: 'type',
    options: ELEMENT_OPTIONS.map(e => ({ value: e, label: e })),
  },
  {
    key:   'special',
    label: 'tags',
    // ex / mega derived from card.name patterns (no explicit flag in the
    // scraped data). regex tightened in cardMatchesAttrs below.
    options: [
      { value: 'ex',   label: 'ex cards' },
      { value: 'mega', label: 'mega cards' },
    ],
  },
];

// matches a single card against the active attribute filter — AND across
// groups, OR inside each group. caller should short-circuit when the
// attribute set is empty (treat as "no filter").
function cardMatchesAttrs(card, selected) {
  // group selected ids by their category prefix
  const byGroup = new Map();
  for (const id of selected) {
    const idx = id.indexOf(':');
    const g   = id.slice(0, idx);
    const v   = id.slice(idx + 1);
    if (!byGroup.has(g)) byGroup.set(g, new Set());
    byGroup.get(g).add(v);
  }
  for (const [group, values] of byGroup) {
    let match = false;
    if (group === 'rarity')        match = values.has(card.rarity);
    else if (group === 'element')  match = card.element != null && values.has(card.element);
    else if (group === 'special') {
      // "ex" matches names ending with " ex" / " EX"; "mega" matches names
      // starting with "Mega " or "M " (limitless renders mega cards both ways)
      const isEx   = / ex$/i.test(card.name);
      const isMega = /^mega\b/i.test(card.name) || /^m\s+[A-Z]/.test(card.name);
      if (values.has('ex')   && isEx)   match = true;
      if (values.has('mega') && isMega) match = true;
    }
    if (!match) return false;
  }
  return true;
}

// element/cost letter → display word. limitless uses single-letter codes
// inside <span class="ptcg-symbol"> markup (R=fire, W=water, G=grass,
// L=lightning, P=psychic, F=fighting, D=darkness, M=metal, C=colorless,
// Y=fairy — fairy was retired but still appears in some legacy text, N=dragon).
const COST_LETTER = {
  R: 'fire', W: 'water', G: 'grass', L: 'lightning', P: 'psychic',
  F: 'fighting', D: 'darkness', M: 'metal', C: 'colorless', Y: 'fairy', N: 'dragon',
};

// official TCG energy symbols committed under public/assets/energy/<element>.png
// (sourced from bulbagarden archives). letters that map to one of these get the
// real icon; anything else (e.g. "0" free-cost attacks) falls back to text.
// fairy isn't in pocket yet so it has no icon — it'd fall back to text too.
const ENERGY_ICONS = new Set([
  'fire', 'water', 'grass', 'lightning', 'psychic',
  'fighting', 'darkness', 'metal', 'colorless', 'dragon',
]);
const ENERGY_BASE = `${import.meta.env?.BASE_URL || '/'}assets/energy/`;

function EnergyIcon({ element, className }) {
  if (!ENERGY_ICONS.has(element)) return null;
  return (
    <img
      className={className}
      src={`${ENERGY_BASE}${element}.png`}
      alt={element}
      title={element}
      width="18"
      height="18"
    />
  );
}

// group + sort options for the page-level controls. options labels match the
// <option> rendering — keep these arrays as the single source of truth.
const GROUP_OPTIONS = [
  { value: 'set',     label: 'by set' },
  { value: 'rarity',  label: 'by rarity' },
  { value: 'element', label: 'by type' },
  { value: 'none',    label: 'no grouping' },
];

const SORT_OPTIONS = [
  { value: 'number',  label: 'card number' },
  { value: 'name',    label: 'name' },
  { value: 'rarity',  label: 'rarity' },
  { value: 'hp',      label: 'hp' },
];

// partition a flat array of cards into sections according to groupBy.
// sections come back in a stable canonical order per dimension (sets newest
// first, rarity ascending, element following the energy-color sequence).
function groupCards(items, by) {
  if (by === 'none') {
    return [{ slug: 'all', label: null, items }];
  }

  if (by === 'set') {
    const m = new Map();
    for (const c of items) {
      if (!m.has(c.set)) {
        m.set(c.set, { slug: c.set, label: `[${c.set}] ${c.set_name}`, release: c.set_release, items: [] });
      }
      m.get(c.set).items.push(c);
    }
    return [...m.values()].sort((a, b) => b.release.localeCompare(a.release));
  }

  if (by === 'rarity') {
    const m = new Map();
    for (const c of items) {
      if (!m.has(c.rarity)) {
        m.set(c.rarity, {
          slug:  c.rarity,
          label: `[${c.rarity}] ${RARITY_LABELS[c.rarity] || c.rarity}`,
          items: [],
        });
      }
      m.get(c.rarity).items.push(c);
    }
    return RARITY_ORDER.map(r => m.get(r)).filter(Boolean);
  }

  if (by === 'element') {
    const m = new Map();
    const NONE_KEY = '_none';
    for (const c of items) {
      const k = c.element || NONE_KEY;
      if (!m.has(k)) m.set(k, { slug: k, label: c.element || 'no type', items: [] });
      m.get(k).items.push(c);
    }
    const ordered = ELEMENT_ORDER.map(e => m.get(e)).filter(Boolean);
    if (m.has(NONE_KEY)) ordered.push(m.get(NONE_KEY));
    return ordered;
  }

  return [];
}

// sort items inside a single section. base sort always produces canonical
// ascending order (older set first / a→z / common→crown / low→high hp);
// dir==='desc' just reverses. matches the pokedex's filter-panel sort
// semantics so the asc/desc arrow toggle reads predictably.
function sortItems(items, by, dir) {
  const arr = [...items];
  switch (by) {
    case 'number':
      arr.sort((a, b) => {
        const setCmp = (SET_RELEASE.get(a.set) || '').localeCompare(SET_RELEASE.get(b.set) || '');
        if (setCmp !== 0) return setCmp;          // older set first
        return a.number - b.number;
      });
      break;
    case 'name':
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'rarity':
      arr.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
      break;
    case 'hp':
      arr.sort((a, b) => (a.hp ?? -1) - (b.hp ?? -1));   // ascending; null = -1 sinks to bottom
      break;
  }
  return dir === 'desc' ? arr.reverse() : arr;
}

function CardModal({ card, modalRef, onClose, onPrev, onNext, closing, bump, onEchoSelect }) {
  // cycle-pulse on every prev/next via WAAPI — same pattern as the other modals.
  useEffect(() => {
    if (bump.n === 0) return;
    const anim = pulseElement(modalRef.current);
    return () => anim?.cancel();
  }, [bump.n, modalRef]);

  // reset the scroll region to the top whenever the shown card changes (prev/
  // next cycling or picking another print) — otherwise a card scrolled partway
  // down lands the next one mid-content.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [card.uid]);

  const isPokemon = card.card_type === 'pokemon';
  const stageLabel = card.stage === 'basic'
    ? 'Basic'
    : (typeof card.stage === 'number' ? `Stage ${card.stage}` : null);
  // alt prints of this exact card (same function, different art), or null
  const prints = ECHOES.get(card.uid) || null;

  return (
    <div className={`ability-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div ref={modalRef} className="ball-modal tcgp-modal" onClick={e => e.stopPropagation()}>
        {/* only the title bar pins to the top — everything below (hero + stats
            + ability + attacks + flavor + illustrator) is in the scroll
            region. previously the hero was also pinned, which left only ~30%
            of the modal height for the actual card details. */}
        <div className="ball-modal__header">
          <button className="modal-cycle-arrow modal-cycle-arrow--prev" onClick={onPrev} aria-label="previous">‹</button>
          <div className="tcgp-modal__title">
            <h2>{card.name}</h2>
            <span className="tcgp-modal__sub">
              {card.set_name} · {cardNumber(card)}
            </span>
          </div>
          <button className="modal-cycle-arrow modal-cycle-arrow--next" onClick={onNext} aria-label="next">›</button>
        </div>

        <div className="tcgp-modal__scroll" ref={scrollRef}>
          <div className="tcgp-modal__hero">
            {/* newer sets (B3a/B3b onward) don't host the 670px png full — it
                403s and only the 367px webp exists. fall back to that so the
                modal image always renders. */}
            <Img
              src={card.image_full}
              fallbackSrc={card.image_full.replace(/_EN\.png$/, '_EN.webp')}
              alt={card.name}
              loading="eager"
              wrapClassName="tcgp-modal__hero-box"
            />
          </div>

          {/* other prints: functionally-identical cards with different art.
              tap a thumb to view that print's art in place; the active one
              tapped again returns to the card the grid opened. */}
          {prints && (
            <div className="tcgp-prints">
              <div className="tcgp-prints__label">
                other prints · {prints.length} artworks
              </div>
              <div className="tcgp-prints__strip">
                {prints.map((p) => {
                  const active = p.uid === card.uid;
                  const label = `${p.set_name} · ${cardNumber(p)} · ${RARITY_LABELS[p.rarity] || p.rarity}`;
                  return (
                    <button
                      key={p.uid}
                      type="button"
                      className={`tcgp-print${active ? ' tcgp-print--active' : ''}`}
                      onClick={() => { if (!active) onEchoSelect(p); }}
                      title={label}
                      aria-label={label}
                      aria-pressed={active}
                    >
                      <Img src={p.image_url} alt="" loading="lazy" />
                      <span className="tcgp-print__rarity">{p.rarity}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="tcgp-stat-row">
            <span className="tcgp-stat">
              <span className="tcgp-stat__label">rarity</span>
              <span className="tcgp-stat__value">{card.rarity}</span>
            </span>
            {card.hp != null && (
              <span className="tcgp-stat">
                <span className="tcgp-stat__label">hp</span>
                <span className="tcgp-stat__value">{card.hp}</span>
              </span>
            )}
            {card.element && (
              <span className="tcgp-stat">
                <span className="tcgp-stat__label">type</span>
                <span className="tcgp-stat__value tcgp-stat__value--type">
                  <EnergyIcon element={card.element} className="tcgp-energy-icon" />
                  {card.element}
                </span>
              </span>
            )}
            {stageLabel && (
              <span className="tcgp-stat">
                <span className="tcgp-stat__label">stage</span>
                <span className="tcgp-stat__value">{stageLabel}</span>
              </span>
            )}
            {card.evolves_from && (
              <span className="tcgp-stat">
                <span className="tcgp-stat__label">evolves from</span>
                <span className="tcgp-stat__value">{card.evolves_from}</span>
              </span>
            )}
            {card.weakness && (
              <span className="tcgp-stat">
                <span className="tcgp-stat__label">weakness</span>
                <span className="tcgp-stat__value tcgp-stat__value--type">
                  <EnergyIcon element={card.weakness} className="tcgp-energy-icon" />
                  {card.weakness}
                </span>
              </span>
            )}
            {card.retreat != null && (
              <span className="tcgp-stat">
                <span className="tcgp-stat__label">retreat</span>
                <span className="tcgp-stat__value">{card.retreat}</span>
              </span>
            )}
          </div>

          {/* where this art can be pulled: its own set/pack, plus straight
              reprints elsewhere (e.g. a genetic apex card also in a deluxe pack) */}
          {(() => {
            const rows = pulledFrom(card);
            const multi = rows.length > 1 || rows[0].numbers.length > 1;
            return (
              <div className="tcgp-packs">
                <span className="tcgp-packs__label">pulled from</span>
                <ul className="tcgp-packs__list">
                  {rows.map((r) => (
                    <li key={`${r.set_name}|${r.pack}`} className="tcgp-packs__row">
                      <span className="tcgp-packs__set">{r.set_name}</span>
                      {r.pack && <span className="tcgp-packs__pack">{r.pack}</span>}
                      {multi && <span className="tcgp-packs__num">{r.numbers.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {card.ability && (
            <div className="tcgp-ability">
              <span className="tcgp-ability__name">{card.ability.name}</span>
              {card.ability.effect && <p className="tcgp-ability__effect">{card.ability.effect}</p>}
            </div>
          )}

          {card.attacks?.length > 0 && (
            <div className="tcgp-attacks">
              {card.attacks.map((a, i) => (
                <div key={i} className="tcgp-attack">
                  <div className="tcgp-attack__row">
                    <span className="tcgp-attack__cost">
                      {a.cost.map((letter, j) => {
                        const el = COST_LETTER[letter];
                        return ENERGY_ICONS.has(el)
                          ? <EnergyIcon key={j} element={el} className="tcgp-energy-icon" />
                          : <span key={j} className="tcgp-energy">{letter}</span>;
                      })}
                    </span>
                    <span className="tcgp-attack__name">{a.name}</span>
                    {a.damage && <span className="tcgp-attack__damage">{a.damage}</span>}
                  </div>
                  {a.effect && <p className="tcgp-attack__effect">{a.effect}</p>}
                </div>
              ))}
            </div>
          )}

          {card.flavor_text && <p className="tcgp-flavor">{card.flavor_text}</p>}

          {card.illustrator && <p className="tcgp-illustrator">illus. {card.illustrator}</p>}
        </div>
      </div>
    </div>
  );
}

// reference key shown as a modal (rather than an inline dropdown — the page
// already has enough dropdowns). decodes rarity codes, names energy types, and
// lays out the prize-point rules.
function KeyModal({ onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="ability-modal-overlay" onClick={onClose}>
      <div className="ball-modal tcgp-key-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tcgp-key-modal__header">
          <h2>key</h2>
          <button type="button" className="tcgp-key-modal__close" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="tcgp-key-modal__body">
          <section className="tcgp-key__group">
            <h3 className="tcgp-key__heading">rarities</h3>
            <ul className="tcgp-key__list">
              {RARITY_ORDER.map((r) => (
                <li key={r} className="tcgp-key__item">
                  <span className="tcgp-key__code">{r}</span>
                  <span className="tcgp-key__name">{RARITY_LABELS[r]}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="tcgp-key__group">
            <h3 className="tcgp-key__heading">energy types</h3>
            <ul className="tcgp-key__list">
              {ELEMENT_ORDER.filter((el) => ENERGY_ICONS.has(el)).map((el) => (
                <li key={el} className="tcgp-key__item">
                  <EnergyIcon element={el} className="tcgp-energy-icon" />
                  <span className="tcgp-key__name">{el}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function TCGPocketPage() {
  // selectedSets empty = default progressive mode (newest set + "show previous"
  //                       button to walk older sets in one at a time)
  // selectedSets has codes = explicit filter to those sets only
  // selectedAttrs filters items WITHIN the visible sections — applied on top
  // of whichever set scope is active.
  const [selectedSets, setSelectedSets]   = useState(() => new Set());
  const [selectedAttrs, setSelectedAttrs] = useState(() => new Set());
  const [groupBy, setGroupBy]             = useState('set');
  const [sortBy, setSortBy]               = useState('number');
  // sort direction matches the pokedex filter-panel — asc = canonical order
  // (older set first / a→z / common→crown / low hp → high hp); desc reverses.
  const [sortDir, setSortDir]             = useState('desc');
  const [loadedCount, setLoadedCount]     = useState(1);
  // card-name text search, scoped to this page (distinct from the global site
  // search in the header). filters by name substring across all sets.
  const [cardSearch, setCardSearch]       = useState('');
  // debounced copy that actually drives filtering (see the effect below).
  const [searchQuery, setSearchQuery]     = useState('');
  const [keyOpen, setKeyOpen]             = useState(false);
  const [openDropdown, setOpenDropdown]   = useState(null);  // 'sets' | 'attrs' | null
  const setsRef  = useRef(null);
  const attrsRef = useRef(null);

  const isSetFiltered  = selectedSets.size  > 0;
  const isAttrFiltered = selectedAttrs.size > 0;

  // debounce the card search: without it, each intermediate keystroke
  // (r → ra → rai…) renders its broad match set and fires a thumbnail request
  // per card — typing "raichu" spawned ~150 cdn requests for ~14 real matches,
  // clogging the connection pool so the actual results loaded last. now only
  // the settled query filters.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(cardSearch), 220);
    return () => clearTimeout(t);
  }, [cardSearch]);

  const visibleSections = useMemo(() => {
    // 1. flatten through filters
    let pool = cards;
    const q = searchQuery.trim().toLowerCase();
    if (q)              pool = pool.filter(c => c.name.toLowerCase().includes(q));
    if (isSetFiltered)  pool = pool.filter(c => selectedSets.has(c.set));
    if (isAttrFiltered) pool = pool.filter(c => cardMatchesAttrs(c, selectedAttrs));

    // 2. group + sort within group
    let sections = groupCards(pool, groupBy);
    sections = sections.map(s => ({ ...s, items: sortItems(s.items, sortBy, sortDir) }));

    // 3. progressive disclosure only kicks in for the default set-grouped
    //    view with no explicit set filter. any other group dimension —
    //    rarity, element, none — shows everything that survives the filters.
    if (groupBy === 'set' && !isSetFiltered && !q) {
      sections = sections.slice(0, loadedCount);
    }

    return sections;
  }, [isSetFiltered, selectedSets, isAttrFiltered, selectedAttrs, groupBy, sortBy, sortDir, loadedCount, searchQuery]);

  const visibleCardCount = useMemo(
    () => visibleSections.reduce((n, s) => n + s.items.length, 0),
    [visibleSections],
  );

  // "show previous set" button only meaningful in the default set-grouped
  // mode (no set filter). attribute filter is independent of this — it just
  // narrows items inside whichever sets are loaded.
  const canShowPrevious = groupBy === 'set'
    && !isSetFiltered
    && loadedCount < SECTIONED_CARDS.length;
  const nextOlderSet    = canShowPrevious ? SECTIONED_CARDS[loadedCount] : null;

  // cross-page modal auto-open: consume location.state.openId on first
  // render (same handshake badges + gym-leaders use). lets the global
  // search jump straight to a card's modal without per-card routes.
  const location = useLocation();
  const navigate = useNavigate();
  const initialOpenId = location.state?.openId ?? null;
  const { current: currentCard, bump, modalRef, open, close, prev, next } =
    useModalCycleNav(visibleSections, initialOpenId);
  const { displayed: shownCard, isClosing } = useModalAnimation(currentCard);

  // alt-print override: when a print is picked from the modal's "other prints"
  // strip, show it in place of the grid card. resets whenever the underlying
  // grid card changes (open / prev / next / close) so the strip stays in sync.
  const [echoCard, setEchoCard] = useState(null);
  useEffect(() => { setEchoCard(null); }, [currentCard]);
  const displayCard = echoCard || shownCard;

  useEffect(() => {
    if (!initialOpenId) return;
    navigate(location.pathname, { replace: true, state: null });
    const mode = getString(STORAGE_KEYS.XFADE_MODE, 'snap');
    if (mode !== 'view') {
      setTimeout(() => { if (modalRef.current) pulseElement(modalRef.current); }, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close whichever dropdown is open on outside-click or Esc — same pattern
  // as the burger / visuals dropdowns in app.jsx. uses openDropdown to know
  // which ref to test against.
  useEffect(() => {
    if (!openDropdown) return;
    const ref = openDropdown === 'sets' ? setsRef : attrsRef;
    const onMouse = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpenDropdown(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenDropdown(null); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [openDropdown]);

  // ── set filter helpers ───────────────────────────────────────────
  const toggleSet = (slug) => {
    setSelectedSets(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
    setLoadedCount(1);
  };
  const selectAllSets = () => {
    setSelectedSets(new Set(SECTIONED_CARDS.map(s => s.slug)));
    setLoadedCount(1);
  };
  const clearSets = () => {
    setSelectedSets(new Set());
    setLoadedCount(1);
  };

  // ── attribute filter helpers ─────────────────────────────────────
  const toggleAttr = (group, value) => {
    setSelectedAttrs(prev => {
      const next = new Set(prev);
      const id   = `${group}:${value}`;
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearAttrs = () => setSelectedAttrs(new Set());

  // ── reset everything to defaults ─────────────────────────────────
  // true when any filter / group / sort differs from the page's initial
  // state — drives both the reset button's visibility and what it undoes.
  const isNonDefault =
    isSetFiltered || isAttrFiltered || cardSearch.trim() !== '' ||
    groupBy !== 'set' || sortBy !== 'number' || sortDir !== 'desc';
  const resetAll = () => {
    setSelectedSets(new Set());
    setSelectedAttrs(new Set());
    setCardSearch('');
    setGroupBy('set');
    setSortBy('number');
    setSortDir('desc');
    setLoadedCount(1);
    setOpenDropdown(null);
  };

  // ── dropdown summary labels ──────────────────────────────────────
  const setsTriggerLabel = (() => {
    if (selectedSets.size === 0) return 'all sets · newest first';
    if (selectedSets.size === 1) {
      const only = SECTIONED_CARDS.find(s => selectedSets.has(s.slug));
      return only?.label ?? '';
    }
    if (selectedSets.size === SECTIONED_CARDS.length) return 'all sets · selected';
    return `${selectedSets.size} sets selected`;
  })();

  const attrsTriggerLabel = (() => {
    if (selectedAttrs.size === 0) return 'any';
    if (selectedAttrs.size === 1) {
      const [first] = selectedAttrs;
      const idx = first.indexOf(':');
      const g   = first.slice(0, idx);
      const v   = first.slice(idx + 1);
      const grp = ATTR_GROUPS.find(gp => gp.key === g);
      const opt = grp?.options.find(o => o.value === v);
      return opt?.label || v;
    }
    return `${selectedAttrs.size} selected`;
  })();

  return (
    <div className="items-page">
      <p className="items-page__sub">
        {visibleCardCount} cards
        {groupBy === 'set' && !isSetFiltered && !searchQuery.trim() && loadedCount < SECTIONED_CARDS.length
          && ` (showing ${loadedCount} of ${SECTIONED_CARDS.length} sets)`}
        {isNonDefault && (
          <button type="button" className="tcgp-reset" onClick={resetAll}>
            reset filters
          </button>
        )}
      </p>

      <input
        type="text"
        className="tcgp-search"
        placeholder="search cards by name…"
        value={cardSearch}
        onChange={(e) => setCardSearch(e.target.value)}
        aria-label="search cards by name"
      />

      <div className="tcgp-filters">
        {/* layout: left column = set filter / attribute filter (stacked).
            right column = group / sort (stacked). JSX order matches the
            grid's column-first auto-flow so the two filters fill column 1
            and the two controls fill column 2. */}
        <div className="tcgp-filter" ref={setsRef}>
          <span className="tcgp-control__label">filter by set</span>
          <button
            type="button"
            className={`tcgp-filter__trigger${openDropdown === 'sets' ? ' is-open' : ''}`}
            onClick={() => setOpenDropdown(o => o === 'sets' ? null : 'sets')}
            aria-expanded={openDropdown === 'sets'}
            aria-haspopup="listbox"
          >
            <span className="tcgp-filter__current">{setsTriggerLabel}</span>
            <span className="tcgp-filter__chevron" aria-hidden="true">▾</span>
          </button>

          {openDropdown === 'sets' && (
            <div className="tcgp-filter__panel" role="listbox" aria-multiselectable="true">
              <div className="tcgp-filter__actions">
                <button type="button" className="tcgp-filter__action" onClick={selectAllSets}>select all</button>
                <button type="button" className="tcgp-filter__action" onClick={clearSets}>clear</button>
              </div>
              {SECTIONED_CARDS.map(section => {
                const checked = selectedSets.has(section.slug);
                return (
                  <label
                    key={section.slug}
                    className={`tcgp-filter__option${checked ? ' is-checked' : ''}`}
                    role="option"
                    aria-selected={checked}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleSet(section.slug)} />
                    <span className="tcgp-filter__option-label">{section.label}</span>
                    <span className="tcgp-filter__option-count">{section.items.length}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* attribute filter — rarity / type / tags. multi-select with grouped sections. */}
        <div className="tcgp-filter" ref={attrsRef}>
          <span className="tcgp-control__label">filter by attribute</span>
          <button
            type="button"
            className={`tcgp-filter__trigger${openDropdown === 'attrs' ? ' is-open' : ''}`}
            onClick={() => setOpenDropdown(o => o === 'attrs' ? null : 'attrs')}
            aria-expanded={openDropdown === 'attrs'}
            aria-haspopup="listbox"
          >
            <span className="tcgp-filter__current">{attrsTriggerLabel}</span>
            <span className="tcgp-filter__chevron" aria-hidden="true">▾</span>
          </button>

          {openDropdown === 'attrs' && (
            <div className="tcgp-filter__panel" role="listbox" aria-multiselectable="true">
              <div className="tcgp-filter__actions">
                <button type="button" className="tcgp-filter__action" onClick={clearAttrs}>clear</button>
              </div>
              {ATTR_GROUPS.map(group => (
                <div key={group.key} className="tcgp-filter__group">
                  <div className="tcgp-filter__group-label">{group.label}</div>
                  {group.options.map(opt => {
                    const id      = `${group.key}:${opt.value}`;
                    const checked = selectedAttrs.has(id);
                    return (
                      <label
                        key={id}
                        className={`tcgp-filter__option${checked ? ' is-checked' : ''}`}
                        role="option"
                        aria-selected={checked}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleAttr(group.key, opt.value)} />
                        <span className="tcgp-filter__option-label">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* group + sort controls — single-select natives. right column of
            the filters grid: group on top, sort below. */}
        <label className="tcgp-control">
          <span className="tcgp-control__label">group</span>
          <select
            className="tcgp-control__select"
            value={groupBy}
            onChange={e => { setGroupBy(e.target.value); setLoadedCount(1); }}
          >
            {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="tcgp-control tcgp-control--sort">
          <span className="tcgp-control__label">sort</span>
          <div className="tcgp-control__sort-wrap">
            <select
              className="tcgp-control__select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              type="button"
              className="tcgp-control__sort-arrow"
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              aria-label={`sort ${sortDir === 'asc' ? 'ascending — tap to switch to descending' : 'descending — tap to switch to ascending'}`}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </label>
      </div>

      <button type="button" className="tcgp-key-btn" onClick={() => setKeyOpen(true)}>
        <span className="tcgp-key-btn__glyph" aria-hidden="true">?</span>
        key
      </button>

      {visibleSections.map((section, sectionIdx) => (
        <div key={section.slug} id={`tcgp-section-${section.slug}`} className="items-section">
          {section.label && <h2 className="items-section__label">{section.label}</h2>}
          <div className="tcgp-grid">
            {section.items.map((c, index) => (
              <button
                key={c.uid}
                className="tcgp-card-thumb"
                onClick={(e) => {
                  const t = e.currentTarget;
                  pulseElement(t, { scale: 1.05, duration: 220, offset: 0.3 });
                  setTimeout(() => open(sectionIdx, index), 70);
                }}
              >
                <Img src={c.image_url} alt={c.name} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}

      {canShowPrevious && (
        <button
          className="load-more-btn"
          onClick={() => setLoadedCount(c => c + 1)}
        >
          show previous set ({nextOlderSet.label})
        </button>
      )}

      {/* hidden while a card modal is open so it doesn't sit over the backdrop */}
      {!shownCard && <TcgpJumpNav sections={visibleSections} />}

      {shownCard && (
        <CardModal
          card={displayCard}
          modalRef={modalRef}
          onClose={close}
          onPrev={prev}
          onNext={next}
          closing={isClosing}
          bump={bump}
          onEchoSelect={setEchoCard}
        />
      )}

      {keyOpen && <KeyModal onClose={() => setKeyOpen(false)} />}
    </div>
  );
}
