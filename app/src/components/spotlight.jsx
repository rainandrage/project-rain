// ─── Spotlight ───────────────────────────────────────────────────────────────
//
// daily-rotating spotlight on the news page. pick is deterministic per
// LOCAL calendar day — universal pick given a date string, but each
// visitor's "today" is computed in their own timezone via local Date
// getters. result: a Japan visitor sees their May-31 pick (universally
// shared with anyone else on May 31 locally) before a US visitor on the
// same UTC moment but still on May 30. each visitor still sees their own
// today consistently.
//
// pool is base-species ids 1..N (forms collapsed under their base species).
// data fetched via getPokemonById so flavor text + genus + jp/romaji are
// all there.
//
// cry audio: see components/cry-button.jsx.
//
// layout (2026-11 redesign): a compact always-open card — kicker, name +
// cry button, "#id · types · gen · region", artwork on the right. the old
// collapsible card (and its per-day minimize state) is gone.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CryButton from './cry-button';
import ALL from '../data/pokemon.json';
import { getPokemonById } from '../utils/api';
import { formatName } from '../utils/format-name';

const POOL = ALL.filter(p => p.id <= 1025).map(p => p.id);

// gen → region. nothing else in the app needs this mapping (region maps
// page is still a deferred TODO), so it lives locally rather than as a
// shared util. update if a new gen ever ships.
const GEN_TO_REGION = {
  1: 'kanto',
  2: 'johto',
  3: 'hoenn',
  4: 'sinnoh',
  5: 'unova',
  6: 'kalos',
  7: 'alola',
  8: 'galar',
  9: 'paldea',
};

// region overrides for species whose native region differs from their
// generation's default. PokeAPI tags PLA-introduced species as gen 8
// (Switch / SwSh release era) but their native region is Hisui (ancient
// Sinnoh), not Galar. keyed by the stored species name in pokemon.json.
const REGION_OVERRIDES = {
  'wyrdeer':            'hisui',
  'kleavor':            'hisui',
  'ursaluna':           'hisui',
  'basculegion-male':   'hisui',
  'sneasler':           'hisui',
  'overqwil':           'hisui',
  'enamorus-incarnate': 'hisui',
};

// djb2 hash + a murmur3 fmix32 avalanche → non-negative 32-bit int.
// deterministic per date string (so the pick is universal for a given day).
//
// the avalanche is the important part: consecutive day strings differ only
// in the final character ("…-02" → "…-03"), and plain djb2 maps those to
// hashes differing by *exactly 1*, so `% POOL.length` returned ADJACENT
// pokédex ids on consecutive days — that's why cosmog/solgaleo/lunala
// (789/791/792) showed up back-to-back. fmix32 scrambles near-identical
// seeds into unrelated buckets so consecutive days look unrelated.
function hashDate(yyyy_mm_dd) {
  let h = 5381;
  for (let i = 0; i < yyyy_mm_dd.length; i++) {
    h = ((h << 5) + h) + yyyy_mm_dd.charCodeAt(i);
    h |= 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// local date as YYYY-MM-DD — the seed input for today's pick.
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pickTodayId(dateKey) {
  return POOL[hashDate(dateKey) % POOL.length];
}

export default function Spotlight() {
  const dateKey     = useMemo(todayKey, []);
  const todayId     = useMemo(() => pickTodayId(dateKey), [dateKey]);

  const [pokemon, setPokemon] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPokemonById(todayId)
      .then(p => { if (!cancelled) setPokemon(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [todayId]);

  if (!pokemon) return null;

  const artwork     = pokemon.home_url || pokemon.artwork_url || pokemon.sprite_url;
  const displayName = formatName(pokemon.name);
  const region      = REGION_OVERRIDES[pokemon.name] || GEN_TO_REGION[pokemon.generation];
  const originText  = pokemon.generation
    ? `gen ${pokemon.generation}${region ? ` · ${region}` : ''}`
    : null;

  const typesText = pokemon.types?.join(' / ');
  const meta = [`#${String(pokemon.id).padStart(3, '0')}`, typesText, originText].filter(Boolean).join(' · ');

  // compact card (2026-11 redesign): kicker · name (+ cry) · meta, artwork on
  // the right. the name is a stretched link, so the whole card opens the
  // pokémon's page; the cry button sits above that link layer.
  return (
    <article className="spotlight-card">
      <div className="spotlight-card__info">
        <span className="spotlight-card__kicker">today's spotlight</span>
        <div className="spotlight-card__name-row">
          <Link to={`/pokemon/${pokemon.id}`} className="spotlight-card__name">
            {displayName}
          </Link>
          <CryButton key={pokemon.id} id={pokemon.id} slug={pokemon.name} name={displayName} className="spotlight-card__cry" />
        </div>
        <span className="spotlight-card__meta">{meta}</span>
      </div>
      {artwork && (
        <img src={artwork} alt="" className="spotlight-card__art" loading="lazy" />
      )}
    </article>
  );
}
