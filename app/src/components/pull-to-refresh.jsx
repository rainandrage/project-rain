import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { appScrollY } from '../utils/app-scroll';

// pull-to-refresh affordance for any touch context — standalone PWA, regular
// safari on iphone, ipad in landscape or portrait, etc. previously gated to
// standalone-only, but that left the news page falling back to ios's native
// rubber-band-and-reload in regular safari, which felt inconsistent. our
// handler claims the gesture via preventDefault so the native bounce is
// suppressed during a real pull; non-touch desktops never trigger the
// listeners at all, so the gate isn't needed for them either.
//
// usage:
//   <PullToRefresh onRefresh={async () => { ... }} />
//
// onRefresh should return a promise; the spinner stays in its "refreshing"
// state until that promise settles. errors are swallowed (caller should
// handle their own error state — the indicator just hides).
//
// DESIGN NOTES
//
// 1. the whole page slides down with the finger, ios-mail / twitter style.
//    transforms are written directly to <div id="root"> via DOM manipulation
//    inside the touchmove handler — NO rAF, NO React state. earlier versions
//    used React state for `active` / `ready` which caused re-renders mid-drag
//    and ios would lose gesture ownership, snapping the page back to 0
//    repeatedly during the gesture.
//
// 2. `translate3d` (vs plain translateY) puts #root on a hardware-accelerated
//    compositor layer so transforms paint live during touchmove on ios. plain
//    translate doesn't get composited reliably even with `will-change`.
//
// 3. direction is locked on the first significant movement. once the gesture
//    is identified as "down" (a pull), we preventDefault for the entire drag
//    so ios doesn't reclassify mid-gesture if dy momentarily jitters back up.
//    if first movement is "up" we ignore the gesture entirely.
//
// 4. ready / refreshing className is written via classList directly — we only
//    flip React state for `refreshing` (which controls the post-release async
//    flow) and only AFTER touchend. during the drag, React renders zero times.
//
// 5. the .ptr portal stays mounted for the component's full lifetime in
//    standalone mode (just visually hidden behind #root) so first-pull has
//    no mount-delay flash where body bg shows through before the strip paints.

const PULL_THRESHOLD = 100;    // pulled-px past which release triggers refresh
const HOLD_OFFSET    = 130;    // page translation while refreshing — deep enough
                               // for a clear "treading" pause at full extension
const MIN_HOLD_MS    = 1000;   // 1s minimum spin so the hold is visible / felt
const DIRECTION_LOCK = 4;
const REACH_MAX      = 320;    // fixed asymptote — same feel on phone + tablet.
                               // tuned to allow a meaningful "extended" pull
                               // without the gesture ever hitting a hard wall.

// transition strings for the two release animations:
//   - snap-to-hold (release → hold position): springy cubic-bezier with a small
//     overshoot, like ios native pull-to-refresh. gives the brief settle that
//     reads as "treading at the full extension".
//   - snap-back (hold → 0 after refresh): ease-out, longer than snap-to-hold,
//     so the return to default feels deliberate rather than abrupt.
const SNAP_TO_HOLD = 'transform .4s cubic-bezier(.34, 1.56, .64, 1)';
const SNAP_BACK    = 'transform .5s ease-out';

// asymptotic resistance — page tracks finger near 1:1 at first, slows
// progressively as you pull deeper, asymptotes at REACH_MAX instead of
// hitting a hard wall. formula: pulled = dy*M / (dy+M). derivative at
// dy=0 is 1, derivative at dy=M is 0.25, derivative at dy→∞ is 0 —
// smooth all the way down. fixed (not viewport-scaled) so the gesture
// feels identical on iphone and ipad — viewport-scaling made tablet
// pulls feel softer/slower than phone pulls.
const dampPull = (dy) => (dy * REACH_MAX) / (dy + REACH_MAX);

export default function PullToRefresh({ onRefresh, enabled = true }) {
  // only React state. flipped post-touchend, so it never re-renders during a
  // drag — the className-toggle happens via classList from inside touchmove.
  const [refreshing, setRefreshing] = useState(false);

  const ptrRef        = useRef(null);   // .ptr DOM node — direct className target
  const startY        = useRef(null);
  const pullRef       = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);

  // direct DOM write to #root — translate3d for compositor-accelerated paint
  // during touch. setting transform back to '' (vs 'translateY(0)') lets the
  // css default reapply cleanly when fully closed. `customTransition` lets
  // each release phase pick its own timing (springy snap-to-hold vs
  // ease-out snap-back) — defaults to a reasonable in-between for cases
  // that don't specify.
  const writeRoot = (y, instant, customTransition) => {
    const root = document.getElementById('root');
    if (!root) return;
    root.style.transition = instant ? 'none' : (customTransition || 'transform .45s ease');
    root.style.transform  = y > 0 ? `translate3d(0, ${y}px, 0)` : '';
  };

  // direct classList toggle on the .ptr indicator — avoids triggering a React
  // re-render every time we cross the threshold during a drag.
  const writePtrClass = (cls, on) => {
    const el = ptrRef.current;
    if (!el) return;
    el.classList.toggle(cls, on);
  };

  // direct opacity write — fades the spinner in as the pull progresses so it
  // doesn't pop in fully-formed on the first pixel of pull. fully visible
  // by the time the user reaches the commit threshold.
  const writePtrOpacity = (pulled) => {
    const el = ptrRef.current;
    if (!el) return;
    el.style.opacity = String(Math.min(1, pulled / PULL_THRESHOLD));
  };

  useEffect(() => {
    if (!enabled) return;

    let direction = null;  // 'down' | 'up' | null — reset each touchstart

    const onStart = (e) => {
      // touches on popups / the bottom bar / open menus aren't page pulls
      // (popups have their own swipe-down-to-close)
      const busy = e.target.closest?.('.ability-modal-overlay, .sprite-modal-overlay, .form-picker-overlay, .bottom-bar, .bottom-bar-scrim');
      if (busy || appScrollY() > 0 || refreshingRef.current) {
        startY.current = null;
        return;
      }
      startY.current  = e.touches[0].clientY;
      pullRef.current = 0;
      direction       = null;
      // willChange: 'transform' is deferred to onMove — it gets set only
      // once the gesture is identified as a downward pull (direction ===
      // 'down'). setting it here unconditionally, on every touchstart at
      // scrollTop=0, was promoting #root to a new compositor layer EVERY
      // first touch in a fresh ios standalone session. that layer-creation
      // pause interrupted the in-progress scroll mid-gesture: the user
      // would scroll ~10px, the layer would commit, ios would lose
      // ownership of the scroll, the gesture would die. releasing and
      // re-swiping found the layer already established and worked fine.
      // moving the promotion to direction-lock means regular upward
      // scrolls (the common case) never trigger the layer change.
    };

    const onMove = (e) => {
      if (startY.current == null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;

      // wait for clarity before locking direction. once locked we either own
      // the gesture's full lifetime or ignore it entirely.
      if (direction == null) {
        if (Math.abs(dy) < DIRECTION_LOCK) return;
        direction = dy > 0 ? 'down' : 'up';
        // promote #root to a compositor layer ONLY when we know the gesture
        // is a pull. transforms during touchmove only paint reliably on ios
        // when #root is composited (will-change + translate3d), so the layer
        // must exist before the first writeRoot below. setting it here vs.
        // at touchstart trades a tiny first-frame paint cost on the first
        // pull (negligible — pull animation is slow enough to mask it) for
        // not interrupting the much-more-common upward scroll gesture.
        if (direction === 'down') {
          const root = document.getElementById('root');
          if (root) root.style.willChange = 'transform';
        }
      }
      if (direction === 'up') return;

      // own the gesture from here until release, even through finger jitter.
      e.preventDefault();

      const visible  = Math.max(0, dy);
      const dampened = dampPull(visible);
      pullRef.current = dampened;

      // direct DOM updates — no React, no rAF. transform writes from inside
      // touchmove paint reliably on ios because #root is a compositor layer
      // (will-change: transform + translate3d).
      writeRoot(dampened, true);
      writePtrClass('ptr--ready', dampened >= PULL_THRESHOLD);
      writePtrOpacity(dampened);
    };

    const onEnd = async () => {
      if (startY.current == null) return;
      const finalPull = pullRef.current;
      const wasDirectionDown = direction === 'down';
      startY.current = null;
      pullRef.current = 0;
      direction = null;
      // gesture wasn't a pull (direction never locked, or was 'up') — bail
      // without touching the transform so we don't snap the page on a stray
      // tap that happened to start at the top.
      if (!wasDirectionDown) return;

      writePtrClass('ptr--ready', false);
      writePtrOpacity(0);

      if (finalPull >= PULL_THRESHOLD) {
        setRefreshing(true);
        writeRoot(HOLD_OFFSET, false, SNAP_TO_HOLD);
        const started = Date.now();
        try { await onRefresh(); } catch { /* caller handles error state */ }
        const elapsed = Date.now() - started;
        if (elapsed < MIN_HOLD_MS) {
          await new Promise(r => setTimeout(r, MIN_HOLD_MS - elapsed));
        }
        setRefreshing(false);
      }
      writeRoot(0, false, SNAP_BACK);
      // clear will-change after the snap-back transition lands. holding it
      // permanently re-establishes a containing block on #root, breaking
      // position:fixed for every modal descendant. timeout matches the
      // SNAP_BACK duration (.5s) plus a small safety margin.
      setTimeout(() => {
        const root = document.getElementById('root');
        if (root) root.style.willChange = '';
      }, 550);
    };

    window.addEventListener('touchstart',  onStart, { passive: true  });
    window.addEventListener('touchmove',   onMove,  { passive: false });
    window.addEventListener('touchend',    onEnd,   { passive: true  });
    window.addEventListener('touchcancel', onEnd,   { passive: true  });
    return () => {
      window.removeEventListener('touchstart',  onStart);
      window.removeEventListener('touchmove',   onMove);
      window.removeEventListener('touchend',    onEnd);
      window.removeEventListener('touchcancel', onEnd);
      writeRoot(0, true);
    };
  }, [enabled, onRefresh]);

  if (!enabled || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ptrRef}
      className={`ptr ${refreshing ? 'ptr--refreshing' : ''}`}
      aria-hidden="true"
    >
      <span className="ptr__icon">↻</span>
    </div>,
    document.body,
  );
}
