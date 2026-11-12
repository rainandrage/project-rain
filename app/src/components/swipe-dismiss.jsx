import { useEffect } from 'react';

// swipe down to dismiss — app-wide, for every popup that uses one of the
// shared overlays. mounted once in app.jsx; listens on document so no modal
// has to opt in.
//
// how a close happens: every overlay already closes on a click on itself
// (the modal box stops propagation), so a finished swipe slides the box off
// screen and then clicks the overlay, which runs that modal's own onClose
// and the usual backdrop fade.
//
// the gesture only belongs to us when:
//   - the touch is inside a modal box (the overlay's direct child)
//   - nothing between the finger and the box is scrolled down — a drag down
//     inside a scrolled region scrolls it back up first, like native sheets
//   - the first clear movement is downward and more vertical than sideways
//     (horizontal strips like the tcgp "other prints" row keep working)
// anything else is left to the browser untouched.

const OVERLAYS = '.ability-modal-overlay, .sprite-modal-overlay, .form-picker-overlay, .search-sheet-overlay';
const LOCK_PX = 8;          // movement before we decide whose gesture it is
const CLOSE_PX = 110;       // drag distance that closes on release
const CLOSE_VELOCITY = 0.5; // px/ms — a quick flick closes even when short

function scrolledAncestor(el, stop) {
  for (let n = el; n && n !== stop.parentElement; n = n.parentElement) {
    if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
  }
  return false;
}

export default function SwipeDismiss() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    let g = null; // active gesture

    const onStart = (e) => {
      if (e.touches.length !== 1) { g = null; return; }
      const overlay = e.target.closest?.(OVERLAYS);
      if (!overlay || overlay.classList.contains('closing')) return;
      const box = [...overlay.children].find(c => c.contains(e.target));
      if (!box || scrolledAncestor(e.target, box)) return;
      const t = e.touches[0];
      g = { overlay, box, x: t.clientX, y: t.clientY, dy: 0, t: e.timeStamp, lastY: t.clientY, lastT: e.timeStamp, v: 0, mode: null };
    };

    const onMove = (e) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (g.mode == null) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
        if (dy > 0 && dy > Math.abs(dx)) {
          g.mode = 'drag';
          g.box.style.transition = 'none';
          g.box.style.animation = 'none'; // drop any finished open/pulse anim so transform applies
        } else { g = null; return; }
      }
      e.preventDefault(); // own it — no page or rubber-band scroll underneath
      // slight resistance past the close point, never upward past rest
      const d = Math.max(0, dy);
      const shown = d < CLOSE_PX ? d : CLOSE_PX + (d - CLOSE_PX) * 0.6;
      g.dy = d;
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) g.v = (t.clientY - g.lastY) / dt;
      g.lastY = t.clientY; g.lastT = e.timeStamp;
      g.box.style.transform = `translateY(${shown}px)`;
      g.overlay.style.setProperty('--swipe-p', String(Math.min(1, d / (CLOSE_PX * 2.5))));
    };

    const onEnd = () => {
      if (!g) return;
      const { box, overlay, dy, v, mode } = g;
      g = null;
      if (mode !== 'drag') return;
      if (dy > CLOSE_PX || (v > CLOSE_VELOCITY && dy > 30)) {
        box.style.transition = 'transform .22s ease-in, opacity .22s ease-in';
        box.style.transform = `translateY(${Math.max(window.innerHeight, 600)}px)`;
        box.style.opacity = '0';
        overlay.style.setProperty('--swipe-p', '1');
        overlay.click(); // the modal's own close (backdrop fades meanwhile)
      } else {
        box.style.transition = 'transform .3s cubic-bezier(.34, 1.4, .64, 1)';
        box.style.transform = '';
        overlay.style.removeProperty('--swipe-p');
        const clear = () => { box.style.transition = ''; box.removeEventListener('transitionend', clear); };
        box.addEventListener('transitionend', clear);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  return null;
}
