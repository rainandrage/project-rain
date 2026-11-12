// site-wide search across pokemon, abilities, moves, gym leaders, types,
// tcg pocket cards, berries, pokeballs. each source is statically imported
// (already bundled, no extra round-trips). matching is intentionally simple:
// case-insensitive substring against display name + japanese name + romaji,
// plus dex# for pokemon. results are grouped by entity type with a per-
// group cap so the dropdown stays scannable.

import pokemonData from '../data/pokemon.json';
import abilitiesData from '../data/abilities.json';
import movesData from '../data/moves.json';
import gymLeadersData from '../data/gym-leaders.json';
import typesData from '../data/types.json';
import tcgPocketData from '../data/tcg-pocket.json';
import berriesData from '../data/berries.json';
import pokeballsData from '../data/pokeballs.json';
import { formatName, formatFormName, formatSlug } from './format-name';
import { EXCLUDED_FORMS } from './api';

const PER_GROUP_LIMIT = 5;

// ─── per-entity indexes (flat arrays of { displayName, slug/id, subtitle,
// searchHaystack, route, type }) — built once at module load. each entry's
// searchHaystack is the pre-lowercased blob we match against so we don't
// re-lowercase per-keystroke.

// haystacks intentionally exclude name_jp / romaji while the rest of the UI
// is english-only — matching against the JP fields surfaced confusing hits
// for users who couldn't see why a result came back (e.g. typing latin
// letters that happened to substring an unrelated mon's romaji). re-add
// those fields when a JP-display toggle ships.
const pokemonIndex = (() => {
  const out = [];
  for (const p of pokemonData) {
    const display = formatName(p.name);
    const haystack = [
      p.name, display,
      String(p.id), String(p.id).padStart(3, '0'),
    ].join('|').toLowerCase();
    out.push({
      type: 'pokemon',
      id: p.id,
      slug: p.name,
      displayName: display,
      subtitle: `#${String(p.id).padStart(3, '0')}`,
      route: `/pokemon/${p.id}`,
      sprite: p.sprite_url,
      haystack,
    });
    if (p.form_data) {
      for (const formSlug of Object.keys(p.form_data)) {
        if (formSlug === p.name || EXCLUDED_FORMS.has(formSlug)) continue; // dropped from the dex (api.js)
        const fDisplay = formatFormName(formSlug);
        out.push({
          type: 'pokemon',
          id: p.id,
          slug: formSlug,
          displayName: fDisplay,
          subtitle: `#${String(p.id).padStart(3, '0')} · form`,
          route: `/pokemon/${p.id}?form=${formSlug}`,
          sprite: p.form_data[formSlug]?.sprite_url || p.sprite_url,
          haystack: [formSlug, fDisplay].join('|').toLowerCase(),
        });
      }
    }
  }
  return out;
})();

const abilityIndex = Object.entries(abilitiesData).map(([slug, a]) => ({
  type: 'ability',
  slug,
  displayName: formatSlug(slug),
  subtitle: a.effect ? truncate(a.effect, 60) : 'ability',
  route: `/pokedex?ability=${encodeURIComponent(slug)}`,
  haystack: [slug, formatSlug(slug)].join('|').toLowerCase(),
}));

const moveIndex = movesData.map((m) => ({
  type: 'move',
  slug: m.name,
  displayName: formatSlug(m.name),
  subtitle: `${m.type} · ${m.damage_class || 'status'}`,
  route: `/moves?q=${encodeURIComponent(m.name)}`,
  haystack: [m.name, formatSlug(m.name), m.type].join('|').toLowerCase(),
}));

// leaders + cards open the matched item's modal on arrival via state.openId
// (same handshake the badges + gym-leaders pages already use for cross-page
// modal nav). routeState is consumed by GlobalSearch and passed to
// navigate(..., { state }).
const leaderIndex = gymLeadersData.map((l) => ({
  type: 'leader',
  slug: l.id,
  displayName: formatSlug(l.name),
  subtitle: `${l.region_label || l.region} · ${l.type}`,
  route: '/leaders',
  routeState: { openId: l.id },
  sprite: l.sprite,
  haystack: [l.name, l.id, l.region, l.city || ''].join('|').toLowerCase(),
}));

const typeIndex = Object.entries(typesData).map(([slug]) => ({
  type: 'type',
  slug,
  displayName: formatSlug(slug),
  subtitle: 'type',
  route: `/pokedex?type=${encodeURIComponent(slug)}`,
  haystack: slug.toLowerCase(),
}));

const cardIndex = tcgPocketData.map((c) => ({
  type: 'card',
  slug: c.uid,
  displayName: c.name,
  subtitle: `${c.set} · ${c.rarity}${c.element ? ` · ${c.element}` : ''}`,
  route: '/tcgp',
  routeState: { openId: c.uid },
  haystack: [c.name, c.uid, c.set, c.set_name, c.element || '', c.rarity].join('|').toLowerCase(),
}));

// berries + pokeballs land on their item page with the matched modal auto-
// opened (same state.openId handshake as leaders / cards). routeState.openId
// matches the numeric id useModalCycleNav uses internally to seed selection.
const berryIndex = berriesData.map((b) => ({
  type: 'berry',
  slug: b.name,
  displayName: formatSlug(b.item_name || `${b.name}-berry`),
  subtitle: `berry · ${b.natural_gift_type || ''}`,
  route: '/berries',
  routeState: { openId: b.id },
  sprite: b.sprite,
  haystack: [b.name, b.item_name || ''].join('|').toLowerCase(),
}));

const pokeballIndex = pokeballsData.map((b) => ({
  type: 'pokeball',
  slug: b.name,
  displayName: formatSlug(b.name),
  subtitle: 'pokeball',
  route: '/pokeballs',
  routeState: { openId: b.id },
  sprite: b.sprite,
  haystack: b.name.toLowerCase(),
}));

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// rank entries by match quality: exact match > startsWith > contains.
// stable sort preserves data order within each tier so e.g. pokemon stay
// roughly dex-order when scores tie.
function scoreEntry(entry, q) {
  const h = entry.haystack;
  if (!h.includes(q)) return -1;
  const name = entry.displayName.toLowerCase();
  const slug = entry.slug.toString().toLowerCase();
  if (name === q || slug === q) return 100;
  if (name.startsWith(q) || slug.startsWith(q)) return 70;
  if (h.startsWith(q)) return 50;
  return 20;
}

function searchIndex(index, q, limit) {
  const scored = [];
  for (const entry of index) {
    const s = scoreEntry(entry, q);
    if (s > 0) scored.push({ entry, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.entry);
}

// limit defaults to the small dropdown cap so the header search stays
// scannable. the full results page passes a larger number (or Infinity) to
// show every match in each category.
export function searchAll(query, { limit = PER_GROUP_LIMIT } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 1) return [];
  return [
    { type: 'pokemon',  label: 'pokemon',     results: searchIndex(pokemonIndex,  q, limit) },
    { type: 'ability',  label: 'abilities',   results: searchIndex(abilityIndex,  q, limit) },
    { type: 'move',     label: 'moves',       results: searchIndex(moveIndex,     q, limit) },
    { type: 'leader',   label: 'gym leaders', results: searchIndex(leaderIndex,   q, limit) },
    { type: 'type',     label: 'types',       results: searchIndex(typeIndex,     q, limit) },
    { type: 'card',     label: 'cards',       results: searchIndex(cardIndex,     q, limit) },
    { type: 'berry',    label: 'berries',     results: searchIndex(berryIndex,    q, limit) },
    { type: 'pokeball', label: 'pokéballs',   results: searchIndex(pokeballIndex, q, limit) },
  ].filter((g) => g.results.length > 0);
}
