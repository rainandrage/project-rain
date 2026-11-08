/**
 * scrape-badges.js
 * scrapes the bulbapedia "Badge" article for main-gym-progression badges
 * across every region. emits app/src/data/badges.json with one entry per
 * (badge, generation/sub-region) pair.
 *
 * usage:
 *   node db/scrape-badges.js                          # all regions
 *   node db/scrape-badges.js --regions kanto,johto    # just those (sanity check)
 *   node db/scrape-badges.js --dry-run                # print to stdout, don't write
 *
 * data shape (per badge):
 *   { id, name, region, generation, leader, city, type,
 *     obedience, hm, stat_boost, effect, sprite }
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const API       = 'https://bulbapedia.bulbagarden.net/w/api.php';
const OUT_PATH  = path.join(__dirname, '../../app/src/data/badges.json');
const UA        = 'pokedex-data-scraper/1.0 (https://github.com/rainandrage/project-rain)';
const DELAY_MS  = 400;

// section header → metadata. wikitext sections look like ===Indigo League===,
// ===Johto League===, ===Hoenn League===, ===Sinnoh League===, ===Unova League===,
// ===Kalos League===, ===Galar League===, ===Paldea===.
//   slug:       internal id used in the output `region` field
//   label:      display name for the section
//   gen:        generation number (for sort/grouping)
//   header:     wikitext heading regex (escaped)
//   subRegion:  used when a generation has multiple badge sets (Unova B/W vs B2/W2)
const SECTIONS = [
  { slug: 'kanto',      label: 'kanto',       gen: 1, header: 'Indigo League' },
  { slug: 'johto',      label: 'johto',       gen: 2, header: 'Johto League' },
  { slug: 'hoenn',      label: 'hoenn',       gen: 3, header: 'Hoenn League' },
  { slug: 'sinnoh',     label: 'sinnoh',      gen: 4, header: 'Sinnoh League' },
  { slug: 'unova-bw',   label: 'unova (B/W)', gen: 5, header: 'Unova League', subSection: '{{2v2\\|Black\\|White}}' },
  { slug: 'unova-b2w2', label: 'unova (B2/W2)', gen: 5, header: 'Unova League', subSection: '{{2v2\\|Black\\|White\\|2}}' },
  { slug: 'kalos',      label: 'kalos',       gen: 6, header: 'Kalos League' },
  { slug: 'galar',      label: 'galar',       gen: 8, header: 'Galar League' },
  // paldea uses a level-3 region heading (===Paldea===) with the gym league
  // nested as a level-4 sub-heading (====Paldea League====); other regions
  // put their league directly at level 3.
  { slug: 'paldea',     label: 'paldea',      gen: 9, header: 'Paldea', subSection: 'Paldea League' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const out = { regions: null, dryRun: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--regions') out.regions = a[++i].split(',').map(s => s.trim());
    else if (a[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

// depth-aware split on top-level `|` — wikitext templates and links can
// contain `|` inside nested constructs ({{m|Flash}}, [[Pewter City|town]]).
// without this we'd fragment those nested args.
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

// resolve {{#switch:expr|key1=val1|key2=val2|...}} blocks into a comma-joined
// list of values. used by bulbapedia for badges with version-cycling fields
// (volcano cycles cinnabar/seafoam, trio cycles cilan/chili/cress, legend
// cycles iris/drayden). uses depth-aware parsing because the expression
// itself nests other parser functions ({{#expr:...}}, {{#time:...}}).
function flattenSwitches(s) {
  let out = s;
  while (true) {
    const start = out.indexOf('{{#switch:');
    if (start === -1) break;
    let depth = 1, j = start + 2;
    while (j < out.length && depth > 0) {
      if (out.slice(j, j + 2) === '{{') { depth++; j += 2; continue; }
      if (out.slice(j, j + 2) === '}}') { depth--; j += 2; continue; }
      j++;
    }
    const inner = out.slice(start + '{{#switch:'.length, j - 2);
    const firstPipe = inner.indexOf('|');
    const casesText = firstPipe === -1 ? '' : inner.slice(firstPipe + 1);
    const values = casesText
      .split('|')
      .map(c => { const eq = c.indexOf('='); return eq > -1 ? c.slice(eq + 1) : c; })
      .map(v => v.trim())
      .filter(Boolean);
    out = out.slice(0, start) + values.join(', ') + out.slice(j);
  }
  return out;
}

// strip wikitext markup we don't want to surface in the output —
// links ([[X]] or [[X|label]]), magic words, parser functions, and templates.
function cleanWikitext(s) {
  if (s == null) return '';
  return flattenSwitches(s)
    .replace(/\{\{sup\/[^}]+\}\}/g, '')                    // version-tag superscripts
    .replace(/\{\{tt\|[^}]+\}\}/g, '')                     // tooltips ({{tt|*|footnote}}) — drop entirely
    .replace(/\{\{wp\|[^|}]+\|([^}]+)\}\}/g, '$1')         // wikipedia link with label → label
    .replace(/\{\{wp\|([^|}]+)\}\}/g, '$1')                // wikipedia link no label → page name
    .replace(/\{\{ka\|([^}]+)\}\}/g, '$1')                 // {{ka|name}} → name
    .replace(/\{\{ga\|([^}]+)\}\}/g, '$1')                 // {{ga|name}} → name
    .replace(/\{\{an\|([^}]+)\}\}/g, '$1')                 // {{an|name}} → name
    .replace(/\{\{m\|([^}]+)\}\}/g, '$1')                  // move template → move name
    .replace(/\{\{t\|([^}]+)\}\}/g, '$1')                  // type template → type name
    .replace(/\{\{i\|([^}]+)\}\}/g, '$1')                  // item template → item name
    .replace(/\{\{p\|([^}]+)\}\}/g, '$1')                  // pokemon template → species name
    .replace(/\{\{color2?\|[^|}]+\|([^}]+)\}\}/g, '$1')    // {{color|hex|text}} → text
    .replace(/\{\{MTR\}\}/g, 'Meowth')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')         // [[link|label]] → label
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                    // [[link]] → link
    .replace(/'''([^']+)'''/g, '$1')                       // bold
    .replace(/''([^']+)''/g, '$1')                         // italic
    .replace(/<[^>]+>/g, '')                               // any html
    .replace(/\s+/g, ' ')
    .trim();
}

// extract every badge template body from a region's wikitext. matches both
// `{{bdg|...}}` (gens 1-8) and `{{bdg/NoName|...}}` (paldea — type-symbol
// badges with no unique name). explicitly skips `{{bdg/h|...}}` (table header).
function extractBdgTemplates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{{bdg', i);
    if (start === -1) break;
    const after = text[start + 5];
    if (after !== '|' && after !== '/') { i = start + 1; continue; }
    // skip the table header template
    if (text.slice(start + 5, start + 8) === '/h|') { i = start + 1; continue; }
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

// turn the parsed bdg template args into a structured badge object.
//
// two template variants exist:
//   {{bdg|<type>|<name>|<kana>|<romaji>|<leader>|<city>|<design>|...trivia}}
//   {{bdg/NoName|<type>|<leader>|<city>|<design>|image=<file>|region=<r>}}
// the second is paldea-only — type-symbol badges with no unique name.
// named kwargs (`hm=`, `stat=`, `lvl=`, `og=`, `oa=`, `image=`) interleave
// freely with positional args; we separate them in the loop below.
function badgeFromTemplate(templateBody, region) {
  const raw = splitArgs(templateBody);
  const tplName = raw[0].trim();
  const args = raw.slice(1);

  const positional = [];
  const named = {};
  for (const a of args) {
    const m = a.match(/^\s*([a-z][a-z0-9_]*)\s*=([\s\S]*)$/);
    if (m) named[m[1]] = m[2].trim();
    else positional.push(a.trim());
  }

  let type, nameRaw, leaderRaw, cityRaw, designRaw;
  if (tplName === 'bdg/NoName') {
    [type, leaderRaw, cityRaw, designRaw] = positional;
    nameRaw = type; // paldea badges named after their type ("Bug Badge", etc.)
  } else {
    type      = positional[0];
    nameRaw   = positional[1];
    leaderRaw = positional[4];
    cityRaw   = positional[5];
    // first positional after the fixed slots = design ("It is shaped like X").
    // anything beyond is usually trivia ("This badge is not obtainable until…")
    // — explicitly drop those.
    designRaw = positional[6];
  }

  const design = designRaw ? cleanWikitext(designRaw) : '';

  const name      = `${cleanWikitext(nameRaw)} badge`.toLowerCase();
  const primaryLeader = cleanWikitext(leaderRaw).toLowerCase();
  // og= holds alternate gym leaders for the same badge across gens (juan
  // takes over from wallace in emerald; janine + blue take over kanto gyms
  // in gsc/hgss; bede + marnie inherit galar gyms post-game). may contain
  // multiple comma-separated names. we append them after the primary leader
  // so the display reads "wallace, juan", "koga, janine", etc.
  const altLeaders = named.og
    ? cleanWikitext(named.og).toLowerCase()
        .split(/,\s*|\s+and\s+/)
        .map(s => s.trim())
        .filter(s => s && s !== primaryLeader)
    : [];
  const leader    = [primaryLeader, ...altLeaders].filter(Boolean).join(', ');
  const city      = cleanWikitext(cityRaw || '').toLowerCase();
  // bulbapedia writes `hm=None` (literal capital N) when no hm is granted.
  // normalize to null so the page doesn't render "allows none".
  const hmRaw     = named.hm   ? cleanWikitext(named.hm).toLowerCase()  : null;
  const hmMove    = (hmRaw && hmRaw !== 'none') ? hmRaw : null;
  // parseInt is lenient — handles paldea's "25 (met)" notation by grabbing
  // just the leading number, while still parsing bare "70" correctly.
  const obedience = named.lvl  ? parseInt(cleanWikitext(named.lvl), 10) || null : null;
  const statBoost = named.stat ? cleanWikitext(named.stat).toLowerCase(): null;

  // composite human-readable effect string for display
  const parts = [];
  if (statBoost) parts.push(`raises ${statBoost}`);
  if (obedience) parts.push(`obey up to lv. ${obedience}`);
  if (hmMove)    parts.push(`allows ${hmMove}`);
  const effect = parts.join(' • ') || null;

  const id = `${cleanWikitext(nameRaw).toLowerCase().replace(/\s+/g, '-')}-${region.slug}`;

  // bulbapedia file title — bdg derives it from the badge name; bdg/NoName
  // (paldea) provides it explicitly via the image= named arg.
  const filename = named.image
    ? `${cleanWikitext(named.image)}.png`
    : `${cleanWikitext(nameRaw)} Badge.png`;

  return {
    id,
    name,
    region:     region.slug,
    region_label: region.label,
    generation: region.gen,
    leader,
    city,
    type:       cleanWikitext(type || '').toLowerCase(),
    obedience,
    hm:         hmMove,
    stat_boost: statBoost,
    effect,
    design,
    sprite:     null, // filled in by resolveImageUrl below
    _filename:  filename,
  };
}

async function fetchWikitext(page) {
  const { data } = await axios.get(API, {
    params: { action: 'parse', page, prop: 'wikitext', format: 'json' },
    headers: { 'user-agent': UA },
  });
  return data.parse.wikitext['*'];
}

// resolve a Bulbapedia File: title to a real CDN URL via imageinfo.
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

// slice the article's wikitext for a single region. handles the unova
// sub-section split (B/W vs B2/W2) which lives inside the Unova League heading.
function sliceRegionWikitext(fullText, region) {
  // find the section starting at ===<header>===
  const headerRe = new RegExp(`===\\s*${region.header}\\s*===`);
  const startMatch = fullText.match(headerRe);
  if (!startMatch) return null;
  const start = startMatch.index;
  // section ends at the next ===<other>=== heading
  const restAfter = fullText.slice(start + startMatch[0].length);
  const nextHeader = restAfter.search(/\n===[^=]/);
  let body = nextHeader === -1 ? restAfter : restAfter.slice(0, nextHeader);

  // sub-section narrowing for Unova B/W vs B2/W2
  if (region.subSection) {
    const subRe = new RegExp(`====\\s*${region.subSection}\\s*====`);
    const subStart = body.match(subRe);
    if (!subStart) return null;
    const after = body.slice(subStart.index + subStart[0].length);
    const nextSub = after.search(/\n====/);
    body = nextSub === -1 ? after : after.slice(0, nextSub);
  }

  return body;
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

  console.log(`fetching badge wikitext...`);
  const wikitext = await fetchWikitext('Badge');

  const all = [];
  for (const region of regions) {
    const body = sliceRegionWikitext(wikitext, region);
    if (!body) {
      console.warn(`  [warn] ${region.slug}: section not found, skipping`);
      continue;
    }
    const templates = extractBdgTemplates(body);
    const badges = templates.map(t => badgeFromTemplate(t, region));
    console.log(`  ${region.slug.padEnd(12)} ${badges.length} badges`);
    all.push(...badges);
  }

  console.log(`\nresolving ${all.length} sprite urls (rate-limited)...`);
  for (const b of all) {
    try {
      b.sprite = await resolveImageUrl(b._filename);
    } catch (e) {
      console.warn(`  [warn] sprite for ${b.id} failed: ${e.message}`);
    }
    delete b._filename;
  }

  if (opts.dryRun) {
    console.log('\n--- DRY RUN OUTPUT ---');
    console.log(JSON.stringify(all, null, 2));
    return;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2));
  console.log(`\ndone. ${all.length} badges written to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
