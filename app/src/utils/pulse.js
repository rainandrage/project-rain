// shared imperative scale pulse used across the site whenever content inside
// a stable container changes (cycling modals, pokemon detail prev/next).
// gentler than a typical click-feedback bump — the goal is "the content
// updated" rather than "you pressed something". one place to tune so all
// surfaces stay consistent.
export function pulseElement(el, options = {}) {
  if (!el) return null;
  const {
    scale    = 1.015,
    duration = 300,
    easing   = 'ease-in-out',
    offset   = 0.35,
  } = options;
  return el.animate(
    [
      { transform: 'scale(1)' },
      { transform: `scale(${scale})`, offset },
      { transform: 'scale(1)' },
    ],
    { duration, easing },
  );
}

// soft opacity dip used when the same container's contents update but the
// container itself doesn't move — e.g. switching between forms on a pokemon
// detail page. a scale pulse there reads as too jarring because the card
// is already huge and stable; fading the contents briefly to ~0.35 and back
// communicates "this just refreshed" without the size animation.
export function fadeElement(el, options = {}) {
  if (!el) return null;
  const {
    dip      = 0.35,
    duration = 260,
    easing   = 'ease-in-out',
  } = options;
  return el.animate(
    [
      { opacity: 1 },
      { opacity: dip, offset: 0.5 },
      { opacity: 1 },
    ],
    { duration, easing },
  );
}

// ─── keyPress ─── touch press feedback that behaves like a keyboard key:
// goes down as the finger lands, comes straight back up on release — one
// smooth down + one smooth up, no overshoot. for things that navigate away,
// `action` runs once the key is back up (a quick tap still travels the full
// way down first), so the press is always seen. a scroll (pointercancel)
// just lets the key back up. mouse / keyboard: `action` runs immediately.
// spread the returned handlers on the tappable element and give it the
// `press-js` class (opts out of the CSS :active press). `target` picks the
// element that moves (e.g. the whole card around a link).
const KEY_DOWN = '.94';
const DOWN_MS = 90;
const UP_MS = 140;

function keyDown(el) {
  el._key?.cancel();
  el._key = el.animate([{ scale: '1' }, { scale: KEY_DOWN }], { duration: DOWN_MS, easing: 'ease-out', fill: 'forwards' });
}
function keyUp(el) {
  const down = el._key;
  if (!down) return Promise.resolve();
  el._key = null;
  const up = () => {
    const a = el.animate([{ scale: KEY_DOWN }, { scale: '1' }], { duration: UP_MS, easing: 'ease-out' });
    down.cancel();
    return a.finished.catch(() => {});
  };
  return down.playState === 'finished' ? up() : down.finished.then(up, () => {});
}

export function keyPress(action, { target = (el) => el } = {}) {
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      keyDown(target(e.currentTarget));
    },
    onPointerUp: (e) => {
      const el = target(e.currentTarget);
      el._released = keyUp(el);
    },
    onPointerCancel: (e) => { keyUp(target(e.currentTarget)); },
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      const el = target(e.currentTarget);
      const released = el._released;
      el._released = null;
      if (released) released.then(action); else action();
    },
  };
}
