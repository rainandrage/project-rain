/**
 * scrape-leader-thumbs.js
 * for each entry in app/src/data/gym-leaders.json, pulls the Pokémon Masters
 * EX VS portrait — the most uniform "headshot" available across leaders.
 * pattern: `VS<Name> Masters.png` on bulbagarden archives.
 *   - "Brock"          → VSBrock Masters.png
 *   - "Lt. Surge"      → VSLt Surge Masters.png   (strip periods)
 *   - "Crasher Wake"   → VSCrasher Wake Masters.png  (keep spaces)
 *   - "Tate and Liza"  → VSTate Masters.png       (duo gets one slot)
 *   - "Blue (game)"    → VSBlue Masters.png       (strip disambiguator)
 *
 * Masters EX is the only product line with consistent character art for
 * nearly every gym leader — same illustrator pool, same framing (head +
 * upper torso, neutral pose), same resolution. uniform thumbnail style
 * across the grid in a way that VS portraits from the games never could
 * (those are split across 9 generations of art direction).
 *
 * leaders with no Masters EX portrait yet (Wattson, Juan, Byron, Drayden,
 * Opal, Katy, Kofu, Ryme, Tulip — typically not-yet-synced or duo halves)
 * fall back to their portrait_url (most-recent-game full-body art) so the
 * grid stays 100%-populated visually.
 *
 * usage:
 *   node db/scrape-leader-thumbs.js                  # all leaders
 *   node db/scrape-leader-thumbs.js --dry-run        # print, don't write
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const ARCHIVES_API = 'https://archives.bulbagarden.net/w/api.php';
const OUT_PATH     = path.join(__dirname, '../../app/src/data/gym-leaders.json');
const UA           = 'pokedex-data-scraper/1.0 (https://github.com/rainandrage/project-rain)';
const DELAY_MS     = 250;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const out = { dryRun: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--dry-run') out.dryRun = true;
  }
  return out;
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
  const first = Object.values(data?.query?.pages || {})[0];
  const info = first?.imageinfo?.[0];
  return info ? { url: info.url, width: info.width, height: info.height } : null;
}

// build the candidate filename(s) for a leader's Masters EX VS portrait.
// most leaders resolve in one shot; duos and disambiguated entries get
// extra fallbacks so we can chain through them and accept the first hit.
function thumbCandidates(leader) {
  const baseName = leader.page_title
    .replace(/\s*\([^)]+\)\s*$/, '')   // drop "(game)" disambiguator
    .replace(/\./g, '');               // drop periods (Lt. Surge → Lt Surge)
  const cands = [`VS${baseName} Masters.png`];
  // duo entries — use the first half's portrait. picking one gives the
  // grid a single representative thumb instead of falling back to full
  // body art that's wider than the rest of the row.
  if (baseName === 'Tate and Liza') cands.push('VSTate Masters.png', 'VSLiza Masters.png');
  return cands;
}

async function main() {
  const opts = parseArgs();
  const leaders = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
  const uniqueTitles = [...new Set(leaders.map(l => l.page_title))];
  console.log(`probing Masters EX VS portraits for ${uniqueTitles.length} unique leaders...`);

  const thumbByTitle = new Map();
  let i = 0;
  for (const title of uniqueTitles) {
    i++;
    const stub = leaders.find(l => l.page_title === title);
    let resolved = null;
    let matched  = null;
    for (const fn of thumbCandidates(stub)) {
      try {
        const r = await resolveFileUrl(fn);
        if (r) { resolved = r; matched = fn; break; }
      } catch (e) {
        // continue to next variant
      }
    }
    if (resolved) {
      console.log(`  [${i}/${uniqueTitles.length}] ${title.padEnd(28)} → ${matched}`);
      thumbByTitle.set(title, { url: resolved.url, file_name: matched, width: resolved.width, height: resolved.height });
    } else {
      console.warn(`  [${i}/${uniqueTitles.length}] ${title.padEnd(28)} — no Masters EX portrait (will fall back to portrait_url)`);
      thumbByTitle.set(title, null);
    }
  }

  // apply thumb_url. miss → null (page falls back to portrait_url).
  for (const l of leaders) {
    const thumb = thumbByTitle.get(l.page_title);
    l.thumb_url  = thumb?.url || null;
    l.thumb_meta = thumb ? {
      file_name: thumb.file_name,
      width:     thumb.width,
      height:    thumb.height,
    } : null;
  }

  if (opts.dryRun) {
    console.log('\n--- DRY RUN: first 5 records ---');
    console.log(JSON.stringify(leaders.slice(0, 5), null, 2));
    return;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(leaders, null, 2));
  const hits = leaders.filter(l => l.thumb_url).length;
  const misses = leaders.filter(l => !l.thumb_url).map(l => l.name);
  console.log(`\ndone. ${hits}/${leaders.length} records have thumb_url. written to ${OUT_PATH}`);
  if (misses.length) {
    console.log(`misses (${misses.length}): ${[...new Set(misses)].join(', ')}`);
    console.log('  → these will use portrait_url for both thumb and modal hero.');
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
