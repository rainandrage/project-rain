// gen-changelog.mjs
//
// generates app/src/data/changelog.json from git history — the on-site
// changelog (/changelog) reads it. each commit's message becomes a set of
// bullets and commits are grouped by the date they landed, newest-first.
//
// commit-message → bullets: three styles live in our history, all supported —
//   1. one topic per line (recent commits)
//   2. a single line with "; "-separated topics (older prose commits)
//   3. explicit markdown "- "/"* " bullet lists (some older commits), which
//      may hard-wrap a single bullet across git's ~72-col body wrap.
// approach: (a) rejoin hard-wrapped continuation lines (a line beginning with
// whitespace continues the previous one); (b) a line with an explicit bullet
// marker is ONE bullet as-authored — "; " inside it is prose, not a boundary;
// (c) a plain prose line splits on "; " into sub-topic bullets.
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
      // (c) prose line — "; " separates sub-topics.
      for (const frag of text.split(/;\s+/)) {
        const t = frag.trim();
        if (t) bullets.push(t);
      }
    }
  }
  return bullets;
}

const commits = raw
  .split(REC)
  .map(s => s.trim())
  .filter(Boolean)
  .map(chunk => {
    const [hash, date, ...rest] = chunk.split(FLD);
    const body = rest.join(FLD); // body can't contain FLD, but be safe
    if (/\[skip changelog\]/i.test(body)) return null;
    return { hash: hash.trim(), date: date.trim(), bullets: toBullets(body) };
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
console.log(`parsed ${commits.length} commits → ${byDate.length} dated entries`);
console.log(`total bullets: ${byDate.reduce((n, e) => n + e.changes.length, 0)}`);
if (byDate[0]) console.log(`newest: ${byDate[0].date} (${byDate[0].changes.length} changes)`);

if (!dryRun) {
  writeFileSync(OUTPUT, JSON.stringify(byDate, null, 2));
  console.log(`wrote ${OUTPUT}`);
}
