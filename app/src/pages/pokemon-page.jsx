import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { formatName, formatFormName, formatSlug } from '../utils/format-name';
import { usePokemonDetail } from '../hooks/use-pokemon';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { NAME_TO_ID, FORM_DATA, FORM_TO_BASE_ID, EXCLUDED_FORMS, getBaseFormLabel, FORM_SUFFIX_SPECIES, getOrderedIds } from '../utils/api';
import { STAT_LABELS_FULL as STAT_LABELS, EV_STAT_LABELS } from '../utils/stats';
import { defensiveMatchups, MATCHUP_ORDER } from '../utils/type-chart';
import { pulseElement } from '../utils/pulse';
import AbilityModal from '../components/ability-modal';
import CryButton from '../components/cry-button';
import { useRetroSprites } from '../hooks/use-retro-sprites';
import { useSpritesReady } from '../hooks/use-sprites-ready';
import { getRetroGif, getRetroPng, getRetroCredit, cleanRetroCredit, displaySourceLabel } from '../utils/retro-sprite';
import Img from '../components/img';
import SpriteModal from '../components/sprite-modal';

// returns a tier class for stat bar color
function statTier(val) {
  if (val >= 100) return 'high';
  if (val >= 60)  return 'mid';
  return 'low';
}

// single animated stat row
function StatRow({ stat }) {
  const pct = Math.round((stat.base_value / 255) * 100);
  return (
    <div className="stat-row">
      <span className="stat-label">{STAT_LABELS[stat.stat_name] || stat.stat_name}</span>
      <span className="stat-value">{stat.base_value}</span>
      <div className="stat-track">
        <div className={`stat-fill ${statTier(stat.base_value)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// shiny indicator — three four-pointed sparkles arranged like the
// official pokemon shiny icon (one large bottom-left, one medium top-
// right, one small top-center). renders in currentColor so it inherits
// the parent pill's foreground (used for both the gold-on-dark and
// dark-on-gold variants depending on theme).
function ShinySparkle({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* large star, bottom-left */}
      <path d="M38 38 L46 60 L66 68 L46 76 L38 98 L30 76 L10 68 L30 60 Z" />
      {/* medium star, top-right */}
      <path d="M76 20 L81 34 L94 39 L81 44 L76 58 L71 44 L58 39 L71 34 Z" />
      {/* small star, top-center */}
      <path d="M52 2 L55 11 L64 14 L55 17 L52 26 L49 17 L40 14 L49 11 Z" />
    </svg>
  );
}

function GenderDisplay({ rate }) {
  if (rate == null) return <span className="meta-value">—</span>;
  if (rate === -1)  return <span className="meta-value">—</span>;
  const femalePct = (rate / 8) * 100;
  const malePct   = 100 - femalePct;
  const fmt = n => n % 1 === 0 ? `${n}%` : `${n.toFixed(1)}%`;
  return (
    <span className="gender-display">
      {malePct > 0   && <span className="gender-m">♂ {fmt(malePct)}</span>}
      {malePct > 0 && femalePct > 0 && <span className="gender-sep">|</span>}
      {femalePct > 0 && <span className="gender-f">♀ {fmt(femalePct)}</span>}
    </span>
  );
}

// horizontal ratio bar — shown under the sprite-row when the species has
// a meaningful gender split (rate ≠ -1 and ≠ 0 and ≠ 8). reinforces the
// 2-column M/F sprite layout above. for single-gender mons (rate 0 or
// rate 8) the bar collapses to a single-color "100%" pill so the section
// still communicates the gender identity without faking a 0% segment.
function GenderRatioBar({ rate }) {
  if (rate == null || rate === -1) return null;
  const femalePct = (rate / 8) * 100;
  const malePct   = 100 - femalePct;
  const fmt = n => n % 1 === 0 ? `${n}%` : `${n.toFixed(1)}%`;
  // a11y bar fills with whichever gender leads (light blue for male,
  // light pink for female); ties fall back to male. modifier class
  // drives the css — css can't compare flex-basis values directly.
  const femaleLead = femalePct > malePct;
  return (
    <div className="gender-ratio">
      <div
        className={`gender-ratio__bar${femaleLead ? ' gender-ratio__bar--female-lead' : ''}`}
        role="img"
        aria-label={`gender ratio: ${fmt(malePct)} male, ${fmt(femalePct)} female`}
      >
        {malePct > 0 && <div className="gender-ratio__male"   style={{ flexBasis: `${malePct}%`   }} />}
        {femalePct > 0 && <div className="gender-ratio__female" style={{ flexBasis: `${femalePct}%` }} />}
      </div>
      <div className="gender-ratio__labels">
        {malePct > 0 && (
          <span className="gender-ratio__label gender-ratio__label--m" style={{ flexBasis: `${malePct}%` }}>
            <span className="gender-ratio__sym">♂</span> {fmt(malePct)}
          </span>
        )}
        {femalePct > 0 && (
          <span className="gender-ratio__label gender-ratio__label--f" style={{ flexBasis: `${femalePct}%` }}>
            <span className="gender-ratio__sym">♀</span> {fmt(femalePct)}
          </span>
        )}
      </div>
    </div>
  );
}

function buildAdj(steps) {
  const adj = {};
  for (const s of steps) {
    if (!adj[s.from]) adj[s.from] = [];
    adj[s.from].push(s);
  }
  return adj;
}

function findRoots(steps) {
  const toSet = new Set(steps.map(s => s.to));
  return [...new Set(steps.map(s => s.from))].filter(n => !toSet.has(n));
}

function EvoArrow({ step }) {
  if (step.isMega) {
    const stone  = step.item ? formatSlug(step.item) : null;
    const isMove = step.item === 'dragon-ascent';
    return (
      <div className="evo-arrow evo-arrow--mega">
        ↔
        {stone && <span>{isMove ? `know ${stone}` : stone}</span>}
      </div>
    );
  }

  const trigger = step.trigger;
  const chips   = [];

  if (step.min_level)        chips.push(`lv ${step.min_level}`);

  if (step.item) {
    if (trigger === 'use-item') chips.push(`use ${formatSlug(step.item)}`);
    else if (trigger === 'trade') chips.push(`trade holding ${formatSlug(step.item)}`);
    else                          chips.push(`hold ${formatSlug(step.item)}`);
  }

  if (trigger === 'trade' && !step.item && !step.trade_species) chips.push('trade');
  if (step.trade_species)    chips.push(`trade for ${formatName(step.trade_species)}`);

  if (step.known_move)       chips.push(`know ${formatSlug(step.known_move)}`);
  if (step.known_move_type)  chips.push(`${formatSlug(step.known_move_type)} move`);
  if (step.min_happiness)    chips.push('high friendship');
  if (step.time_of_day)      chips.push(step.time_of_day);
  if (step.needs_rain)       chips.push('rain');
  if (step.turn_upside_down) chips.push('upside down');
  if (step.location)         chips.push(`in ${formatSlug(step.location)}`);
  if (step.nature)           chips.push(`${step.nature} nature`);

  // catch-all for uncommon triggers (shed, spin, etc.)
  if (!chips.length && trigger && trigger !== 'level-up') chips.push(formatSlug(trigger));

  return (
    <div className="evo-arrow">
      →
      {chips.map(c => <span key={c}>{c}</span>)}
    </div>
  );
}

const REGION_SUFFIX     = /-(alola|galar|hisui|paldea)$/;
const REGION_ADJECTIVE  = { alola: 'alolan', galar: 'galarian', hisui: 'hisuian', paldea: 'paldean' };

// returns the species name for a pokemon (strips form suffix for pokemon like toxtricity-amped)
function getSpeciesName(pokemonName) {
  for (const s of FORM_SUFFIX_SPECIES) {
    if (pokemonName === s || pokemonName.startsWith(s + '-')) return s;
  }
  return pokemonName;
}

// full overrides — for forms where suffix stripping produces an incomplete or misleading label
const FORM_CHIP_LABEL_OVERRIDES = {
  'calyrex-ice':                 'ice rider',
  'calyrex-shadow':              'shadow rider',
  'zygarde-10':                  '10% forme',
  'zygarde-complete':            'complete forme',
};

// trailing word appended to derived chip labels for a given pokemon's form set
// e.g. 'giratina-altered' → 'forme' means 'origin' becomes 'origin forme'
const FORM_WORD_SUFFIXES = {
  // -forme
  'giratina-altered':      'forme',
  'deoxys-normal':         'forme',
  'shaymin-land':          'forme',
  'meloetta-aria':         'forme',
  'aegislash-shield':      'forme',
  // -mode
  'darmanitan-standard':   'mode',
  'morpeko-full-belly':    'mode',
  // -face
  'eiscue-ice':            'face',
  // -style
  'oricorio-baile':        'style',
  'urshifu-single-strike': 'style',
  // -form
  'keldeo-ordinary':       'form',
  'wishiwashi-solo':       'form',
  'mimikyu-disguised':     'form',
  'castform':              'form',
  'tatsugiri-curly':       'form',
  'lycanroc-midday':       'form',
  'toxtricity-amped':      'form',
  'basculin-red-striped':  'form',
  // -size
  'pumpkaboo-average':     'size',
};

// derives a short display label for a form chip by stripping the shared prefix with the base name
// e.g. getFormChipLabel('charizard-mega-x', 'charizard')       → 'mega x'
//      getFormChipLabel('vulpix-alola', 'vulpix')              → 'alolan'
//      getFormChipLabel('toxtricity-amped-gmax', 'toxtricity-amped') → 'amped gmax'
//      getFormChipLabel('toxtricity-low-key-gmax', 'toxtricity-amped') → 'low key gmax'
//      getFormChipLabel('charizard-gmax', 'charizard')         → 'gigantamax'
function getFormChipLabel(formName, pokemonName) {
  if (FORM_CHIP_LABEL_OVERRIDES[formName]) return FORM_CHIP_LABEL_OVERRIDES[formName];
  // gmax: show "{variant} gmax" or "gigantamax" if no variant
  if (formName.endsWith('-gmax')) {
    const speciesName  = getSpeciesName(pokemonName);
    const withoutGmax  = formName.slice(0, -5); // strip '-gmax'
    const variant = withoutGmax.startsWith(speciesName + '-')
      ? withoutGmax.slice(speciesName.length + 1).replace(/-/g, ' ')
      : '';
    return variant ? `${variant} gmax` : 'gigantamax';
  }

  // strip the SPECIES prefix, not the full pokemon-name prefix. this keeps the variant-specific
  // part in the label when the current pokemon is already a specific variant (e.g. viewing
  // tatsugiri-curly, the chip for tatsugiri-curly-mega must say "curly mega form" not "mega form").
  const speciesName = getSpeciesName(pokemonName);
  const pokeWords = speciesName.split('-');
  const formWords = formName.split('-');
  let i = 0;
  while (i < pokeWords.length && i < formWords.length && pokeWords[i] === formWords[i]) i++;
  const suffix = formWords.slice(i).join('-');
  if (!suffix)                  return 'base';
  if (REGION_ADJECTIVE[suffix]) return REGION_ADJECTIVE[suffix];
  const label = suffix.split('-').join(' ');
  const word  = FORM_WORD_SUFFIXES[pokemonName];
  return word ? `${label} ${word}` : label;
}

function EvoNode({ name, currentName, adj }) {
  const { id: currentId } = useParams();
  const navigate = useNavigate();
  const id = NAME_TO_ID[name];
  const baseSlug = name.replace(REGION_SUFFIX, ''); // for sprite fallback lookup only
  const baseId   = id || NAME_TO_ID[baseSlug] || FORM_TO_BASE_ID[name];
  const artworkUrl = FORM_DATA[name]?.artwork_url
    || (baseId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${baseId}.png` : '');
  const label = formatFormName(name);
  const steps = adj[name] || [];

  const nodeContent = (
    <>
      <img src={artworkUrl} alt={label} onError={e => { e.target.style.display = 'none'; }} />
      <span>{label}</span>
    </>
  );

  // form nodes link to the base pokemon page with ?form= to trigger the form view
  const destId = id ?? NAME_TO_ID[baseSlug] ?? FORM_TO_BASE_ID[name] ?? null;
  const linkTo = destId
    ? (id ? `/pokemon/${id}` : `/pokemon/${destId}?form=${name}`)
    : null;

  return (
    <div className="evo-node">
      {linkTo ? (
        <div
          role="link"
          tabIndex={0}
          className={`evo-pokemon${name === currentName ? ' evo-current' : ''}`}
          // preventDefault on mousedown blocks the browser's focus-on-click, which would otherwise scroll .evo-chain (an overflow-x container) to bring the clicked card "into view". keyboard tab focus still works.
          onMouseDown={e => e.preventDefault()}
          // `state.scrollTop` flags this as a "go-to-top on land" navigation —
          // ScrollManager honors it even when only search params change (e.g.
          // mega evo cards keep the same pathname but flip ?form=). without
          // this flag, ScrollManager only scrolls on pathname change, so
          // clicking a mega card kept the user at their previous scroll
          // position, which felt broken.
          onClick={() => navigate(linkTo, { replace: true, state: { scrollTop: true } })}
          onKeyDown={e => e.key === 'Enter' && navigate(linkTo, { replace: true, state: { scrollTop: true } })}
          style={{ cursor: 'pointer' }}
        >
          {nodeContent}
        </div>
      ) : (
        <div className={`evo-pokemon evo-pokemon--form${name === currentName ? ' evo-current' : ''}`}>
          {nodeContent}
        </div>
      )}
      {steps.length > 0 && (
        <div className={`evo-children${steps.length > 1 ? ' evo-children--branch' : ''}`}>
          {steps.map(step => (
            <div key={step.to} className="evo-branch-row">
              <EvoArrow step={step} />
              <EvoNode name={step.to} currentName={currentName} adj={adj} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvoChain({ evolutions, currentName }) {
  if (!evolutions?.length) return <p style={{ color: 'var(--text-subtle)', fontSize: '.85rem' }}>none</p>;
  const adj = buildAdj(evolutions);
  const roots = findRoots(evolutions);
  // multi-root chains (e.g. tatsugiri's per-variant mega chains) stack vertically instead of
  // fanning out horizontally — each root is its own independent evolution line.
  const chainClass = `evo-chain${roots.length > 1 ? ' evo-chain--multi-root' : ''}`;
  return (
    <div className={chainClass}>
      {roots.map(root => (
        <EvoNode key={root} name={root} currentName={currentName} adj={adj} />
      ))}
    </div>
  );
}

function RegionalEvoChains({ regionalEvolutions, currentName }) {
  const regions = Object.keys(regionalEvolutions || {});
  if (!regions.length) return null;
  return (
    <>
      {regions.map(region => {
        const steps = regionalEvolutions[region];
        if (!steps?.length) return null;
        return (
          <div key={region} className="evo-regional">
            <EvoChain evolutions={steps} currentName={currentName} />
          </div>
        );
      })}
    </>
  );
}


// order: alt (unique forms) → regional → mega → gmax
// primal/origin/special forms fall into alt_forms from the generator
const FORM_GROUP_ORDER = ['alt_forms', 'regional_forms', 'mega_forms', 'gmax_forms'];

// species-specific chip ordering — used when the default alt_forms order doesn't match the
// intuitive progression for that species. each entry is a list of form slugs (null = base chip)
// in the desired display order. chips not present in the override are appended at the end.
const SPECIES_FORM_ORDER = {
  // zygarde: 10% → 50% (base) → complete → mega
  'zygarde-50': ['zygarde-10', null, 'zygarde-complete', 'zygarde-mega'],
};

// chip threshold — beyond this we swap the inline strip for a compact
// "all N forms" button that opens a modal grid. picked at 6 because that's
// roughly what the chip strip can show on one row at the default viewport
// before wrapping into a wall of links. arceus (18) + furfrou (9) trigger;
// most multi-form mons (rotom: 5, charizard: 3, etc.) stay inline.
const FORM_CHIPS_INLINE_LIMIT = 6;

function FormChips({ pokemon, activeForm, onSelect }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const available = new Set(Object.keys(pokemon.form_data || {}));

  const allForms = FORM_GROUP_ORDER.flatMap(field =>
    (pokemon[field] || []).filter(f => available.has(f) && !EXCLUDED_FORMS.has(f))
  );

  if (!allForms.length) return null;

  let chips = [
    { form: null,  label: getBaseFormLabel(pokemon.name) || 'base' },
    ...allForms.map(f => ({ form: f, label: getFormChipLabel(f, pokemon.name) })),
  ];

  const orderOverride = SPECIES_FORM_ORDER[pokemon.name];
  if (orderOverride) {
    const byForm = new Map(chips.map(c => [c.form, c]));
    const reordered = orderOverride.map(f => byForm.get(f)).filter(Boolean);
    const seen = new Set(orderOverride);
    chips = [...reordered, ...chips.filter(c => !seen.has(c.form))];
  }

  // many-form species (arceus, furfrou, etc.) blow out the inline chip
  // strip. switch to a compact trigger + modal picker so the page header
  // stays readable. inline behavior is unchanged for ≤ FORM_CHIPS_INLINE_LIMIT.
  if (chips.length > FORM_CHIPS_INLINE_LIMIT) {
    const activeChip = chips.find(c => c.form === activeForm) || chips[0];
    return (
      <>
        <div className="form-chips form-chips--compact">
          <span className="form-chip-active-label">{activeChip.label}</span>
          <button
            type="button"
            className="form-chip-picker-trigger"
            onClick={() => setPickerOpen(true)}
          >
            all {chips.length} forms ▾
          </button>
        </div>
        {pickerOpen && (
          <FormPickerModal
            pokemon={pokemon}
            chips={chips}
            activeForm={activeForm}
            onSelect={(f) => { onSelect(f); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="form-chips">
      {chips.map(({ form, label }, idx) => (
        <React.Fragment key={form ?? '__base__'}>
          {idx > 0 && <span className="form-chip-divider" />}
          <button
            className={`form-chip${activeForm === form ? ' active' : ''}`}
            onClick={() => onSelect(form)}
          >
            {label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// modal grid of every form for many-form species. each tile shows the
// form's small sprite + label; click selects + closes. backdrop click +
// escape close. designed to keep arceus / furfrou / alcremie's form
// switching usable without exploding the detail-page header.
function FormPickerModal({ pokemon, chips, activeForm, onSelect, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="form-picker-overlay" onClick={onClose}>
      <div className="form-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="form-picker-header">
          <h2>{formatName(pokemon.name)} forms</h2>
          <button type="button" className="form-picker-close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="form-picker-grid">
          {chips.map(({ form, label }) => {
            const fd = form ? pokemon.form_data?.[form] : null;
            const sprite = fd?.sprite_url || fd?.artwork_url
                        || pokemon.sprite_url || pokemon.artwork_url;
            const isActive = form === activeForm;
            return (
              <button
                key={form ?? '__base__'}
                type="button"
                className={`form-picker-tile${isActive ? ' is-active' : ''}`}
                onClick={() => onSelect(form)}
              >
                {sprite && <img src={sprite} alt={label} loading="lazy" />}
                <span className="form-picker-tile__label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PokemonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pokemon, loading, error } = usePokemonDetail(id);
  const [selectedAbility, setSelectedAbility] = useState(null);
  const { displayed: abilityShown, isClosing: abilityClosing } = useModalAnimation(selectedAbility);
  const { retro } = useRetroSprites();

  // ── prev/next navigation, optionally filtered by the dex view the
  // user came from. when location.state.from points at /pokedex with
  // search params, parse those out and use the same ordering api.js
  // produces for that filter set so left/right on /pokemon advance
  // through the filtered list rather than blindly id-1/id+1. forwards
  // the same `from` state on each step so chaining left/right keeps
  // the filter context intact.
  const orderedIds = useMemo(() => {
    const from = location.state?.from;
    if (typeof from !== 'string' || !from.startsWith('/pokedex')) return null;
    const search = from.split('?')[1] || '';
    if (!search) return null;
    const params = new URLSearchParams(search);
    const filterKeys = ['search', 'type', 'generation', 'cls', 'ability', 'sort', 'sortDir'];
    const filters = {};
    let any = false;
    for (const k of filterKeys) {
      const v = params.get(k);
      if (v) { filters[k] = v; any = true; }
    }
    if (!any) return null;
    return getOrderedIds(filters);
  }, [location.state?.from]);

  const currentIdNum = pokemon ? pokemon.id : Number(id);
  const filteredIdx  = orderedIds ? orderedIds.indexOf(currentIdNum) : -1;
  const prevId = orderedIds && filteredIdx > 0
    ? orderedIds[filteredIdx - 1]
    : (orderedIds ? null : (currentIdNum > 1 ? currentIdNum - 1 : null));
  const nextId = orderedIds && filteredIdx >= 0 && filteredIdx < orderedIds.length - 1
    ? orderedIds[filteredIdx + 1]
    : (orderedIds ? null : currentIdNum + 1);
  const goTo = (targetId) => navigate(`/pokemon/${targetId}`, {
    replace: true,
    state: location.state, // preserve the `from` so the chain keeps filter context
  });

  const formParam = searchParams.get('form');

  // keyboard navigation between pokemon: ← / → mirror the visible prev/next
  // buttons in the top nav row. only bind when we're not inside an open
  // ability modal (which has its own Escape handling and shouldn't trap arrows
  // since it's just text). bounds aren't enforced here — same as the buttons,
  // which already happily navigate to nonexistent ids and let the route 404.
  useEffect(() => {
    if (!pokemon || abilityShown) return;
    const handler = (e) => {
      // ignore arrow keys when the user is typing in an input/textarea/etc.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key === 'ArrowLeft'  && prevId != null) goTo(prevId);
      else if (e.key === 'ArrowRight' && nextId != null) goTo(nextId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pokemon, abilityShown, prevId, nextId]);

  // visual cue when the detail content updates — same scale pulse used by
  // the cycling modals (berry / pokeball / badge). consistent feel across
  // the app, and avoids the white-flash artifact we hit with an opacity
  // fade specifically on alt→alt form transitions. fires for both pokemon
  // id changes (prev/next nav) and form changes (form chip click); content
  // swap is instant in both cases.
  const detailCardRef       = useRef(null);
  const detailFirstMountRef = useRef(true);

  useEffect(() => {
    if (detailFirstMountRef.current) {
      detailFirstMountRef.current = false;
      return;
    }
    // bigger and slower than the cycling modals' default — the detail card
    // is large enough that a stronger pulse + longer duration reads as a
    // smooth "settling" of new content rather than a quick snap.
    const anim = pulseElement(detailCardRef.current, { scale: 1.02, duration: 400 });
    return () => anim?.cancel();
  }, [pokemon?.id, formParam]);

  // preload + pre-decode every form's artwork as soon as the pokemon loads.
  // network-only preloading (just setting img.src) caches the bytes but the
  // browser still has to decode the image when an actual <img> element
  // displays it — that decode happens on the main thread and can flash
  // mid-render on src change. img.decode() returns a promise that resolves
  // once the image is fully decoded into a paintable bitmap, after which
  // the actual <img> render is instant.
  useEffect(() => {
    if (!pokemon?.form_data) return;
    const urls = [];
    for (const form of Object.values(pokemon.form_data)) {
      if (!form) continue;
      if (form.artwork_url)   urls.push(form.artwork_url);
      if (form.artwork_shiny) urls.push(form.artwork_shiny);
      if (form.sprite_url)    urls.push(form.sprite_url);
      if (form.sprite_shiny)  urls.push(form.sprite_shiny);
    }
    urls.forEach(u => {
      const img = new Image();
      img.src = u;
      img.decode?.().catch(() => {});
    });
  }, [pokemon?.id]);

  const evoRef = useRef(null);

  // pokemon may still be null on the initial loading render — guard each
  // access so the sprite-row variables are computed safely either way.
  // <Img> handles its own per-image loading state with a spinner.
  const activeFormData = pokemon && formParam && pokemon.form_data?.[formParam] ? pokemon.form_data[formParam] : null;
  // artwork chain: prefer HOME 3D-render urls (added by
  // scrape-home-artwork.js) over the sugimori official-artwork.
  const artwork = pokemon ? (activeFormData
    ? (activeFormData.home_url   || activeFormData.artwork_url   || activeFormData.sprite_url   || pokemon.home_url   || pokemon.artwork_url)
    : (pokemon.home_url   || pokemon.artwork_url   || pokemon.sprite_url)) : null;
  const artworkSh = pokemon ? (activeFormData
    ? (activeFormData.home_shiny || activeFormData.artwork_shiny || activeFormData.sprite_shiny || null)
    : (pokemon.home_shiny || pokemon.artwork_shiny || pokemon.sprite_shiny)) : null;
  const formSlug = pokemon ? (formParam || pokemon.name) : null;

  // gender-difference variants. prefer HOME 3D renders for both M and F
  // when available (matched-style HD pair), fall back to the pixel
  // sprite pair otherwise. having HOME female (from scrape-home-female.js)
  // means the gendered slot no longer needs the pixel-fallback workaround
  // that previously mixed sprite + artwork styles.
  const spriteMaleNormal   = pokemon ? (activeFormData?.home_url   || activeFormData?.artwork_url   || activeFormData?.sprite_url   || pokemon.home_url   || pokemon.artwork_url   || pokemon.sprite_url   || null) : null;
  const spriteMaleShiny    = pokemon ? (activeFormData?.home_shiny || activeFormData?.artwork_shiny || activeFormData?.sprite_shiny || pokemon.home_shiny || pokemon.artwork_shiny || pokemon.sprite_shiny || null) : null;
  const spriteFemaleNormal = pokemon ? (activeFormData
    ? (activeFormData.home_url_female || activeFormData.artwork_url_female || activeFormData.sprite_url_female || null)
    : (pokemon.home_url_female || pokemon.artwork_url_female || pokemon.sprite_url_female || null)) : null;
  const spriteFemaleShiny  = pokemon ? (activeFormData
    ? (activeFormData.home_shiny_female || activeFormData.artwork_shiny_female || activeFormData.sprite_shiny_female || null)
    : (pokemon.home_shiny_female || pokemon.artwork_shiny_female || pokemon.sprite_shiny_female || null)) : null;
  // suppress the 2-column M/F overlay in two cases:
  //   1. species already splits genders via separate forms (pyroar-male /
  //      pyroar-female, indeedee-male / indeedee-female, etc.) — the
  //      form chip strip handles the M/F swap, no need for the overlay.
  //   2. user is viewing a non-base form (mega, gmax, primal, regional,
  //      alt). per game canon, alt forms don't have rendered gender
  //      visual differences — even when pokeapi auto-generates a
  //      sprite_url_female for a mega via the female base template, the
  //      mega itself is gender-neutral. just show normal + shiny.
  const speciesUsesGenderForms = pokemon && (
    pokemon.name.endsWith('-male') ||
    Object.keys(pokemon.form_data || {}).some(
      (k) => k.endsWith('-male') || k.endsWith('-female')
    )
  );
  const hasGenderVariant = !!spriteFemaleNormal && !speciesUsesGenderForms && !formParam;

  // resolve the exact urls that the sprite-row will render given current
  // retro/non-retro mode + form selection.
  // - normal: only the FORM'S own retro sprite (gif > png). no species
  //   fallback — showing base charizard's pixel art on the mega-x detail
  //   page misrepresents which form you're looking at. when the form has
  //   no curated retro, fall through to the form's official artwork
  //   (handled by `normalSrc` below).
  // - shiny: in retro mode we deliberately don't render a shiny slot at
  //   all. the curator dropped shinies from selection, so there'd be
  //   nothing curated, and falling back to official shiny art alongside
  //   the retro normal would mix two art styles in one row.
  const retroNormal = retro && pokemon
    ? (getRetroGif(formSlug) || getRetroPng(formSlug) || null)
    : null;
  const normalSrc = retro ? (retroNormal || artwork) : artwork;
  const shinySrc  = retro ? null : artworkSh;
  const retroShiny = null; // legacy reference kept so the jsx below doesn't break

  // gender variants render in non-retro mode only (the gen-2 curator doesn't
  // index female sprites). when active, the row swaps from HD artwork to
  // matched sprite pairs so M and F look stylistically consistent.
  const showGenderVariant = !retro && hasGenderVariant;

  // pick the slot URLs the sprite-row will actually render. group-gate
  // them via useSpritesReady so a fast-loading male sprite doesn't pop
  // in 200ms before the slower-loading shiny — both stay on a spinner
  // until every slot is decoded, then reveal together.
  const slotSrcs = showGenderVariant
    ? [spriteMaleNormal, spriteMaleShiny, spriteFemaleNormal, spriteFemaleShiny].filter(Boolean)
    : [normalSrc, shinySrc].filter(Boolean);
  const spritesReady = useSpritesReady(slotSrcs);

  // slots for the enlarge-on-tap sprite modal — same set of urls the
  // sprite-row renders, paired with their gender + shiny flags so the
  // modal can show the matching pill badge for each variant. nulls are
  // filtered out so the modal only ever cycles through actually-existing
  // images.
  // gendered ordering pairs by shiny-state rather than by gender —
  // normal-male → normal-female → shiny-male → shiny-female. cycling
  // through the modal then reads as "see both genders, then see both
  // shinies" which matches the visual pairing of the sprite-row above.
  const spriteSlots = (showGenderVariant
    ? [
        { src: spriteMaleNormal,   gender: 'male',   shiny: false },
        { src: spriteFemaleNormal, gender: 'female', shiny: false },
        { src: spriteMaleShiny,    gender: 'male',   shiny: true  },
        { src: spriteFemaleShiny,  gender: 'female', shiny: true  },
      ]
    : [
        { src: normalSrc, gender: null, shiny: false },
        { src: shinySrc,  gender: null, shiny: true  },
      ]
  ).filter(s => !!s.src);
  // index inside spriteSlots for each of the sprite-row's <img> tags.
  // -1 = not present (e.g. shiny when retro is on). used to seed the
  // modal at the slot the user actually tapped.
  const slotIndex = (gender, shiny) => spriteSlots.findIndex(s => (s.gender || null) === gender && !!s.shiny === !!shiny);

  const [spriteModalIdx, setSpriteModalIdx] = useState(null);
  const { displayed: spriteModalShown, isClosing: spriteModalClosing } = useModalAnimation(spriteModalIdx !== null);
  const openSpriteModal = (i) => { if (i >= 0) setSpriteModalIdx(i); };

  if (loading) return <div className="page-center">loading...</div>;
  if (error)   return <div className="page-center error">error: {error}</div>;
  if (!pokemon) return null;

  const selectForm     = f => f ? setSearchParams({ form: f }, { replace: true }) : setSearchParams({}, { replace: true });

  const padId     = String(pokemon.id).padStart(3, '0');
  const types    = activeFormData?.types    || pokemon.types    || [];
  const stats    = activeFormData?.stats    || pokemon.stats    || [];
  const abilities= activeFormData?.abilities|| pokemon.abilities|| [];
  const matchups = defensiveMatchups(types);
  const height   = activeFormData?.height   ?? pokemon.height;
  const weight   = activeFormData?.weight   ?? pokemon.weight;
  const evYield  = activeFormData?.ev_yield ?? pokemon.ev_yield ?? [];

  // inline a region's chain into the main chain only if at least one of its steps is
  // base→regional (e.g. goomy → sliggoo-hisui). that guarantees the chain attaches to a species
  // in the main tree, and all subsequent regional→regional steps inline alongside so the whole
  // regional line renders connected instead of fragmenting across main + separate. chains made
  // entirely of regional→regional steps (e.g. slowpoke-galar, meowth, sneasel-hisui) stay in the
  // separate section as before.
  const REGION_FORM_SUFFIX = /-(alola|galar|hisui|paldea)$/;
  const inlineEvoSteps = [];
  const separateRegionalEvos = {};
  for (const [region, steps] of Object.entries(pokemon.regionalEvolutions || {})) {
    const hasBaseEntry = steps.some(s => !REGION_FORM_SUFFIX.test(s.from) && !!NAME_TO_ID[s.from]);
    if (hasBaseEntry) inlineEvoSteps.push(...steps);
    else              separateRegionalEvos[region] = steps;
  }
  const mergedEvolutions = [...(pokemon.evolutions || []), ...inlineEvoSteps];

  return (
    <div className="detail-page">
      <div className="detail-top-row">
        <button className="back-link" onClick={() => navigate(-1)}>← back</button>
        <div className="detail-nav">
          {prevId != null && (
            <button onClick={() => goTo(prevId)}>← #{String(prevId).padStart(3, '0')}</button>
          )}
          {nextId != null && (
            <button onClick={() => goTo(nextId)}>#{String(nextId).padStart(3, '0')} →</button>
          )}
        </div>
      </div>

      <div className="detail-card-wrap">
      <div ref={detailCardRef} className="detail-card">
        {/* left column: artwork + sprites + (optional) gender ratio bar */}
        <div className="detail-left">
          <div className={`sprite-row${showGenderVariant ? ' sprite-row--gendered' : ''}`}>
            {!spritesReady ? (
              // group gate — every slot shows a single spinner until all
              // images decode, then the real sprite-row swaps in. without
              // this the male sprite renders ~100-300ms before the shiny
              // when navigating prev/next, which reads as a jarring pop.
              <div className="sprite-row__loader" aria-label="loading sprites">
                <span className="sprite-row__spinner" />
              </div>
            ) : showGenderVariant ? (
              <>
                <div className="sprite-row__col">
                  <img
                    src={spriteMaleNormal}
                    alt={`${pokemon.name} male`}
                    className="detail-sprite"
                    onClick={() => openSpriteModal(slotIndex('male', false))}
                  />
                  {/* the trailing U+FE0E variation selector forces text-style
                      rendering of the ♂ glyph — without it ios swaps in a
                      tall color-emoji presentation whose metrics push above
                      the pill's outline on mobile. */}
                  <div className="sprite-row__gender" aria-label="male">{'♂︎'}</div>
                  {spriteMaleShiny && <>
                    <img
                      src={spriteMaleShiny}
                      alt={`${pokemon.name} male shiny`}
                      className="detail-sprite"
                      onClick={() => openSpriteModal(slotIndex('male', true))}
                    />
                    <div className="sprite-row__shiny-label" aria-label="shiny" title="shiny variant"><ShinySparkle /></div>
                  </>}
                </div>
                <div className="sprite-row__col">
                  <img
                    src={spriteFemaleNormal}
                    alt={`${pokemon.name} female`}
                    className="detail-sprite"
                    onClick={() => openSpriteModal(slotIndex('female', false))}
                  />
                  <div className="sprite-row__gender sprite-row__gender--f" aria-label="female">{'♀︎'}</div>
                  {spriteFemaleShiny && <>
                    <img
                      src={spriteFemaleShiny}
                      alt={`${pokemon.name} female shiny`}
                      className="detail-sprite"
                      onClick={() => openSpriteModal(slotIndex('female', true))}
                    />
                    <div className="sprite-row__shiny-label" aria-label="shiny" title="shiny variant"><ShinySparkle /></div>
                  </>}
                </div>
              </>
            ) : (
              <>
                <div className="sprite-row__shiny-stack">
                  <img
                    src={normalSrc}
                    alt={pokemon.name}
                    className={retro && retroNormal ? 'detail-artwork detail-artwork--retro' : 'detail-artwork'}
                    onClick={() => openSpriteModal(slotIndex(null, false))}
                  />
                  {retro && retroNormal && (() => {
                    const credit = getRetroCredit(formSlug, pokemon.name);
                    if (!credit) return null;
                    const artist = cleanRetroCredit(credit.artist);
                    const sourceLabel = displaySourceLabel(credit);
                    const sourceUrl = credit.creditUrl || credit.sourceUrl;
                    return (
                      <div className="retro-credit">
                        [art by {artist}
                        {sourceLabel && <>
                          {' · '}
                          {sourceUrl
                            ? <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceLabel}</a>
                            : <span>{sourceLabel}</span>}
                        </>}
                        ]
                      </div>
                    );
                  })()}
                  {/* mobile-only placeholder — on mobile the row flips
                      side-by-side, and without this the shiny column
                      (which carries the ✨ label below it) is taller
                      than the bare normal column, so flex centering
                      pushes the normal sprite down out of alignment.
                      desktop hides the placeholder since the columns
                      stack vertically and the misalignment doesn't
                      occur. */}
                  {shinySrc && (
                    <div className="sprite-row__shiny-label sprite-row__shiny-label--placeholder" aria-hidden="true">
                      <ShinySparkle />
                    </div>
                  )}
                </div>
                {shinySrc && (
                  <div className="sprite-row__shiny-stack">
                    <img
                      src={shinySrc}
                      alt={`${pokemon.name} shiny`}
                      className={retro && retroShiny ? 'detail-artwork detail-artwork--retro' : 'detail-artwork'}
                      onClick={() => openSpriteModal(slotIndex(null, true))}
                    />
                    <div className="sprite-row__shiny-label" aria-label="shiny" title="shiny variant">
                      <ShinySparkle />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {/* gender ratio bar — visible for any non-genderless mon. when
              the species also has visual variants (showGenderVariant), the
              bar reinforces the M/F columns above; otherwise it shows
              ratio without splitting the sprites. gated on spritesReady
              so the bar doesn't briefly anchor under the loader spinner
              and then jump down when the real sprite-row swaps in. */}
          {spritesReady && <GenderRatioBar rate={pokemon.gender_rate} />}
        </div>

        {/* right column: info */}
        <div className="detail-right">
          <div className="detail-name-row">
            <div>
              <div className="detail-title-row">
                <h1>{formatName(pokemon.name)}</h1>
                {/* forms with their own cry (megas, regional forms, …) carry a
                    cry_id; cosmetic forms share the species' cry */}
                <CryButton
                  key={activeFormData?.cry_id || pokemon.id}
                  id={activeFormData?.cry_id || pokemon.id}
                  slug={activeFormData?.cry_id ? formParam : pokemon.name}
                  name={formatName(pokemon.name)}
                  className="detail-cry"
                />
              </div>
              {pokemon.name_jp && (
                <small className="jp-subtitle detail-jp">
                  {pokemon.name_jp}{pokemon.romaji ? ` [${pokemon.romaji}]` : ''}
                </small>
              )}
              {pokemon.genus && <p className="detail-genus">{pokemon.genus}</p>}
            </div>
            <div className="detail-id-block">
              <div className="detail-id-row">
                <span className="detail-gen">gen {pokemon.generation}</span>
                <span className="detail-id">#{padId}</span>
              </div>
              {(pokemon.is_legendary || pokemon.is_mythical) && (
                <span className={`special-badge ${pokemon.is_mythical ? 'mythical' : 'legendary'}`}>
                  {pokemon.is_mythical ? 'mythical' : 'legendary'}
                </span>
              )}
            </div>
          </div>

          <div className="detail-types">
            {types.map(t => (
              <span key={t} className={`type-badge type-${t}`}>{t}</span>
            ))}
          </div>

          <FormChips pokemon={pokemon} activeForm={formParam} onSelect={selectForm} />

          {(activeFormData?.flavor_text || pokemon.flavor_text) && (
            <p className="detail-flavor">{activeFormData?.flavor_text || pokemon.flavor_text}</p>
          )}

          {/* quick stats: height, weight, gender */}
          <div className="detail-meta">
            <div className="meta-chip">
              <span className="meta-label">height</span>
              <span className="meta-value">{(height / 10).toFixed(1)} m</span>
            </div>
            <div className="meta-chip">
              <span className="meta-label">weight</span>
              <span className="meta-value">{(weight / 10).toFixed(1)} kg</span>
            </div>
            <div className="meta-chip">
              <span className="meta-label">gender</span>
              <GenderDisplay rate={pokemon.gender_rate} />
            </div>
          </div>

          {/* base stats */}
          <div className="detail-stats">
            <h2>base stats</h2>
            {stats.map(s => <StatRow key={s.stat_name} stat={s} />)}
          </div>

          {/* abilities */}
          <div>
            <h2 style={{ fontSize: '.7rem', fontWeight: 'var(--fw-semibold)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: '10px' }}>abilities</h2>
            <ul className="abilities-list">
              {abilities.map(a => (
                <li key={a.ability_name}>
                  <button
                    className="ability-btn"
                    onClick={() => setSelectedAbility({ name: a.ability_name, is_hidden: a.is_hidden })}
                  >
                    <span style={a.is_hidden ? { fontStyle: 'italic' } : undefined}>{a.ability_name.replace(/-/g, ' ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* defensive type matchups — damage taken from each attacking type
              against this pokemon's current types. neutral (1×) is omitted;
              groups appear in order of severity (4× → 0). */}
          <div className="detail-matchups">
            <h2 style={{ fontSize: '.7rem', fontWeight: 'var(--fw-semibold)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: '10px' }}>damage taken</h2>
            {MATCHUP_ORDER.map(({ mult, label }) => {
              const list = matchups[String(mult)];
              if (!list?.length) return null;
              return (
                <div key={mult} className="matchup-row">
                  <span className="matchup-row__mult">{label}</span>
                  <span className="matchup-row__types">
                    {list.map(t => (
                      <span key={t} className={`type-badge type-${t}`}>{t}</span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>

      {/* evolution chain — clicking a card navigates and ScrollManager
          smooth-scrolls back to the top of the page. */}
      <div className="detail-evolutions" ref={evoRef}>
        <h2>evolution chain</h2>
        {(() => {
          // when a form is selected, pass it as currentName so only an exact matching evo node
          // gets highlighted. if no node matches (e.g. megas, gmaxes), nothing is highlighted.
          // when no form is selected, highlight the base pokemon as usual.
          const currentEvoName = formParam ?? pokemon.name;
          return <>
            <EvoChain evolutions={mergedEvolutions} currentName={currentEvoName} />
            <RegionalEvoChains regionalEvolutions={separateRegionalEvos} currentName={currentEvoName} />
          </>;
        })()}
      </div>

      {/* extra species info */}
      <div className="detail-extra">
        <div className="meta-chip">
          <span className="meta-label">catch rate</span>
          <span className="meta-value">{pokemon.catch_rate ?? '—'}</span>
        </div>
        <div className="meta-chip">
          <span className="meta-label">base happiness</span>
          <span className="meta-value">{pokemon.base_happiness ?? '—'}</span>
        </div>
        <div className="meta-chip">
          <span className="meta-label">base exp</span>
          <span className="meta-value">{pokemon.base_experience ?? '—'}</span>
        </div>
        <div className="meta-chip">
          <span className="meta-label">growth rate</span>
          <span className="meta-value">{pokemon.growth_rate ?? '—'}</span>
        </div>
        <div className="meta-chip">
          <span className="meta-label">egg groups</span>
          <span className="meta-value">{(pokemon.egg_groups || []).filter(g => g !== 'no-eggs').join(', ') || 'none'}</span>
        </div>
        {evYield.length > 0 && (
          <div className="meta-chip">
            <span className="meta-label">ev yield</span>
            <span className="meta-value">{evYield.map(e => `${e.effort} ${EV_STAT_LABELS[e.stat_name] ?? e.stat_name}`).join(' / ')}</span>
          </div>
        )}
      </div>

      {abilityShown && (
        <AbilityModal ability={abilityShown} closing={abilityClosing} onClose={() => setSelectedAbility(null)} />
      )}

      {spriteModalShown && (
        <SpriteModal
          slots={spriteSlots}
          startIndex={spriteModalIdx ?? 0}
          pokemonName={pokemon.name}
          closing={spriteModalClosing}
          onClose={() => setSpriteModalIdx(null)}
        />
      )}
    </div>
  );
}
