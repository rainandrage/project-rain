/**
 * scrape-tcg-pocket.js
 *
 * builds app/src/data/tcg-pocket.json by combining two sources:
 *   1. flibustier/pokemon-tcg-pocket-database (github, MIT) — the card index:
 *      which cards exist in which set, with their number, name, rarity, packs,
 *      evolves-from. flibustier's stat fields (hp/element/stage) are unreliable
 *      (every pokémon shows hp:50) so we ignore them.
 *   2. pocket.limitlesstcg.com per-card pages — canonical stats: hp, element,
 *      stage, weakness, retreat, attacks, ability, illustrator, flavor text.
 *      scraped at ~1 req/sec, cached idempotently in tcgp-card-cache.json so
 *      reruns only fetch new cards.
 *
 * images come from limitless's digitalocean cdn — urls composed from set +
 * number. thumb (`_EN_SM.webp` ~25KB) for the grid, full (`_EN.png` 670×936)
 * for the detail modal, with a render-time fallback to the 367px `_EN.webp`
 * for newer sets (B3a/B3b onward) whose full png isn't uploaded yet.
 *
 * usage:
 *   node db/scrape-tcg-pocket.js                  # all sets
 *   node db/scrape-tcg-pocket.js --set A1         # one set
 *   node db/scrape-tcg-pocket.js --set A1 --limit 5   # first 5 cards (smoke test)
 *   node db/scrape-tcg-pocket.js --force          # re-scrape cached cards
 *   node db/scrape-tcg-pocket.js --dry-run        # list cards without scraping
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const FLIB_BASE   = 'https://raw.githubusercontent.com/flibustier/pokemon-tcg-pocket-database/main/dist';
const LIMIT_BASE  = 'https://pocket.limitlesstcg.com';
const LIMIT_CDN   = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';
const OUTPUT_PATH = path.join(__dirname, '../../app/src/data/tcg-pocket.json');
const CACHE_PATH  = path.join(__dirname, 'tcgp-card-cache.json');
const DELAY_MS    = 700;   // throttle limitless requests; ~1.4 req/sec
const UA          = 'Mozilla/5.0 (compatible; pokedex-scraper)';

// limitless serves promos under different set codes than flibustier: flibustier
// labels them PROMO-A / PROMO-B, but limitless (both the per-card detail pages
// AND the image CDN) uses P-A / P-B. compose every limitless url from the mapped
// code; the stored `set` (used for grouping + the set name) stays on flibustier's
// code so nothing else in the app has to know about the alias. this mismatch —
// not a 404 block — is why promos never imported before.
const LIMITLESS_CODE = { 'PROMO-A': 'P-A', 'PROMO-B': 'P-B', 'PROMO-C': 'P-C' };
const limitCode = (code) => LIMITLESS_CODE[code] || code;

// sets limitless doesn't carry at all (no detail pages, cdn 403s). their stats
// come from serebii's per-card pages instead (value = serebii set slug, e.g.
// serebii.net/tcgpocket/firstpartners/001.shtml), and their images are
// self-hosted under app/public/assets/tcgp/<SET>/<number>.webp — copied by hand
// from flibustier's release zip (dist/images/cards-by-set/<SET>/), which is the
// only place those images exist. image urls for these sets are stored RELATIVE
// ("assets/tcgp/SP1/1.webp"); the page prefixes vite's BASE_URL at render time.
const SEREBII_BASE = 'https://www.serebii.net/tcgpocket';
const SEREBII_SETS = { SP1: 'firstpartners' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pad3(n)   { return String(n).padStart(3, '0'); }

// metadata-only card detail — used when a card's limitless detail page 404s (or
// is unparseable). the grid still renders the art (CDN urls are composed, not
// scraped) and the modal is just sparse. mainly hits the odd promo whose number
// limitless doesn't host a page for.
function stubDetails() {
  return {
    hp: null, element: null, card_type: null, stage: null, evolves_from: null,
    weakness: null, retreat: null, attacks: [], ability: null,
    illustrator: null, flavor_text: null,
  };
}

function cdnThumbUrl(set, number) {
  return `${LIMIT_CDN}/pocket/${set}/${set}_${pad3(number)}_EN_SM.webp`;
}
// full-res 670×936 png for the detail modal. NOTE: some newer sets (B3a/B3b
// onward) don't have this png uploaded to the cdn yet — the url 403s and only
// the 367px `_EN.webp` exists. the modal handles that at render time by
// falling back from this png to the webp variant (see the fullImageFallback
// helper / <Img fallbackSrc>), so we keep composing the higher-res png here.
function cdnFullUrl(set, number) {
  return `${LIMIT_CDN}/pocket/${set}/${set}_${pad3(number)}_EN.png`;
}

// strip html tags + collapse whitespace + decode common entities
function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// extract the first capture group from a regex; returns null on miss.
function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

// parse one limitless card page → normalized card detail object.
// returns null on a fundamentally unparseable page (network ok, structure wrong).
function parseCardHtml(html) {
  // primary card section — anything outside it is chrome/ads/related
  const main = html.match(/<section class="card-page-main">([\s\S]*?)<\/section>/);
  if (!main) return null;
  const body = main[1];

  // ---- title block: name, element, hp ----
  const titleHtml = pick(body, /<p class="card-text-title">([\s\S]*?)<\/p>/);
  const titleText = stripHtml(titleHtml || '');
  // pattern for pokemon: "{name} - {Element} - {hp} HP"
  // pattern for trainer: "{name}" only
  const hpMatch      = titleText.match(/-\s*(\d+)\s*HP/);
  const elementMatch = titleText.match(/-\s*([A-Za-z]+)\s*-\s*\d+\s*HP/);
  const hp      = hpMatch      ? Number(hpMatch[1])         : null;
  const element = elementMatch ? elementMatch[1].toLowerCase() : null;

  // ---- type block: "Pokémon - Stage 2 - Evolves from {name}" or "Trainer - Item" etc. ----
  const typeHtml = pick(body, /<p class="card-text-type">([\s\S]*?)<\/p>/) || '';
  const typeText = stripHtml(typeHtml);
  let cardType = 'pokemon';     // pokemon | item | tool | supporter | fossil | stadium
  let stage    = null;          // basic | 1 | 2 | null (non-pokemon)

  if (/^Pok[eé]mon/i.test(typeText)) {
    cardType = 'pokemon';
    if (/Basic/i.test(typeText))            stage = 'basic';
    else if (/Stage\s*(\d+)/i.test(typeText)) stage = Number(typeText.match(/Stage\s*(\d+)/i)[1]);
  } else if (/Item/i.test(typeText))       cardType = 'item';
  else if (/Pok[eé]mon Tool/i.test(typeText)) cardType = 'tool';
  else if (/Supporter/i.test(typeText))    cardType = 'supporter';
  else if (/Fossil/i.test(typeText))       cardType = 'fossil';
  else if (/Stadium/i.test(typeText))      cardType = 'stadium';

  // evolves-from is only present on stage-1+ pokemon; pulled from a link in the type block
  const evolvesFrom = pick(typeHtml, /Evolves from\s*<a[^>]*>([\s\S]*?)<\/a>/);

  // ---- attacks ----
  const attacks = [];
  const attackBlocks = body.matchAll(/<div class="card-text-attack">([\s\S]*?)<\/div>/g);
  for (const m of attackBlocks) {
    const block   = m[1];
    const cost    = pick(block, /<span class="ptcg-symbol">([^<]*)<\/span>/) || '';
    const infoHtml = pick(block, /<p class="card-text-attack-info">([\s\S]*?)<\/p>/) || '';
    // strip the cost span out of info before extracting name/damage
    const infoText = stripHtml(infoHtml.replace(/<span class="ptcg-symbol">[^<]*<\/span>/, ''));
    // info text is "{Attack Name} {damage?}" — damage is optional and can be e.g. "60", "200+", "20×"
    const dmgMatch = infoText.match(/\s+(\d+[+×x]?)\s*$/);
    const damage   = dmgMatch ? dmgMatch[1] : '';
    const name     = dmgMatch ? infoText.slice(0, dmgMatch.index).trim() : infoText;
    const effectHtml = pick(block, /<p class="card-text-attack-effect">([\s\S]*?)<\/p>/) || '';
    const effect     = stripHtml(effectHtml);
    attacks.push({
      cost: cost.split('').filter(Boolean), // "RCC" → ["R","C","C"]
      name,
      damage,
      effect,
    });
  }

  // ---- ability (when present) ----
  let ability = null;
  const abilityBlock = body.match(/<div class="card-text-ability">([\s\S]*?)<\/div>/);
  if (abilityBlock) {
    const aHtml = abilityBlock[1];
    const aName = stripHtml(pick(aHtml, /<p class="card-text-ability-info">([\s\S]*?)<\/p>/) || '');
    const aEffect = stripHtml(pick(aHtml, /<p class="card-text-ability-effect">([\s\S]*?)<\/p>/) || '');
    if (aName || aEffect) ability = { name: aName, effect: aEffect };
  }

  // ---- weakness + retreat ----
  // multiple .card-text-wrr blocks exist (weakness/retreat AND ex-rule). pick the
  // one that actually starts with "Weakness:".
  let weakness = null;
  let retreat  = null;
  const wrrBlocks = body.matchAll(/<p class="card-text-wrr">([\s\S]*?)<\/p>/g);
  for (const m of wrrBlocks) {
    const text = stripHtml(m[1]);
    if (/Weakness:/i.test(text)) {
      weakness = (text.match(/Weakness:\s*([A-Za-z]+)/) || [])[1] || null;
      const r  = (text.match(/Retreat:\s*(\d+)/)        || [])[1];
      retreat  = r != null ? Number(r) : null;
      break;
    }
  }
  if (weakness) weakness = weakness.toLowerCase();

  // ---- illustrator ----
  const artistHtml = pick(body, /<div class="card-text-section card-text-artist">([\s\S]*?)<\/div>/);
  const illustrator = artistHtml
    ? stripHtml(pick(artistHtml, /<a[^>]*>([\s\S]*?)<\/a>/) || stripHtml(artistHtml))
    : null;

  // ---- flavor text (often missing on pokemon cards; common on trainer cards) ----
  const flavorText = stripHtml(
    pick(body, /<div class="card-text-section card-text-flavor">([\s\S]*?)<\/div>/) || ''
  ) || null;

  return {
    hp,
    element,
    card_type: cardType,
    stage,
    evolves_from: evolvesFrom,
    attacks,
    ability,
    weakness,
    retreat,
    illustrator,
    flavor_text: flavorText,
  };
}

// serebii energy icon basename → the single-letter cost codes limitless uses
const SEREBII_ENERGY = {
  grass: 'G', fire: 'R', water: 'W', lightning: 'L', psychic: 'P',
  fighting: 'F', darkness: 'D', metal: 'M', colorless: 'C', dragon: 'N', electric: 'L',
};
// serebii names a few types differently than the rest of the data
const SEREBII_TYPE = { electric: 'lightning' };
const serebiiType = (t) => (t ? SEREBII_TYPE[t] || t : null);

// parse one serebii tcgpocket card page → same detail shape as parseCardHtml.
// only covers pokémon cards (all that serebii-backed sets contain so far);
// stage isn't printed on serebii, so the caller fills it from flibustier.
function parseSerebiiHtml(html) {
  const start = html.indexOf('class="cardinfo"');
  const end   = html.indexOf('Obtaining Method', start);
  if (start === -1) return null;
  const body = html.slice(start, end === -1 ? undefined : end);

  const hpM = body.match(/<b>(\d+) HP/);
  if (!hpM) return null;
  const element = pick(body.slice(hpM.index), /\/tcgpocket\/image\/([a-z]+)\.png/);

  // attack rows: cost icons in a width="15%" cell, then name/effect, then damage
  const attacks = [];
  const rows = body.matchAll(/<td align="center" width="15%">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td colspan="2" align="center" class="main">([\s\S]*?)<\/td>/g);
  for (const [, costHtml, infoHtml, dmgHtml] of rows) {
    const cost = [...costHtml.matchAll(/\/card\/image\/([a-z]+)\.png/g)]
      .map(m => SEREBII_ENERGY[m[1]] || '?');
    const name   = stripHtml(pick(infoHtml, /<b>([\s\S]*?)<\/b>/) || '');
    const effect = stripHtml(infoHtml.replace(/<span class="main">[\s\S]*?<\/span>/, '')).replace(/^\s*/, '');
    attacks.push({ cost, name, damage: stripHtml(dmgHtml), effect: effect && !/[.!?]$/.test(effect) ? effect + '.' : effect });
  }

  const weakness = pick(body, /<b>Weakness<\/b><\/td>\s*<td><img[^>]*\/tcgpocket\/image\/([a-z]+)\.png/);
  const retreatHtml = pick(body, /<b>Retreat Cost<\/b><\/td>\s*<td[^>]*>([\s\S]*?)<\/tr>/) || '';
  const retreat = (retreatHtml.match(/colorless\.png/g) || []).length;
  const illustrator = stripHtml(pick(html, /Illustration:\s*<a[^>]*>([\s\S]*?)<\/a>/) || '') || null;

  return {
    hp: Number(hpM[1]), element: serebiiType(element), card_type: 'pokemon', stage: null, evolves_from: null,
    attacks, ability: null, weakness: serebiiType(weakness), retreat, illustrator, flavor_text: null,
  };
}

async function fetchJson(url) {
  const { data } = await axios.get(url, { headers: { 'User-Agent': UA } });
  return data;
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, { headers: { 'User-Agent': UA } });
  return data;
}

async function main() {
  const args = process.argv.slice(2);

  const setIdx   = args.indexOf('--set');
  const onlySet  = setIdx !== -1 ? args[setIdx + 1] : null;
  const limitIdx = args.indexOf('--limit');
  const limit    = limitIdx !== -1 ? Number(args[limitIdx + 1]) : null;
  const force    = args.includes('--force');
  const dryRun   = args.includes('--dry-run');

  // ---- step 1: fetch sets list from flibustier ----
  console.log('fetching sets list…');
  const setsObj = await fetchJson(`${FLIB_BASE}/sets.json`);
  // sets.json is grouped { A: [...], B: [...] }; flatten to a single ordered array
  const allSets = Object.values(setsObj).flat();
  const sets    = onlySet ? allSets.filter(s => s.code === onlySet) : allSets;
  if (!sets.length) {
    console.error(`no sets matched ${onlySet ? `--set ${onlySet}` : '(empty list)'}`);
    process.exit(1);
  }
  console.log(`processing ${sets.length} set(s): ${sets.map(s => s.code).join(', ')}`);

  // ---- step 2: load cache ----
  const cache = fs.existsSync(CACHE_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'))
    : {};
  const initialCacheSize = Object.keys(cache).length;

  // ---- step 3: per-set processing ----
  const allCards = [];
  let scrapedCount = 0;
  let cachedCount  = 0;

  for (const set of sets) {
    console.log(`\n[${set.code}] ${set.name?.en || '(no name)'} — ${set.releaseDate}`);
    const indexCards = await fetchJson(`${FLIB_BASE}/cards/${set.code}.json`);
    console.log(`  index: ${indexCards.length} cards`);

    const slice = limit ? indexCards.slice(0, limit) : indexCards;

    // serebii-backed sets: flibustier numbers bonus cards negatively (SP1's
    // three RGB "anomaly" Mews are -3/-2/-1) while serebii (and the in-game
    // list) put them after the regular cards (28/29/30). remap to serebii's
    // numbering so card numbers + "N/total" read naturally. the self-hosted
    // image files are named with the remapped number too.
    const serebiiSlug = SEREBII_SETS[set.code];
    const posCount = indexCards.filter(c => c.number > 0).length;
    const minNeg   = Math.min(0, ...indexCards.map(c => c.number));
    const cardNum  = (n) => (serebiiSlug && n < 0) ? posCount + (n - minNeg + 1) : n;
    let flibExtra = null;
    if (serebiiSlug) {
      const all = await fetchJson(`${FLIB_BASE}/cards.extra.json`);
      flibExtra = new Map(all.filter(c => c.set === set.code).map(c => [c.number, c]));
    }

    for (const idx of slice) {
      const number = cardNum(idx.number);
      const uid = `${set.code}-${number}`;
      const cacheKey = uid;
      let details;

      if (!force && cache[cacheKey]) {
        details = cache[cacheKey];
        cachedCount++;
      } else {
        if (dryRun) {
          console.log(`  [dry] ${uid} ${idx.name} (${idx.rarity})`);
          continue;
        }
        const url = serebiiSlug
          ? `${SEREBII_BASE}/${serebiiSlug}/${pad3(number)}.shtml`
          : `${LIMIT_BASE}/cards/${limitCode(set.code)}/${idx.number}`;
        try {
          const html = await fetchHtml(url);
          details = (serebiiSlug ? parseSerebiiHtml(html) : parseCardHtml(html)) || stubDetails();
          if (serebiiSlug && details.hp != null) {
            details.stage = flibExtra.get(idx.number)?.stage ?? null;
          }
        } catch (e) {
          // 404 = limitless doesn't host this card's page (some promos) → fall
          // back to a metadata-only stub so it still imports with its image.
          // any other error is likely transient → skip + retry on the next run.
          if (e.response?.status === 404) {
            console.warn(`  [404→stub] ${uid} ${idx.name}`);
            details = stubDetails();
          } else {
            console.warn(`  [err] ${uid} ${e.message}`);
            await sleep(DELAY_MS);
            continue;
          }
        }
        cache[cacheKey] = details;
        // persist cache after every card so a mid-run crash doesn't lose work
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
        scrapedCount++;
        console.log(`  ${uid} ${idx.name} hp=${details.hp ?? '-'} atk=${details.attacks.length} ${details.ability ? '★' : ''}`);
        await sleep(DELAY_MS);
      }

      allCards.push({
        uid,
        set: set.code,
        set_name: set.name?.en || set.code,
        set_release: set.releaseDate,
        number,
        name: idx.name,
        rarity: idx.rarity,
        packs: idx.packs || [],
        // stat fields from limitless
        hp:           details.hp,
        element:      details.element,
        card_type:    details.card_type,
        stage:        details.stage,
        evolves_from: details.evolves_from,
        weakness:     details.weakness,
        retreat:      details.retreat,
        attacks:      details.attacks,
        ability:      details.ability,
        illustrator:  details.illustrator,
        flavor_text:  details.flavor_text,
        // images composed from set + number (promos live under P-A/P-B on the CDN);
        // serebii-backed sets are self-hosted (relative path, see SEREBII_SETS)
        image_url:    serebiiSlug ? `assets/tcgp/${set.code}/${number}.webp` : cdnThumbUrl(limitCode(set.code), idx.number),
        image_full:   serebiiSlug ? `assets/tcgp/${set.code}/${number}.webp` : cdnFullUrl(limitCode(set.code), idx.number),
      });
    }
  }

  if (dryRun) {
    console.log(`\ndry-run complete — ${allCards.length} cards listed`);
    return;
  }

  console.log(`\n✓ ${allCards.length} cards processed (${scrapedCount} scraped, ${cachedCount} from cache)`);
  console.log(`  cache: ${Object.keys(cache).length} entries (was ${initialCacheSize})`);

  // ---- step 4: write output ----
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allCards, null, 2));
  console.log(`  wrote ${OUTPUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
