import { useEffect, useState } from 'react';

// phone-sized layout tier — slab phones (~390px) and the iPhone Duo folded
// (~466px). this is where the app switches to the "thumb nav" shell: header
// controls move into a floating bottom bar and their menus open as sheets.
// live: re-evaluates on resize / rotation / fold-unfold.
export const COMPACT_QUERY = '(max-width: 640px)';

export function useCompact() {
  const get = () => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches;
  const [compact, setCompact] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return compact;
}
