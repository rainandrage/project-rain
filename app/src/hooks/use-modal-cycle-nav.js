import { useCallback, useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from './use-body-scroll-lock';

// shared modal state for the item-grid pages (berries / pokeballs / badges /
// leaders / tcgp cards + accessories): which item's popup is open, Esc to
// close, and the page scroll lock while one is open. swipe down to close is
// app-wide (components/swipe-dismiss.jsx).
//
// prev/next cycling between items (arrows, ← / → keys, the pulse) was removed
// 2026-11-08 — popups are one item at a time; close and tap the next one.
// the hook keeps its name so the pages' imports don't churn.
//
//   const { current, modalRef, open, close } = useModalCycleNav(SECTIONED_ITEMS);

// initialId (optional) lets a page that arrived via cross-modal navigation
// open a specific item's modal on first render — the lookup runs inside
// useState's lazy initializer so the modal is in the DOM at the very first
// commit. that's load-bearing for the View Transitions cross-modal path:
// `flushSync(navigate)` produces a synchronous render, and the browser
// snapshots the new DOM right after. if the initial render didn't already
// have the modal open, the snapshot would land on a blank destination and
// the crossfade would lose the shared-element effect.
export function useModalCycleNav(sections, initialId = null) {
  const [selected, setSelected] = useState(() => {
    if (!initialId) return null;
    for (let s = 0; s < sections.length; s++) {
      const idx = sections[s].items.findIndex(i => i.id === initialId);
      if (idx !== -1) return { sectionIdx: s, index: idx };
    }
    return null;
  });

  const modalRef = useRef(null);

  const open  = useCallback((sectionIdx, index) => setSelected({ sectionIdx, index }), []);
  const close = useCallback(() => setSelected(null), []);

  // Esc closes; only bound while a popup is open
  useEffect(() => {
    if (!selected) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, close]);

  // lock the page's scroll while a popup is open, so taps that drift a few
  // pixels don't scroll the page underneath.
  useBodyScrollLock(!!selected);

  const current = selected
    ? sections[selected.sectionIdx].items[selected.index]
    : null;

  return { selected, current, modalRef, open, close };
}
