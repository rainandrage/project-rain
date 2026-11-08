/**
 * scrape-tcgp-accessories.js
 *
 * builds app/src/data/tcgp-accessories.json by scraping bulbagarden archives
 * (the mediawiki image repo for bulbapedia) for tcg pocket cosmetics:
 *   - profile icons / avatars
 *   - card sleeves
 *   - coins
 *   - playmats
 *   - backdrops
 *   - binder covers
 *   - emblems
 *
 * uses the mediawiki action api (returns json) — much cleaner than html
 * scraping and the same source bulbapedia uses internally so the data is
 * authoritative + always current.
 *
 * dedup: sleeves/playmats/backdrops/binder covers each ship two file variants
 * per cosmetic — the full art (`TCGP {Type} X`) and the in-game icon
 * thumbnail (`TCGP Icon {Type} X`). we keep the full-art version and let the
 * mediawiki thumb endpoint generate any size we need at render time. the
 * `drop` regex on each category filters out the icon variants.
 *
 * usage:
 *   node db/scrape-tcgp-accessories.js                   # all categories
 *   node db/scrape-tcgp-accessories.js --only icons      # one category
 *   node db/scrape-tcgp-accessories.js --thumb 300       # change thumb width (default 250)
 *   node db/scrape-tcgp-accessories.js --dry-run         # list titles without imageinfo fetch
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const API         = 'https://archives.bulbagarden.net/w/api.php';
const OUTPUT_PATH = path.join(__dirname, '../../app/src/data/tcgp-accessories.json');
const DELAY_MS    = 250;   // mediawiki recommends ~1 req/sec for unauth; we go slightly faster
const UA          = 'pokedex-scraper (https://github.com/rainandrage/project-rain)';

const CATEGORIES = [
  {
    key:    'icons',
    label:  'profile icons',
    cat:    'Pokémon_TCG_Pocket_profile_icons',
    prefix: /^File:TCGP Profile Icon /,
    drop:   null,
  },
  {
    key:    'sleeves',
    label:  'card sleeves',
    cat:    'Pokémon_TCG_Pocket_card_sleeves',
    prefix: /^File:TCGP Sleeve /,
    drop:   /^File:TCGP Icon Sleeve /,
  },
  {
    key:    'coins',
    label:  'coins',
    cat:    'Pokémon_TCG_Pocket_coins',
    prefix: /^File:TCGP Coin /,
    drop:   null,
  },
  {
    key:    'playmats',
    label:  'playmats',
    cat:    'Pokémon_TCG_Pocket_playmats',
    prefix: /^File:TCGP Playmat /,
    drop:   /^File:TCGP Icon Playmat /,
  },
  {
    key:    'backdrops',
    label:  'backdrops',
    cat:    'Pokémon_TCG_Pocket_backdrops',
    prefix: /^File:TCGP Backdrop /,
    drop:   /^File:TCGP Icon Backdrop /,
  },
  {
    key:    'binder-covers',
    label:  'binder covers',
    cat:    'Pokémon_TCG_Pocket_binder_covers',
    prefix: /^File:TCGP Cover /,
    drop:   /^File:TCGP Icon Cover /,
  },
  {
    key:    'emblems',
    label:  'emblems',
    cat:    'Pokémon_TCG_Pocket_emblems',
    prefix: /^File:TCGP Emblem /,
    drop:   null,
  },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// strip "File:..." prefix and ".png/.jpg/.webp" suffix; return cleaned display name
function cleanName(title, prefix) {
  return title.replace(prefix, '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

// stable slug for the uid — lowercase, dashes, ascii-only
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// fetch all member titles in a category, paginating if >500 items
async function fetchCategoryMembers(catName) {
  const titles = [];
  let cont = null;
  do {
    const params = {
      action:    'query',
      list:      'categorymembers',
      cmtitle:   `Category:${catName}`,
      cmtype:    'file',
      cmlimit:   500,
      format:    'json',
    };
    if (cont) Object.assign(params, cont);
    const { data } = await axios.get(API, { params, headers: { 'User-Agent': UA } });
    for (const m of data.query?.categorymembers || []) titles.push(m.title);
    cont = data.continue || null;
    await sleep(DELAY_MS);
  } while (cont);
  return titles;
}

// batch imageinfo lookups. mediawiki technically accepts up to 50 titles per
// query, but bulbagarden's cloudflare-fronted origin times out (504) or
// stalls past axios's default timeout on large-image batches (sleeves, but
// especially backdrops which are full-screen art). 10 + 60s timeout is the
// envelope that consistently completes for every category.
const BATCH_SIZE = 10;
const MAX_RETRIES = 4;
const REQ_TIMEOUT = 60000;

async function fetchImageInfoBatch(batch, thumbWidth) {
  const params = {
    action:     'query',
    titles:     batch.join('|'),
    prop:       'imageinfo',
    iiprop:     'url|size',
    iiurlwidth: thumbWidth,
    format:     'json',
  };
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data } = await axios.get(API, { params, headers: { 'User-Agent': UA }, timeout: REQ_TIMEOUT });
      return data;
    } catch (e) {
      const status = e.response?.status;
      // axios uses ECONNABORTED for its own internal timeout (the "timeout
      // of Xms exceeded" error). cloudflare returns 504/502/503 when the
      // origin stalls. all of these benefit from a fresh attempt.
      const isRetryable = status === 504 || status === 502 || status === 503
        || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED';
      if (!isRetryable || attempt === MAX_RETRIES - 1) throw e;
      const backoff = 2000 * Math.pow(2, attempt);  // 2s, 4s, 8s, 16s
      console.warn(`    [${status || e.code}] retry in ${backoff}ms…`);
      await sleep(backoff);
    }
  }
}

async function fetchImageInfo(titles, thumbWidth) {
  const out = new Map(); // title → { url, thumburl, width, height }
  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const data = await fetchImageInfoBatch(batch, thumbWidth);
    const pages = data.query?.pages || {};
    for (const p of Object.values(pages)) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      out.set(p.title, {
        url:       info.url,
        thumb_url: info.thumburl || info.url,
        width:     info.width,
        height:    info.height,
        thumb_w:   info.thumbwidth,
        thumb_h:   info.thumbheight,
        size:      info.size,
      });
    }
    await sleep(DELAY_MS);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx  = args.indexOf('--only');
  const onlyKey  = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
  const thumbIdx = args.indexOf('--thumb');
  const thumbWidth = thumbIdx !== -1 ? Number(args[thumbIdx + 1]) : 250;
  const dryRun   = args.includes('--dry-run');

  const cats = onlyKey
    ? CATEGORIES.filter(c => c.key === onlyKey)
    : CATEGORIES;
  if (!cats.length) {
    console.error(`unknown --only key. valid: ${CATEGORIES.map(c => c.key).join(', ')}`);
    process.exit(1);
  }

  const accessories = [];
  for (const cat of cats) {
    console.log(`\n[${cat.key}] ${cat.label} — Category:${cat.cat}`);
    const allTitles = await fetchCategoryMembers(cat.cat);
    console.log(`  fetched ${allTitles.length} category members`);

    // dedupe: keep only files matching the "full art" prefix; drop the
    // in-game-icon variants when applicable.
    const titles = allTitles.filter(t =>
      cat.prefix.test(t) && (!cat.drop || !cat.drop.test(t))
    );
    console.log(`  ${titles.length} after prefix filter${cat.drop ? ' + dedup' : ''}`);

    if (dryRun) {
      titles.slice(0, 10).forEach(t => console.log(`    ${t}`));
      if (titles.length > 10) console.log(`    … and ${titles.length - 10} more`);
      continue;
    }

    const info = await fetchImageInfo(titles, thumbWidth);
    let added = 0;
    for (const title of titles) {
      const i = info.get(title);
      if (!i) {
        console.warn(`    [warn] no imageinfo for ${title}`);
        continue;
      }
      const name = cleanName(title, cat.prefix);
      accessories.push({
        uid:        `${cat.key}-${slugify(name)}`,
        category:   cat.key,
        category_label: cat.label,
        name,
        image_url:  i.thumb_url,   // grid thumb
        image_full: i.url,         // modal full-res
        width:      i.width,
        height:     i.height,
        thumb_w:    i.thumb_w,
        thumb_h:    i.thumb_h,
      });
      added++;
    }
    console.log(`  ✓ ${added} items`);
  }

  if (dryRun) return;

  console.log(`\n✓ ${accessories.length} total accessories across ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(accessories, null, 2));
  console.log(`  wrote ${OUTPUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
