// gen-changelog.mjs
//
// generates app/src/data/changelog.json from git history — the on-site
// changelog (/changelog) reads it. each commit's message becomes a set of
// bullets and commits are grouped by the date they landed, newest-first.
//
// commit-message → bullets — THE RULE (every commit after LEGACY_UNTIL):
//   one line of the commit message = one bullet. a newline is the ONLY break.
//   semicolons, hyphens, slashes and em dashes are plain punctuation and never
//   split anything. write one topic per line:
//
//     tcg pocket — imported 5 sets; promo-c too
//     header — removed wordmark
//
//   (a line beginning with whitespace is a git hard-wrap and rejoins the line
//   above; a leading "- " / "* " bullet marker is stripped.)
//
// legacy commits (LEGACY_UNTIL and older) predate the rule — some single-line
// messages used "; " as a topic separator — so they keep a frozen parser:
// split on top-level "; " (never inside parens/quotes), rejoining fragments
// that open like a continuation ("the", "it", "now" …). don't extend that
// heuristic; it only exists so old history renders the same.
//
// going forward this is the source of truth: write a normal multi-line (or
// "; "-separated) commit message and re-run this script before pushing. the
// current uncommitted commit isn't in `git log` yet, so the changelog is
// current as of the last commit — regenerate + commit alongside new work.
//
// opting a commit out: put "[skip changelog]" anywhere in its message and it
// never appears on the site (housekeeping that visitors don't need to see).
//
// usage:
//   node scripts/gen-changelog.mjs            # write changelog.json
//   node scripts/gen-changelog.mjs --dry-run  # print summary, write nothing
//   node scripts/gen-changelog.mjs --strict   # exit 1 on suspected bad splits

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '../app/src/data/changelog.json');

// unique record/field markers that can't appear in a commit message.
const REC = '<<<CL-REC>>>';
const FLD = '<<<CL-FLD>>>';

// %h short-hash, %ad author date (short = YYYY-MM-DD), %B raw body.
const raw = execSync(
  `git log --no-merges --date=short --pretty=format:'${REC}%h${FLD}%ad${FLD}%B'`,
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);

// split one commit message into bullet fragments (see the style note above).
// "topic — " at the start of a line/fragment (em dash; topic ≤ 60 chars)
// newest commit parsed with the legacy rules; everything newer is one-line =
// one-bullet. git log is newest-first, so we flip to legacy at this hash.
const LEGACY_UNTIL = '0512cdf';

const TOPIC = /^[^—;]{1,60}\s—\s/;
// a fragment opening with one of these continues the previous clause rather
// than starting a new topic
const CONTINUATION = /^(the|a|an|it|its|it's|this|that|these|those|they|their|them|so|and|but|or|which|who|where|while|now|then|also|plus|because|instead|otherwise|both|each|every)\b/i;

// split on "; " only at the top level — never inside (parens) or "quotes",
// where a semicolon is just part of the aside.
function splitTopLevel(text) {
  const out = []; let depth = 0, inQuote = false, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === '(') depth++;
    else if (!inQuote && ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0 && !inQuote && /\s/.test(text[i + 1] || '')) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// current rule: one line = one bullet
function lineBullets(body) {
  return body
    .replace(/\n[ \t]+/g, ' ')
    .split('\n')
    .map(l => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
}

// frozen legacy parser — see header
function toBullets(body) {
  // (a) rejoin hard-wrapped continuation lines: a newline followed by
  //     whitespace is git's body-wrap, not a real line break.
  const lines = body
    .replace(/\n[ \t]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const bullets = [];
  for (const line of lines) {
    const isMarker = /^[-*•]\s+/.test(line);
    const text = line.replace(/^[-*•]\s+/, '').trim();
    if (isMarker) {
      // (b) explicit bullet — take it whole; "; " inside is prose.
      if (text) bullets.push(text);
    } else {
      // (c) prose line — "; " separates sub-topics, but a continuation
      //     fragment rejoins the clause before it.
      let first = true;
      for (const frag of splitTopLevel(text)) {
        const t = frag.trim();
        if (!t) continue;
        if (!first && CONTINUATION.test(t)) bullets[bullets.length - 1] += `; ${t}`;
        else bullets.push(t);
        first = false;
      }
    }
  }
  return bullets;
}

let inLegacy = false;
const commits = raw
  .split(REC)
  .map(s => s.trim())
  .filter(Boolean)
  .map(chunk => {
    const [hash, date, ...rest] = chunk.split(FLD);
    const body = rest.join(FLD); // body can't contain FLD, but be safe
    const h = hash.trim();
    if (h.startsWith(LEGACY_UNTIL) || LEGACY_UNTIL.startsWith(h)) inLegacy = true;
    if (/\[skip changelog\]/i.test(body)) return null;
    return { hash: h, date: date.trim(), legacy: inLegacy, bullets: inLegacy ? toBullets(body) : lineBullets(body) };
  })
  .filter(Boolean)
  .filter(c => c.bullets.length > 0);

// group by date, newest-first (git log is already newest-first, so first
// occurrence of each date preserves that order). a day's commits merge into
// one entry — "what shipped that day".
const byDate = [];
const index = new Map();
for (const c of commits) {
  if (!index.has(c.date)) {
    const entry = { date: c.date, changes: [], hashes: [] };
    index.set(c.date, entry);
    byDate.push(entry);
  }
  const entry = index.get(c.date);
  entry.changes.push(...c.bullets);
  entry.hashes.push(c.hash);
}

const dryRun = process.argv.includes('--dry-run');
const strict = process.argv.includes('--strict');

// guard: flag bullets that look like a bad split — unbalanced parens/quotes
// (a split landed inside an aside) or a fragment that still opens like a
// continuation of the clause before it.
const suspects = [];
const count = (str, ch) => str.split(ch).length - 1;
for (const c of commits) {
  if (!c.legacy) continue; // one-line-one-bullet can't mis-split
  for (const b of c.bullets) {
    const unbalanced = count(b, '(') !== count(b, ')') || count(b, '"') % 2 === 1;
    if (unbalanced || CONTINUATION.test(b) && !TOPIC.test(b) && c.bullets.indexOf(b) > 0) {
      suspects.push(`${c.hash}: "${b.slice(0, 100)}"`);
    }
  }
}
if (suspects.length) {
  console.warn(`\n⚠ ${suspects.length} bullet(s) look split off their topic line:`);
  for (const s of suspects) console.warn(`  ${s}`);
  console.warn('  fix the commit message wording (or the split rules above) before shipping.\n');
  if (strict) process.exit(1);
}

console.log(`parsed ${commits.length} commits → ${byDate.length} dated entries`);
console.log(`total bullets: ${byDate.reduce((n, e) => n + e.changes.length, 0)}`);
if (byDate[0]) console.log(`newest: ${byDate[0].date} (${byDate[0].changes.length} changes)`);

if (!dryRun) {
  writeFileSync(OUTPUT, JSON.stringify(byDate, null, 2));
  console.log(`wrote ${OUTPUT}`);
}
