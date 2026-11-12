import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Img from './img';

// ─── SpriteCarousel ──────────────────────────────────────────────────────────
// the pokémon page's artwork: ONE image at a time, cycling through the
// variants (default / shiny, or ♂ / ♀ / shiny ♂ / shiny ♀). small ‹ › on the
// edges, or swipe sideways. gender + shiny badges sit under the image. tap the
// image to open the full-size viewer (SpriteModal) at the same variant.
//
// swiping drags the image with your finger, the neighbor sliding in beside
// it; let go past ~a fifth of the width (or flick) and it carries on to the
// next variant, otherwise it springs back. the arrows play the same slide.
//
// the stage is a fixed size and every variant is stacked inside it (only the
// current one visible), so switching variants — or forms, or pokémon — never
// changes the page's height. that's what kept nudging the scroll position.
//
// `slots`: [{ src, gender: 'male'|'female'|null, shiny: bool }]
// `index` / `onIndex`: controlled, so the page and the viewer stay in sync.

export function useSlotIndex(slots) {
  // keep the same variant (e.g. shiny ♀) across form / pokémon changes when
  // the new set has it; otherwise fall back to the first.
  const [index, setIndex] = useState(0);
  const prevRef = useRef(null);
  const key = slots.map(s => s.src).join('|');
  useEffect(() => {
    const prev = prevRef.current;
    if (prev) {
      const same = slots.findIndex(s => (s.gender || null) === (prev.gender || null) && !!s.shiny === !!prev.shiny);
      setIndex(same >= 0 ? same : 0);
    } else {
      setIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const safe = Math.min(index, Math.max(0, slots.length - 1));
  useEffect(() => { prevRef.current = slots[safe] || null; });
  return [safe, setIndex];
}

export function SlotBadges({ slot, className = '', shinyIcon = null }) {
  if (!slot) return null;
  return (
    <div className={`slot-badges ${className}`}>
      {/* trailing U+FE0E forces text-style ♂/♀ (ios otherwise swaps in a
          tall color emoji that overflows the pill) */}
      {slot.gender === 'male'   && <span className="slot-badge slot-badge--male" aria-label="male">{'♂︎'}</span>}
      {slot.gender === 'female' && <span className="slot-badge slot-badge--female" aria-label="female">{'♀︎'}</span>}
      {slot.shiny && (
        <span className={`slot-badge slot-badge--shiny${shinyIcon ? ' slot-badge--icon' : ''}`} aria-label="shiny" title="shiny">
          {shinyIcon || 'shiny'}
        </span>
      )}
    </div>
  );
}

// drag-to-slide between variants. `index` / `onIndex` stay the source of
// truth; this only owns the in-between offset (`dx`). a step sets the new
// index AND an offset that puts the new image exactly where the finger left
// it, then animates that offset to 0 — so the motion is continuous whether
// it came from a drag or an arrow tap.
// slower, gentle ease-out — glides into place rather than snapping
const SLIDE_MS = 500;
const SLIDE = `transform ${SLIDE_MS}ms cubic-bezier(.25, .8, .3, 1)`;
const LOCK_PX = 8;

export function useSlide({ total, index, onIndex }) {
  const stageRef = useRef(null);
  const wRef = useRef(300);
  const g = useRef(null);
  const dragged = useRef(false);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  // drag moves arrive faster than frames on some phones — apply at most one
  // offset per frame so the image tracks the finger smoothly
  const raf = useRef(0);
  const pending = useRef(0);
  const dragTo = (x) => {
    pending.current = x;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; setDx(pending.current); });
  };
  const cancelDrag = () => { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; } };

  // the image sliding OUT (after a step) or the half-revealed neighbor
  // sliding back (after a short drag) has to stay rendered until its slide
  // finishes — otherwise it vanishes before it clears the edge. it rides at
  // `dx + off` until the slide is over.
  const [leaving, setLeaving] = useState(null); // { i, off }
  const leaveTimer = useRef(0);
  const keepLeaving = (i, off) => {
    clearTimeout(leaveTimer.current);
    setLeaving({ i, off });
    leaveTimer.current = setTimeout(() => setLeaving(null), SLIDE_MS + 60);
  };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const measure = () => { if (stageRef.current) wRef.current = stageRef.current.offsetWidth || wRef.current; return wRef.current; };
  useLayoutEffect(() => { measure(); });

  // jump to an offset without animating, then (after a paint) glide to 0
  const settleFrom = (from) => {
    setAnim(false);
    setDx(from);
    requestAnimationFrame(() => requestAnimationFrame(() => { setAnim(true); setDx(0); }));
  };

  const step = (d, fromDx = 0) => {
    if (total < 2) return;
    const W = measure();
    keepLeaving(index, d > 0 ? -W : W);
    onIndex((index + d + total) % total);
    settleFrom(d > 0 ? fromDx + W : fromDx - W);
  };

  const springBack = () => {
    const W = wRef.current;
    if (dx < 0) keepLeaving((index + 1) % total, W);
    else if (dx > 0) keepLeaving((index - 1 + total) % total, -W);
    setAnim(true); setDx(0);
  };

  const handlers = {
    onPointerDown: (e) => {
      dragged.current = false;
      if (total < 2) return;
      g.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.timeStamp, mode: null };
    },
    onPointerMove: (e) => {
      const s = g.current;
      if (!s) return;
      const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
      if (!s.mode) {
        if (Math.abs(ddx) > LOCK_PX && Math.abs(ddx) > Math.abs(ddy)) {
          s.mode = 'drag';
          measure();
          setAnim(false);
          try { e.currentTarget.setPointerCapture(s.id); } catch { /* fine */ }
        } else if (Math.abs(ddy) > LOCK_PX) { g.current = null; return; }
        else return;
      }
      dragTo(ddx);
    },
    onPointerUp: (e) => {
      const s = g.current;
      g.current = null;
      if (!s || s.mode !== 'drag') return;
      cancelDrag();
      dragged.current = true;
      const ddx = e.clientX - s.x;
      const v = ddx / Math.max(1, e.timeStamp - s.t); // px/ms
      if (Math.abs(ddx) > wRef.current * 0.22 || Math.abs(v) > 0.45) step(ddx < 0 ? 1 : -1, ddx);
      else springBack();
    },
    onPointerCancel: () => { if (g.current?.mode === 'drag') { cancelDrag(); springBack(); } g.current = null; },
  };

  // where each stacked variant sits: the current one follows the finger, the
  // neighbor on the side being revealed rides alongside; the rest hide.
  const slotStyle = (i) => {
    const W = wRef.current;
    const prev = (index - 1 + total) % total;
    const next = (index + 1) % total;
    let x = null;
    if (i === index) x = dx;
    else if (leaving && i === leaving.i) x = dx + leaving.off;
    else if (dx < 0 && i === next) x = dx + W;
    else if (dx > 0 && i === prev) x = dx - W;
    if (x === null) return { visibility: 'hidden' };
    return { transform: `translate3d(${x}px, 0, 0)`, transition: anim ? SLIDE : 'none' };
  };

  // a drag shouldn't also count as a tap on the image
  const wasDrag = () => { const d = dragged.current; dragged.current = false; return d; };

  return { stageRef, handlers, slotStyle, step, wasDrag };
}

export default function SpriteCarousel({ slots, index, onIndex, onOpen, alt, retro = false, footer = null, shinyIcon = null }) {
  const total = slots.length;
  const { stageRef, handlers, slotStyle, step, wasDrag } = useSlide({ total, index, onIndex });
  const slot = slots[index];

  return (
    <div className="sprite-carousel">
      <div className="sprite-carousel__stage" ref={stageRef} {...handlers}>
        <button
          type="button"
          // press-js: no global press-shrink — it fought the drag (jitter)
          className="sprite-carousel__view press-js"
          onClick={() => { if (!wasDrag()) onOpen(index); }}
          aria-label={`view ${alt} full size`}
        >
          {slots.map((s, i) => (
            <Img
              key={s.src + i}
              src={s.src}
              alt={i === index ? alt : ''}
              wrapClassName="sprite-carousel__slot"
              style={slotStyle(i)}
              className={`sprite-carousel__img${retro && !s.shiny ? ' is-retro' : ''}`}
              draggable={false}
            />
          ))}
        </button>
        {total > 1 && (
          <>
            <button type="button" className="sprite-carousel__arrow sprite-carousel__arrow--prev" onClick={() => step(-1)} aria-label="previous variant">‹</button>
            <button type="button" className="sprite-carousel__arrow sprite-carousel__arrow--next" onClick={() => step(1)} aria-label="next variant">›</button>
          </>
        )}
      </div>

      {/* fixed-height row so a variant without badges doesn't shift things */}
      <div className="sprite-carousel__meta">
        <SlotBadges slot={slot} shinyIcon={shinyIcon} />
        {total > 1 && (
          <div className="sprite-carousel__dots" aria-hidden="true">
            {slots.map((_, i) => <span key={i} className={`sprite-carousel__dot${i === index ? ' is-on' : ''}`} />)}
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}
