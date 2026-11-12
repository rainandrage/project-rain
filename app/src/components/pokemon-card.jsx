import { Link, useLocation, useNavigate } from 'react-router-dom';
import { keyPress } from '../utils/pulse';
import { formatName, formatFormName } from '../utils/format-name';
import { useRetroSprites } from '../hooks/use-retro-sprites';
import { getRetroPng, getRetroCredit, cleanRetroCredit, displaySourceLabel } from '../utils/retro-sprite';
import Img from './img';

// single card in the grid — links to detail page
const STAT_SORTS = new Set(['total', 'hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed']);

function getStatValue(stats, sort) {
  if (!stats || !STAT_SORTS.has(sort)) return null;
  if (sort === 'total') return stats.reduce((sum, s) => sum + s.base_value, 0);
  return stats.find(s => s.stat_name === sort)?.base_value ?? null;
}

export default function PokemonCard({ pokemon, shiny, sort }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { retro } = useRetroSprites();
  const padId = String(pokemon.id).padStart(3, '0');
  const types = Array.isArray(pokemon.types) ? pokemon.types : [];

  // primary slug = form if present, else species. fallback = species
  // (so non-canon mega forms not on showdown still render something).
  const primarySlug = pokemon.form || pokemon.name;
  const speciesSlug = pokemon.name;

  const officialImage = shiny
    ? (pokemon.artwork_shiny || pokemon.sprite_shiny || pokemon.artwork_url || pokemon.sprite_url)
    : (pokemon.artwork_url || pokemon.sprite_url);

  // retro mode: shows the curated gen-2 sprite for THIS slug only — no
  // species fallback. previously mega-x's card showed base charizard's
  // pixel art when no mega-x retro was curated, which mislabeled what
  // the user was looking at. when this slug has no retro, the card falls
  // back to its own official artwork so the grid stays visually filled.
  const retroPng = retro ? getRetroPng(primarySlug, { shiny }) : null;
  const retroAvailable = !!retroPng;
  const retroCredit = retroAvailable ? getRetroCredit(primarySlug) : null;
  // native browser tooltip on hover — non-intrusive, zero CSS cost.
  // matches the detail-page byline format (shared cleanRetroCredit helper).
  const retroTooltip = retroCredit
    ? (() => {
        const lbl = displaySourceLabel(retroCredit);
        return `[art by ${cleanRetroCredit(retroCredit.artist)}${lbl ? ` · ${lbl}` : ''}]`;
      })()
    : undefined;

  const statValue = getStatValue(pokemon.stats, sort);

  const linkTo = pokemon.form
    ? `/pokemon/${pokemon.id}?form=${pokemon.form}`
    : `/pokemon/${pokemon.id}`;

  return (
    <div className={`pokemon-card${retro ? ' is-retro' : ''}${retro && !retroAvailable ? ' is-retro-missing' : ''}`}>
      <Link
        to={linkTo}
        state={{ from: location.pathname + location.search }}
        className="card-link press-js"
        // touch: the whole card presses like a key, then opens (keyPress)
        {...keyPress(
          () => navigate(linkTo, { state: { from: location.pathname + location.search } }),
          { target: (el) => el.closest('.pokemon-card') },
        )}
      >
        <div className="card-header">
          <span className="pokemon-id">#{padId}</span>
          {statValue !== null && <span className="pokemon-stat-badge">{statValue}</span>}
        </div>
        {retroAvailable ? (
          <Img
            src={retroPng}
            alt={pokemon.name}
            title={retroTooltip}
            className="pokemon-sprite pokemon-sprite--retro"
            loading="lazy"
          />
        ) : (
          <Img src={officialImage} alt={pokemon.name} className="pokemon-sprite" loading="lazy" />
        )}
        <h3 className="pokemon-name">{pokemon.form ? formatFormName(pokemon.form) : formatName(pokemon.name)}</h3>
        <div className="pokemon-types">
          {types.map(t => (
            <span key={t} className={`type-badge type-${t}`}>{t}</span>
          ))}
        </div>
      </Link>
    </div>
  );
}
