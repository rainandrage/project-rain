// centralized localStorage access for every persisted UI preference. before this,
// six different files spelled their keys as raw strings with inconsistent
// boolean encoding (some `=== 'true'`, some falsy checks) and ad-hoc try/catch
// wrappers around JSON.parse. one renamed key used to mean a hunt across files.

export const STORAGE_KEYS = {
  THEME:         'theme',
  A11Y:          'a11y',
  SHINY_SPRITES: 'shinySprites',
  RETRO_SPRITES: 'retroSprites',
  INLINE_FORMS:  'inlineForms',
  NAV_EXPANDED:  'navExpanded',  // {[label]: boolean} per labeled nav section
  FILTERS_OPEN:  'filtersOpen',  // boolean — mobile filter panel expanded/collapsed
  RECENT_SEARCHES: 'recentSearches', // string[] — phone search sheet's recent queries, newest first
  XFADE_MODE:    'xfadeMode',    // cross-modal nav transition: 'snap' | 'view' | 'dip' | 'curtain' — mockup only
};

// -- string ------------------------------------------------------------------

export function getString(key, fallback = '') {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v;
}

export function setString(key, value) {
  if (value == null || value === '') localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

// -- boolean (stored as 'true' / 'false' strings) ----------------------------

export function getBool(key, fallback = false) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

export function setBool(key, value) {
  localStorage.setItem(key, value ? 'true' : 'false');
}

// -- JSON --------------------------------------------------------------------

export function getJSON(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const parsed = JSON.parse(v);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function setJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
