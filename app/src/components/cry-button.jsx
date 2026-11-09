import { useEffect, useRef, useState } from 'react';

// ─── CryButton ───────────────────────────────────────────────────────────────
// speaker button that plays a pokémon's cry. used by the daily spotlight and
// the pokémon page. remount it (key={id}) when the pokémon changes.
//
// played on press, never autoplayed.
//   • main path — the pokéapi ogg (CORS-clean via jsdelivr) is fetched once,
//     decoded into an AudioBuffer, and every press starts a FRESH buffer
//     source through a gain node (cries are mastered hot). a press while it's
//     still playing fades the old one out over a few ms and starts clean from
//     the top — instant, no repeat. (rewinding a media element mid-play made
//     iOS repeat a sliver of the cry; a new element per press added a delay.)
//   • the ringer switch: on iOS, web audio follows the silent switch unless
//     the page's audio session is 'playback' (ios 16.4+), set on each press.
//   • fallback — if fetching/decoding fails (e.g. a browser without ogg
//     decoding), a plain <audio> element plays the showdown mp3 at
//     element.volume. plain elements avoid the macOS-safari bug where
//     createMediaElementSource() outputs silence.

const CRY_OGG = (id) =>
  `https://cdn.jsdelivr.net/gh/PokeAPI/cries@main/cries/pokemon/latest/${id}.ogg`;
const fetchCry = (id) => fetch(CRY_OGG(id))
  .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
const CRY_ID  = (slug) => slug.toLowerCase().replace(/[^a-z0-9]/g, '');
const CRY_MP3 = (slug) =>
  `https://play.pokemonshowdown.com/audio/cries/${CRY_ID(slug)}.mp3`;

// cries are mastered very hot, so we attenuate to CRY_VOLUME on playback — via
// the Web Audio gain node, or element.volume on the fallback (see playCry).
// tweak the modifier/base to taste.
const CRY_BASE_VOLUME = 0.4;
const CRY_VOLUME_MODIFIER = 0.25;
const CRY_VOLUME = CRY_BASE_VOLUME * CRY_VOLUME_MODIFIER;

export default function CryButton({ id, slug, name, className = '' }) {
  // drives the "now playing" visual — reflects real playback, not just the
  // press (matters when device volume makes the sound inaudible).
  const [playing, setPlaying] = useState(false);
  // reused across presses; none drive renders, so refs.
  const audioCtxRef = useRef(null);   // AudioContext (created on first press)
  const bytesRef    = useRef(null);   // promise → the ogg's bytes, prefetched on mount
  const bufferRef   = useRef(null);   // promise → decoded AudioBuffer (or null on failure)
  const voiceRef    = useRef(null);   // { src, gain } of the cry currently playing
  const fallbackRef = useRef(null);   // <audio> element, fallback path only

  function playFallback() {
    let a = fallbackRef.current;
    if (!a) {
      a = new Audio(CRY_MP3(slug));
      a.addEventListener('playing', () => setPlaying(true));
      a.addEventListener('ended',   () => setPlaying(false));
      a.addEventListener('pause',   () => setPlaying(false));
      a.addEventListener('error',   () => setPlaying(false));
      fallbackRef.current = a;
    }
    a.volume = CRY_VOLUME;
    a.pause();
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  function playCry() {
    // ignore the ringer / silent switch (ios 16.4+): without this, web audio
    // on iphone is muted whenever the phone is on silent
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || fallbackRef.current) { playFallback(); return; }

    // context + resume happen synchronously inside the tap (ios gesture rule)
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    if (!bufferRef.current) {
      bufferRef.current = (bytesRef.current || fetchCry(id))
        .then(data => new Promise((res, rej) => ctx.decodeAudioData(data, res, rej)))
        .catch(() => null);
    }

    bufferRef.current.then(buffer => {
      if (!buffer) { playFallback(); return; }

      // fade out whatever is still playing (a hard stop clicks)
      const prev = voiceRef.current;
      const now = ctx.currentTime;
      if (prev) {
        prev.gain.gain.cancelScheduledValues(now);
        prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
        prev.gain.gain.linearRampToValueAtTime(0, now + 0.015);
        try { prev.src.stop(now + 0.02); } catch { /* already stopped */ }
      }

      const gain = ctx.createGain();
      gain.gain.value = CRY_VOLUME;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      const voice = { src, gain };
      src.onended = () => {
        gain.disconnect();
        if (voiceRef.current === voice) { voiceRef.current = null; setPlaying(false); }
      };
      voiceRef.current = voice;
      src.start(prev ? now + 0.015 : now);
      setPlaying(true);
    });
  }

  // prefetch the cry's bytes shortly after mount, so the first press plays
  // right away (decoding still waits for the first press — it needs the
  // audio context, which ios only allows inside a tap)
  useEffect(() => {
    const t = setTimeout(() => { if (!bytesRef.current) bytesRef.current = fetchCry(id).catch(() => null); }, 1200);
    return () => clearTimeout(t);
  }, [id]);

  // stop + release audio on unmount
  useEffect(() => () => {
    try { voiceRef.current?.src.stop(); } catch { /* not started */ }
    audioCtxRef.current?.close?.();
    fallbackRef.current?.pause();
  }, []);

  return (
    <button
      type="button"
      className={`cry-btn${playing ? ' cry-btn--playing' : ''}${className ? ' ' + className : ''}`}
      onClick={playCry}
      aria-label={playing ? `playing ${name} cry` : `play ${name} cry`}
      title={playing ? 'playing…' : 'play cry'}
    >
      <SpeakerIcon />
    </button>
  );
}

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5V2.5z" />
      <path className="cry-btn-wave cry-btn-wave--1" d="M10.5 5.5c.8.6 1.3 1.5 1.3 2.5s-.5 1.9-1.3 2.5l-.6-.8c.6-.4.9-1 .9-1.7s-.3-1.3-.9-1.7l.6-.8z" />
      <path className="cry-btn-wave cry-btn-wave--2" d="M12 3.5c1.8 1.1 3 3 3 4.5s-1.2 3.4-3 4.5l-.6-.8c1.5-.9 2.4-2.3 2.4-3.7s-.9-2.8-2.4-3.7l.6-.8z" />
    </svg>
  );
}
