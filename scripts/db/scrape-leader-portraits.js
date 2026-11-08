/**
 * scrape-leader-portraits.js
 * for each entry in app/src/data/gym-leaders.json, pulls a recent official
 * trainer portrait from that leader's bulbagarden archives category and
 * resolves the file URL. saves to a `portrait_url` field on each leader.
 *
 * picks "<Game> <Leader>.png" matching the newest mainline game the leader
 * has art for, walking GAME_PREFIXES_BY_RECENCY top-down. produces uniform
 * "most recent official artwork" coverage:
 *   - paldea leaders   → Scarlet Violet <Leader>.png
 *   - galar leaders    → Sword Shield <Leader>.png
 *   - kanto leaders    → Lets Go Pikachu Eevee <Leader>.png
 *   - johto leaders    → HeartGold SoulSilver <Leader>.png
 *   - hoenn leaders    → Omega Ruby Alpha Sapphire <Leader>.png
 *   - sinnoh leaders   → Brilliant Diamond Shining Pearl <Leader>.png
 *                        (or Diamond Pearl if BDSP not present)
 *   - unova leaders    → Black 2 White 2 <Leader>.png (or BW)
 *   - kalos leaders    → X Y <Leader>.png
 *
 * leaves the existing `sprite` field untouched so the page can fall back if
 * portrait_url is null (a leader without any matching game art).
 *
 * usage:
 *   node db/scrape-leader-portraits.js                  # all leaders
 *   node db/scrape-leader-portraits.js --dry-run        # print, don't write
 *   node db/scrape-leader-portraits.js --debug          # show all candidates
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const ARCHIVES_API = 'https://archives.bulbagarden.net/w/api.php';
const OUT_PATH     = path.join(__dirname, '../../app/src/data/gym-leaders.json');
const UA           = 'pokedex-data-scraper/1.0 (https://github.com/rainandrage/project-rain)';
const DELAY_MS     = 350;

// ordered newest → oldest. each entry is the canonical filename prefix used
// by bulbagarden archives for that game's trainer artwork. when checking
// candidate files, walk this list top-down and stop at the first match —
// produces "newest game the leader appears in" coverage automatically.
// archives uses inconsistent prefixes — sometimes the full title ("Sword
// Shield"), sometimes an abbreviation ("XY", "ZA"). canonical filename
// pattern is "<Prefix> <Leader>.png". recency order matters: walk top
// to bottom, first match wins. ZA (Pokémon Legends Z-A) is gen 9 era
// and predates Scarlet/Violet for the kalos sub-set of leaders that
// reappear there.
const GAME_PREFIXES_BY_RECENCY = [
  'Scarlet Violet',
  'ZA',                                      // Pokémon Legends Z-A (Kalos)
  'Sword Shield',
  'Brilliant Diamond Shining Pearl',
  'Legends Arceus',
  'Lets Go Pikachu Eevee',
  'Ultra Sun Ultra Moon',
  'Sun Moon',
  'Omega Ruby Alpha Sapphire',
  'XY',                                      // Pokémon X/Y (no space — archive convention)
  'Black 2 White 2',
  'Black White',
  'HeartGold SoulSilver',
  'Platinum',
  'Diamond Pearl',
  'Emerald',
  'Ruby Sapphire',
  'FireRed LeafGreen',
  'Crystal',
  'Gold Silver',
  'Yellow',
  'Red Blue',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const out = { dryRun: false, debug: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--dry-run') out.dryRun = true;
    else if (a[i] === '--debug') out.debug = true;
  }
  return out;
}

// fetch up to `limit` files from a category, ordered alphabetically.
async function fetchCategoryFiles(categoryTitle, limit = 200) {
  await sleep(DELAY_MS);
  const { data } = await axios.get(ARCHIVES_API, {
    params: {
      action:  'query',
      list:    'categorymembers',
      cmtitle: `Category:${categoryTitle}`,
      cmtype:  'file',
      cmlimit: limit,
      cmsort:  'sortkey',
      format:  'json',
    },
    headers: { 'user-agent': UA },
  });
  return (data?.query?.categorymembers || [])
    .map(m => m.title.replace(/^File:/, ''));
}

async function resolveFileUrl(fileTitle) {
  await sleep(DELAY_MS);
  const { data } = await axios.get(ARCHIVES_API, {
    params: {
      action: 'query',
      titles: `File:${fileTitle}`,
      prop:   'imageinfo',
      iiprop: 'url|size',
      format: 'json',
    },
    headers: { 'user-agent': UA },
  });
  const pages = data?.query?.pages || {};
  const first = Object.values(pages)[0];
  const info = first?.imageinfo?.[0];
  return info ? { url: info.url, width: info.width, height: info.height } : null;
}

// derive the variants of a leader's name to try as both the category title
// and the suffix in "<Game> <Leader>.png". archives uses different formats
// across files (Tate Liza vs Liza & Tate vs Liza and Tate, etc).
function leaderNameVariants(leader) {
  const base = leader.page_title.replace(/\s*\([^)]+\)\s*$/, '');  // strip "(game)"
  const v = [base];
  if (base === 'Tate and Liza')   v.push('Liza & Tate', 'Liza and Tate', 'Tate Liza', 'Liza Tate');
  if (base === 'Lt. Surge')       v.push('Lt Surge');
  return [...new Set(v)];
}

// candidate categories — same as before, in case the archives uses a
// different category name than the bulbapedia page title.
function categoryCandidates(leader) {
  const cands = [leader.page_title];
  cands.push(leader.page_title.replace(/\s*\([^)]+\)\s*$/, ''));
  if (leader.page_title === 'Tate and Liza') cands.push('Liza and Tate', 'Tate & Liza');
  if (leader.page_title === 'Lt. Surge')     cands.push('Lt Surge');
  return [...new Set(cands)];
}

// pick the best portrait file from a category's file list. walks the game
// recency list and returns the first matching "<Game> <Leader>.png".
// returns { file, game } or null if no game art is found.
function pickPortrait(files, leader) {
  const nameVariants = leaderNameVariants(leader);
  for (const game of GAME_PREFIXES_BY_RECENCY) {
    for (const name of nameVariants) {
      const target = `${game} ${name}.png`;
      if (files.includes(target)) return { file: target, game };
    }
  }
  return null;
}

async function main() {
  const opts = parseArgs();
  const leaders = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
  const uniqueTitles = [...new Set(leaders.map(l => l.page_title))];
  console.log(`fetching portrait candidates for ${uniqueTitles.length} unique leaders...`);

  const portraitByTitle = new Map();
  let i = 0;
  for (const title of uniqueTitles) {
    i++;
    const stub = leaders.find(l => l.page_title === title);

    // try each candidate category until we get a non-empty file list.
    let files = [];
    let triedCategory = null;
    for (const cand of categoryCandidates(stub)) {
      try {
        const f = await fetchCategoryFiles(cand);
        if (f.length) { files = f; triedCategory = cand; break; }
      } catch (e) {
        // continue to next candidate on transient errors
      }
    }
    if (!files.length) {
      console.warn(`  [${i}/${uniqueTitles.length}] ${title} — no category match`);
      portraitByTitle.set(title, null);
      continue;
    }

    const pick = pickPortrait(files, stub);
    if (!pick) {
      console.warn(`  [${i}/${uniqueTitles.length}] ${title.padEnd(28)} — no game-prefixed art (${files.length} files)`);
      if (opts.debug) {
        files.slice(0, 10).forEach(f => console.warn(`        candidate: ${f}`));
      }
      portraitByTitle.set(title, null);
      continue;
    }

    let resolved = null;
    try {
      resolved = await resolveFileUrl(pick.file);
    } catch (e) {
      console.warn(`  [${i}/${uniqueTitles.length}] ${title} — resolve failed: ${e.message}`);
    }

    portraitByTitle.set(title, resolved ? {
      url:        resolved.url,
      file_name:  pick.file,
      game:       pick.game,
      category:   triedCategory,
      width:      resolved.width,
      height:     resolved.height,
    } : null);
    console.log(`  [${i}/${uniqueTitles.length}] ${title.padEnd(28)} → [${pick.game}] ${pick.file}`);
  }

  for (const l of leaders) {
    const portrait = portraitByTitle.get(l.page_title);
    if (portrait) {
      l.portrait_url  = portrait.url;
      l.portrait_meta = {
        file_name: portrait.file_name,
        game:      portrait.game,
        category:  portrait.category,
        width:     portrait.width,
        height:    portrait.height,
      };
    } else {
      l.portrait_url  = null;
      l.portrait_meta = null;
    }
  }

  if (opts.dryRun) {
    console.log('\n--- DRY RUN: first 5 records ---');
    console.log(JSON.stringify(leaders.slice(0, 5), null, 2));
    return;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(leaders, null, 2));
  const hits = leaders.filter(l => l.portrait_url).length;
  const misses = leaders.filter(l => !l.portrait_url).map(l => l.name);
  console.log(`\ndone. ${hits}/${leaders.length} records have portrait_url. written to ${OUT_PATH}`);
  if (misses.length) {
    console.log(`misses (${misses.length}): ${misses.join(', ')}`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
