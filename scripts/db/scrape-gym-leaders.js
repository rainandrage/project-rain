/**
 * scrape-gym-leaders.js
 * scrapes the bulbapedia "Gym Leader" article for in-game gym leaders
 * across every region. emits app/src/data/gym-leaders.json with one entry
 * per (leader, region/sub-region) pair.
 *
 * usage:
 *   node db/scrape-gym-leaders.js                          # all regions
 *   node db/scrape-gym-leaders.js --regions kanto,johto    # just those (sanity check)
 *   node db/scrape-gym-leaders.js --no-flavor              # skip per-leader page fetches
 *   node db/scrape-gym-leaders.js --dry-run                # print to stdout, don't write
 *
 * data shape (per leader):
 *   { id, name, name_jp, romaji, region, region_label, generation,
 *     city, city_jp, type, badge, sprite, flavor_text, page_title }
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const API       = 'https://bulbapedia.bulbagarden.net/w/api.php';
const OUT_PATH  = path.join(__dirname, '../../app/src/data/gym-leaders.json');
const UA        = 'pokedex-data-scraper/1.0 (https://github.com/rainandrage/project-rain)';
const DELAY_MS  = 400;

// section header → metadata. matches the gym-leader article structure.
//   slug:        internal id used in the output `region` field
//   label:       display name for the section
//   gen:         generation number for grouping/sort
//   header:      ===<header>=== heading on the article
//   subSection:  used when a region splits across two game sets (Unova B/W vs B2/W2)
const SECTIONS = [
  { slug: 'kanto',      label: 'kanto',         gen: 1, header: 'Indigo League' },
  { slug: 'johto',      label: 'johto',         gen: 2, header: 'Johto League' },
  { slug: 'hoenn',      label: 'hoenn',         gen: 3, header: 'Hoenn League' },
  { slug: 'sinnoh',     label: 'sinnoh',        gen: 4, header: 'Sinnoh League' },
  { slug: 'unova-bw',   label: 'unova (B/W)',   gen: 5, header: 'Unova League', subSection: 'Black and White' },
  { slug: 'unova-b2w2', label: 'unova (B2/W2)', gen: 5, header: 'Unova League', subSection: 'Black 2 and White 2' },
  { slug: 'kalos',      label: 'kalos',         gen: 6, header: 'Kalos League' },
  { slug: 'galar',      label: 'galar',         gen: 8, header: 'Galar League' },
  { slug: 'paldea',     label: 'paldea',        gen: 9, header: 'Paldea League' },
];

// striaton trio in BW is hand-rolled HTML in the wikitext (not a {{gldr}}
// template) because it's a 3-leader rotating gym keyed to the player's
// starter choice. inject them manually so they show up in the bw section
// alongside everyone else. types and badge are shared via the trio gym.
const STRIATON_TRIO = [
  { ldr: 'Cilan', djap: 'デント', drm: 'Dent', type: 'Grass', pic: 'VSCilan.png' },
  { ldr: 'Chili', djap: 'ポッド', drm: 'Pod',  type: 'Fire',  pic: 'VSChili.png' },
  { ldr: 'Cress', djap: 'コーン', drm: 'Corn', type: 'Water', pic: 'VSCress.png' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const out = { regions: null, dryRun: false, noFlavor: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--regions')        out.regions = a[++i].split(',').map(s => s.trim());
    else if (a[i] === '--dry-run')   out.dryRun = true;
    else if (a[i] === '--no-flavor') out.noFlavor = true;
  }
  return out;
}

// depth-aware split on top-level `|`. wikitext templates and links can
// contain `|` inside nested constructs ({{m|Flash}}, [[Pewter City|town]]) —
// without depth tracking we'd fragment those nested args.
function splitArgs(body) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c2 = body.slice(i, i + 2);
    if (c2 === '{{' || c2 === '[[') { depth++; cur += c2; i++; continue; }
    if (c2 === '}}' || c2 === ']]') { depth--; cur += c2; i++; continue; }
    if (body[i] === '|' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  args.push(cur);
  return args;
}

// strip wikitext markup from display strings.
function cleanWikitext(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<ref[^>]*\/>/g, '')                         // self-closing ref
    .replace(/<ref[\s\S]*?<\/ref>/g, '')                  // <ref>...</ref>
    .replace(/\{\{!\}\}.*$/, '')                          // truncate at magic-pipe (size suffix on pics)
    .replace(/\{\{sup\/[^}]+\}\}/g, '')
    .replace(/\{\{tt\|[^}]+\}\}/g, '')
    .replace(/\{\{wp\|[^|}]+\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{wp\|([^|}]+)\}\}/g, '$1')
    .replace(/\{\{m\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{t\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{p\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{p2\|([^|}]+)\|([^}]+)\}\}/g, '$2')      // {{p2|species|label}} → label
    .replace(/\{\{p2\|([^|}]+)\}\}/g, '$1')
    .replace(/\{\{type\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{pkmn\|([^|}]+)\|([^}]+)\}\}/g, '$2')    // {{pkmn|page|label}} → label
    .replace(/\{\{pkmn\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{OBP\|([^|}]+)\|[^}]+\}\}/g, '$1')       // {{OBP|name|disambig}} → name
    .replace(/\{\{DL\|[^|}]+\|([^}]+)\}\}/g, '$1')        // {{DL|page|label}} → label
    .replace(/\{\{badge\|[^|}]+\|([^}]+)\}\}/gi, '$1')    // {{Badge|page|label}} → label
    .replace(/\{\{badge\|([^}]+)\}\}/gi, '$1 Badge')      // {{Badge|name}} → "<name> Badge"
    .replace(/\{\{player\}\}/gi, 'player')
    .replace(/\{\{Gen\|([^}]+)\}\}/g, 'Gen $1')
    .replace(/\{\{gen\|([^}]+)\}\}/g, 'Gen $1')
    .replace(/\{\{game[^|}]*\|([^|}]+)\|[^}]+\}\}/g, '$1')
    .replace(/\{\{v2\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{LGPE\}\}/g, "Pokémon: Let's Go, Pikachu! and Let's Go, Eevee!")
    .replace(/\{\{Tera\}\}/g, 'Tera')
    .replace(/\{\{color2?\|[^|}]+\|([^}]+)\}\}/g, '$1')
    .replace(/\{\{color\|[^|}]+\|([^}]+)\}\}/g, '$1')
    // drop [[File:...]] and [[Image:...]] embeds entirely — they may have
    // multiple `|` separators (thumb|size|caption|alt) that the generic
    // link substitution below would otherwise leak into the output as
    // "thumb|200px|caption" text fragments.
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    // generic catch-all for remaining templates: prefer the last arg as
    // display text (mirrors {{link|page|label}} convention), drop bare ones.
    .replace(/\{\{[^|}]*\|[^|}]+\|([^|}]+)\}\}/g, '$1')
    .replace(/\{\{[^|}]*\|([^|}]+)\}\}/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// extract every gldr* template body from a wikitext slice. matches gldr,
// gldr2, gldrb, gldrb2 — covers all 4 variants used in the article.
function extractGldrTemplates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{{gldr', i);
    if (start === -1) break;
    // must be immediately followed by digit, 'b', or `|` — otherwise it's a
    // different template that happens to share the prefix
    const after = text.slice(start + 6, start + 8);
    if (!/^[2b|]/.test(after)) { i = start + 1; continue; }
    let depth = 1;
    let j = start + 2;
    while (j < text.length && depth > 0) {
      if (text.slice(j, j + 2) === '{{') { depth++; j += 2; continue; }
      if (text.slice(j, j + 2) === '}}') { depth--; j += 2; continue; }
      j++;
    }
    out.push(text.slice(start + 2, j - 2));
    i = j;
  }
  return out;
}

// turn a template body into an array of 1-2 leader records. paired templates
// (gldr2, gldrb2) emit two records — each leader gets their own row.
function leadersFromTemplate(body, region) {
  const raw = splitArgs(body);
  const tplName = raw[0].trim();
  const args = raw.slice(1);

  const named = {};
  for (const a of args) {
    const m = a.match(/^\s*([a-z][a-z0-9_]*)\s*=([\s\S]*)$/);
    if (m) named[m[1]] = m[2].trim();
  }

  const isPaired = tplName === 'gldr2' || tplName === 'gldrb2';

  const sharedCity   = cleanWikitext(named.loc || '');
  const sharedCityJp = cleanWikitext(named.cjap || '');

  const out = [];

  // primary leader
  const primary = leaderRecord({
    ldr:       named.ldr,
    djap:      named.djap,
    drm:       named.drm,
    type:      named.type,
    tDisplay:  named.t,                  // "Various" override for non-specialists
    pic:       named.pic,
    bdg:       named.bdg ?? named.bdge,  // {{gldr|...|bdge=...}} typo for boulder
    city:      sharedCity,
    cityJp:    sharedCityJp,
  }, region);
  if (primary) out.push(primary);

  if (isPaired) {
    // paired leaders sometimes share a gym (Bea/Allister, Gordie/Melony,
    // Wallace/Juan) — same city. some have their own slot 2 fields filled in.
    const paired = leaderRecord({
      ldr:       named.ldr2,
      djap:      named.djap2,
      drm:       named.drm2,
      type:      named.type2 || named.type,    // share type when not specified
      tDisplay:  named.t2,
      pic:       named.pic2,
      bdg:       named.bdg2 || named.bdg,      // share badge by default
      city:      cleanWikitext(named.loc2 || named.loc || ''),
      cityJp:    cleanWikitext(named.cjap2 || named.cjap || ''),
    }, region);
    if (paired) out.push(paired);
  }

  return out;
}

// trim trailing per-game annotations from name fields. some templates inline
// "<br>Generations II and IV" into djap/drm/ldr to caption which gens that
// leader appears in — drop everything from the first <br>/<span> onward.
function trimAnnotation(s) {
  if (!s) return s;
  return String(s).replace(/<(br|span)[\s\S]*$/i, '').trim();
}

function leaderRecord(f, region) {
  if (!f.ldr) return null;

  // strip disambiguation suffix from display name ("Blue (game)" → "Blue")
  // but keep the full title for the bulbapedia page lookup since the
  // disambiguated form IS the page title.
  const pageTitle = cleanWikitext(trimAnnotation(f.ldr));
  const displayName = pageTitle.replace(/\s*\([^)]+\)\s*$/, '').toLowerCase();
  const slug = displayName.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // type display: prefer the `t` override (used when the leader doesn't
  // specialize, e.g. Blue → "Various") over the cell-color `type` field.
  const typeRaw = f.tDisplay || f.type;

  return {
    id:           `${slug}-${region.slug}`,
    name:         displayName,
    name_jp:      cleanWikitext(trimAnnotation(f.djap)),
    romaji:       cleanWikitext(trimAnnotation(f.drm)),
    region:       region.slug,
    region_label: region.label,
    generation:   region.gen,
    city:         (f.city || '').toLowerCase(),
    city_jp:      f.cityJp || '',
    type:         (cleanWikitext(typeRaw) || '').toLowerCase(),
    badge:        cleanWikitext(f.bdg).toLowerCase(),
    sprite:       null,                                  // filled after wikitext parse
    flavor_text:  null,                                  // filled when --no-flavor not set
    page_title:   pageTitle,                             // bulbapedia page title (includes disambig)
    _pic:         cleanWikitext(f.pic || ''),            // file basename for sprite resolution
  };
}

async function fetchWikitext(page) {
  await sleep(DELAY_MS);
  const { data } = await axios.get(API, {
    params: { action: 'parse', page, prop: 'wikitext', format: 'json', redirects: 1 },
    headers: { 'user-agent': UA },
  });
  if (data.error) throw new Error(`${page}: ${data.error.info}`);
  return data.parse.wikitext['*'];
}

async function resolveImageUrl(filename) {
  await sleep(DELAY_MS);
  const { data } = await axios.get(API, {
    params: {
      action: 'query',
      titles: `File:${filename}`,
      prop:   'imageinfo',
      iiprop: 'url',
      format: 'json',
    },
    headers: { 'user-agent': UA },
  });
  const pages = data.query.pages;
  const first = Object.values(pages)[0];
  return first?.imageinfo?.[0]?.url || null;
}

// slice the article's wikitext for a single region. handles unova's
// sub-section split (BW vs B2W2).
function sliceRegionWikitext(fullText, region) {
  const headerRe = new RegExp(`===\\s*${region.header}\\s*===`);
  const startMatch = fullText.match(headerRe);
  if (!startMatch) return null;
  const start = startMatch.index;
  const restAfter = fullText.slice(start + startMatch[0].length);
  const nextHeader = restAfter.search(/\n===[^=]/);
  let body = nextHeader === -1 ? restAfter : restAfter.slice(0, nextHeader);

  if (region.subSection) {
    const subRe = new RegExp(`====\\s*${region.subSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*====`);
    const subStart = body.match(subRe);
    if (!subStart) return null;
    const after = body.slice(subStart.index + subStart[0].length);
    const nextSub = after.search(/\n====[^=]/);
    body = nextSub === -1 ? after : after.slice(0, nextSub);
  }

  return body;
}

// extract a multi-paragraph flavor blurb from a leader's bulbapedia page.
// anchors on the lead-paragraph signature `\n\n'''<Name>'''` (more robust
// than line-walking; survives pages with mixed-content hatnote lines like
// Giovanni's `{{samename|...}} ''For the...''`), then collects up to N
// prose paragraphs forward — usually 1 short lead + 1-2 longer paragraphs
// from the ==In the core series games== section that follows.
//
// stops at hard-stop headings (anime / manga / TCG / trivia) so we never
// pull anime-only lore into game-only modal copy. paragraph cap + char
// cap keep the modal from getting overwhelming for chatty leaders like
// Wallace or Larry whose backstories run long.
//
// returns paragraphs joined with `\n\n` so the consumer can split and
// render each as its own <p> element.
function extractFlavorText(wikitext, maxParagraphs = 3, maxChars = 1100) {
  // anchor on `\n'''<Name>''' (Japanese:` — the parenthetical is the
  // lead-paragraph signature on every leader page, more specific than
  // a bare bold-name pattern (which can appear inside templates). single
  // newline before is OK because some pages (Grusha) close their infobox
  // with `}}\n|}\n` and roll straight into prose without a blank-line
  // separator. m.index points at the leading \n; +1 to skip it.
  const m = wikitext.match(/\n'''[^']+'''\s*\(Japanese:[^)]+\)[^\n]*/);
  if (!m) return null;
  const start = m.index + 1;

  // truncate at the first non-game section heading. game-related sections
  // (==In the core series games==, ==In the spin-off games==, ==In the
  // games==) flow through naturally; this just bounds the search so we
  // don't bleed into anime/manga/trivia content that's outside the
  // gym-leader-as-trainer scope the user asked for.
  const stopRe = /\n==\s*(?:In the (?:anime|manga|TCG|movies|games \(spin-off\))|Trivia|Memorable|Quotes|Names in other languages|See also|References|Gallery|Sprites|Voice actors)/i;
  const stopMatch = wikitext.slice(start).search(stopRe);
  const intro = stopMatch === -1 ? wikitext.slice(start) : wikitext.slice(start, start + stopMatch);

  // split on blank lines, collect prose paragraphs. bulbapedia leader pages
  // don't always put a blank line between `==Heading==` and the first
  // paragraph that follows, which would lump them into a single block —
  // pre-normalize by surrounding any heading with blank lines so the
  // regular blank-line split cleanly isolates them. cleanWikitext strips
  // markup within each paragraph; \n\n separators between paragraphs
  // survive because the join happens AFTER cleaning per-paragraph.
  const normalized = intro.replace(/\n(==[^\n]+==)/g, '\n\n$1\n');
  const blocks = normalized.split(/\n\s*\n/);
  const paragraphs = [];
  let totalChars = 0;
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^==/.test(trimmed))            continue;   // sub-headings
    if (/^\{\{[\s\S]*\}\}$/.test(trimmed)) continue; // pure template block
    if (/^\{\|/.test(trimmed))          continue;   // wikitext table
    if (/^[*:#]/.test(trimmed))         continue;   // list items / hatnotes
    const cleaned = cleanWikitext(trimmed);
    if (!cleaned || cleaned.length < 40) continue;  // noise / stub paragraphs
    paragraphs.push(cleaned);
    totalChars += cleaned.length;
    if (paragraphs.length >= maxParagraphs) break;
    if (totalChars >= maxChars) break;
  }

  if (!paragraphs.length) return null;
  return paragraphs.join('\n\n');
}

async function fetchFlavor(pageTitle) {
  try {
    const wt = await fetchWikitext(pageTitle);
    return extractFlavorText(wt);
  } catch (e) {
    return null;
  }
}

async function main() {
  const opts = parseArgs();
  const regions = opts.regions
    ? SECTIONS.filter(s => opts.regions.includes(s.slug))
    : SECTIONS;

  if (!regions.length) {
    console.error(`no matching regions for: ${opts.regions?.join(',')}`);
    process.exit(1);
  }

  console.log(`fetching gym-leader article wikitext...`);
  const wikitext = await fetchWikitext('Gym_Leader');

  const all = [];
  for (const region of regions) {
    const body = sliceRegionWikitext(wikitext, region);
    if (!body) {
      console.warn(`  [warn] ${region.slug}: section not found, skipping`);
      continue;
    }
    const templates = extractGldrTemplates(body);
    const leaders = templates.flatMap(t => leadersFromTemplate(t, region));

    // striaton trio injection — only for unova-bw
    if (region.slug === 'unova-bw') {
      for (const l of STRIATON_TRIO) {
        const rec = leaderRecord({
          ldr: l.ldr, djap: l.djap, drm: l.drm,
          type: l.type, pic: l.pic, bdg: 'Trio',
          city: 'striaton city', cityJp: 'サンヨウシティ',
        }, region);
        if (rec) leaders.push(rec);
      }
    }

    console.log(`  ${region.slug.padEnd(14)} ${leaders.length} leaders`);
    all.push(...leaders);
  }

  console.log(`\nresolving ${all.length} sprite urls (rate-limited)...`);
  for (const l of all) {
    if (!l._pic) { delete l._pic; continue; }
    try {
      l.sprite = await resolveImageUrl(l._pic);
    } catch (e) {
      console.warn(`  [warn] sprite for ${l.id} failed: ${e.message}`);
    }
    delete l._pic;
  }

  if (!opts.noFlavor) {
    // dedupe page-title fetches — leaders that appear in multiple regions
    // (Burgh in unova-bw + unova-b2w2, Blue in kanto, etc.) only need one
    // wikitext pull. cache by page_title.
    const uniqueTitles = [...new Set(all.map(l => l.page_title))];
    console.log(`\nfetching flavor text for ${uniqueTitles.length} unique pages (rate-limited)...`);
    const flavorByTitle = new Map();
    let i = 0;
    for (const title of uniqueTitles) {
      i++;
      const flavor = await fetchFlavor(title);
      flavorByTitle.set(title, flavor);
      if (i % 10 === 0 || i === uniqueTitles.length) {
        process.stdout.write(`  ${i}/${uniqueTitles.length}\r`);
      }
    }
    console.log('');
    for (const l of all) {
      l.flavor_text = flavorByTitle.get(l.page_title) || null;
    }
  }

  if (opts.dryRun) {
    console.log('\n--- DRY RUN OUTPUT ---');
    console.log(JSON.stringify(all, null, 2));
    return;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2));
  console.log(`\ndone. ${all.length} leaders written to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
