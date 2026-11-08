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
// cry audio: played on click of the speaker icon, never autoplayed. two paths:
//   • iOS/ipados safari — HTMLAudioElement.volume is a no-op there, so we route
//     pokéapi ogg (CORS-clean via jsdelivr) through a Web Audio GainNode to
//     tame the very-hot cries. createMediaElementSource works fine on iOS.
//   • everywhere else, incl. macOS safari — a plain <audio> element playing
//     showdown mp3, attenuated with element.volume. this sidesteps the macOS-
//     safari webkit bug where createMediaElementSource() outputs silence (why
//     the cry was mute on the mac but fine on iphone/ipad).
//
// layout (2026-11 redesign): a compact always-open card — kicker, name +
// cry button, "#id · types · gen · region", artwork on the right. the old
// collapsible card (and its per-day minimize state) is gone.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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

// two cry sources (see the platform note at the top of the file):
//   ogg — pokéapi via jsdelivr, CORS-clean so it can feed the iOS Web Audio
//         gain node. keyed by dex id.
//   mp3 — pokémon showdown, for the desktop plain-element path. keyed by the
//         species' showdown id (slug with every non-alphanumeric stripped:
//         ho-oh → hooh, mr-mime → mrmime).
const CRY_OGG = (id) =>
  `https://cdn.jsdelivr.net/gh/PokeAPI/cries@main/cries/pokemon/latest/${id}.ogg`;
const CRY_ID  = (slug) => slug.toLowerCase().replace(/[^a-z0-9]/g, '');
const CRY_MP3 = (slug) =>
  `https://play.pokemonshowdown.com/audio/cries/${CRY_ID(slug)}.mp3`;

// iOS/iPadOS is the only environment where element.volume is ignored (needs
// the Web Audio path) AND where createMediaElementSource actually works.
// iPadOS reports its UA as "Macintosh", so disambiguate real macs (no touch)
// from ipads via maxTouchPoints.
const IS_IOS = typeof navigator !== 'undefined' && (
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1)
);

// cries are mastered very hot, so we attenuate to CRY_VOLUME on playback — via
// the Web Audio gain node on iOS, or element.volume on desktop (see playCry).
// tweak the modifier/base to taste.
const CRY_BASE_VOLUME = 0.4;
const CRY_VOLUME_MODIFIER = 0.25;
const CRY_VOLUME = CRY_BASE_VOLUME * CRY_VOLUME_MODIFIER;

export default function Spotlight() {
  const dateKey     = useMemo(todayKey, []);
  const todayId     = useMemo(() => pickTodayId(dateKey), [dateKey]);

  const [pokemon, setPokemon] = useState(null);
  // drives the cry button's "now playing" visual — flipped by the audio
  // element's own play/ended events so it reflects real playback, not just
  // the click (which matters when device volume makes the sound inaudible).
  const [playing, setPlaying] = useState(false);
  // reused across cry-button clicks; none drive renders, so refs. audioCtx +
  // gain are only populated on the iOS Web Audio path.
  const audioRef    = useRef(null);
  const audioCtxRef = useRef(null);
  const gainRef     = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getPokemonById(todayId)
      .then(p => { if (!cancelled) setPokemon(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [todayId]);

  function playCry() {
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      // reflect actual playback state on the button. attached once (the
      // element is reused across clicks). 'ended' returns it to rest;
      // 'pause'/'error' cover the interrupted/failed cases.
      a.addEventListener('playing', () => setPlaying(true));
      a.addEventListener('ended',   () => setPlaying(false));
      a.addEventListener('pause',   () => setPlaying(false));
      a.addEventListener('error',   () => setPlaying(false));

      if (IS_IOS) {
        // ogg through a Web Audio gain node — the only way to attenuate on iOS,
        // where element.volume is ignored. createMediaElementSource works here.
        a.crossOrigin = 'anonymous';
        a.src = CRY_OGG(todayId);
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          audioCtxRef.current = new Ctx();
          const source = audioCtxRef.current.createMediaElementSource(a);
          gainRef.current = audioCtxRef.current.createGain();
          source.connect(gainRef.current).connect(audioCtxRef.current.destination);
        }
      } else {
        // desktop (incl. macOS safari): plain element mp3, volume via
        // element.volume — no createMediaElementSource, no macOS silence bug.
        a.src = CRY_MP3(pokemon.name);
      }
      audioRef.current = a;
    }
    // re-apply volume each play so CRY_VOLUME tweaks hot-reload.
    if (gainRef.current) gainRef.current.gain.value = CRY_VOLUME;
    else a.volume = CRY_VOLUME;
    // ios: the context can auto-suspend between plays; the click is a gesture.
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    a.currentTime = 0;
    a.play().catch(() => {});
  }

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
          <button
            type="button"
            className={`spotlight__cry spotlight-card__cry${playing ? ' spotlight__cry--playing' : ''}`}
            onClick={playCry}
            aria-label={playing ? `playing ${displayName} cry` : `play ${displayName} cry`}
            title={playing ? 'playing…' : 'play cry'}
          >
            <SpeakerIcon />
          </button>
        </div>
        <span className="spotlight-card__meta">{meta}</span>
      </div>
      {artwork && (
        <img src={artwork} alt="" className="spotlight-card__art" loading="lazy" />
      )}
    </article>
  );
}

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5V2.5z" />
      <path className="spotlight__cry-wave spotlight__cry-wave--1" d="M10.5 5.5c.8.6 1.3 1.5 1.3 2.5s-.5 1.9-1.3 2.5l-.6-.8c.6-.4.9-1 .9-1.7s-.3-1.3-.9-1.7l.6-.8z" />
      <path className="spotlight__cry-wave spotlight__cry-wave--2" d="M12 3.5c1.8 1.1 3 3 3 4.5s-1.2 3.4-3 4.5l-.6-.8c1.5-.9 2.4-2.3 2.4-3.7s-.9-2.8-2.4-3.7l.6-.8z" />
    </svg>
  );
}
