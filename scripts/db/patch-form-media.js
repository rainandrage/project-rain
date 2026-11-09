// fixes form images that are really the base species' images, and links each
// form to its own cry.
//
// images: many cosmetic forms (unown letters, vivillon patterns, arceus /
// silvally types, alcremie flavors, furfrou trims, spiky-eared pichu, …) were
// generated with the BASE species' artwork / shiny sprite, because pokeapi
// lists them as forms, not separate pokémon. pokeapi's sprite repo does have
// per-form files named `{species id}-{form suffix}.png` (e.g. 201-b.png). for
// every form field that equals the base species' value, this swaps in the
// form's own file — only after confirming the file exists. HOME renders are
// added the same way for the forms it fixes.
//
// cries: forms that pokeapi treats as their own pokémon (megas, regional
// forms, gmax, …) have a 10xxx id with its own cry file. the id is stored as
// `cry_id` on the form so the cry button plays the right one. cosmetic forms
// keep the species' cry (that's correct — they share it in the games).
// regional forms (alolan / galarian / hisuian / paldean) also keep the
// species' cry: in the games they share it, and pokeapi's separate regional
// files are inconsistent (galarian meowth's is alolan meowth's, hisuian
// decidueye's is the base one). known gaps for later: pokeapi's pikachu-gmax
// and melmetal-gmax files are copies of the base cry.
//
// idempotent, network-only (pokeapi + raw.githubusercontent). run after
// generate.js:
//   node scripts/db/patch-form-media.js [--dry]

const fs   = require('fs');
const path = require('path');

const POKEMON_JSON = path.resolve(__dirname, '..', '..', 'app', 'src', 'data', 'pokemon.json');
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const CRIES   = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest';
const DRY = process.argv.includes('--dry');
const REGIONAL = /-(alola|galar|hisui|paldea)(-|$)/;

// field → path under SPRITES for a given file key
const FIELDS = {
  sprite_url:    (k) => `${SPRITES}/${k}.png`,
  sprite_shiny:  (k) => `${SPRITES}/shiny/${k}.png`,
  artwork_url:   (k) => `${SPRITES}/other/official-artwork/${k}.png`,
  artwork_shiny: (k) => `${SPRITES}/other/official-artwork/shiny/${k}.png`,
  home_url:      (k) => `${SPRITES}/other/home/${k}.png`,
  home_shiny:    (k) => `${SPRITES}/other/home/shiny/${k}.png`,
};

const exists = new Map();
async function urlExists(url) {
  if (!exists.has(url)) {
    exists.set(url, fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false));
  }
  return exists.get(url);
}

async function pokeapiId(slug) {
  try {
    const r = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
    if (!r.ok) return null;
    return (await r.json()).id;
  } catch { return null; }
}

// small worker pool so we don't hammer either host
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}

async function main() {
  const raw = fs.readFileSync(POKEMON_JSON, 'utf8');
  const data = JSON.parse(raw);

  const jobs = [];
  for (const p of data) {
    for (const [slug, fd] of Object.entries(p.form_data || {})) {
      if (fd) jobs.push({ p, slug, fd });
    }
  }

  const fixedImages = [];
  const cries = [];
  const uncried = [];
  let done = 0;

  await pool(jobs, 8, async ({ p, slug, fd }) => {
    // ── cry ──
    if (REGIONAL.test(slug)) {
      if ('cry_id' in fd) { delete fd.cry_id; uncried.push(slug); }
    } else {
      const pid = await pokeapiId(slug);
      if (pid && pid > 10000 && await urlExists(`${CRIES}/${pid}.ogg`)) {
        if (fd.cry_id !== pid) { fd.cry_id = pid; cries.push(slug); }
      }
    }

    // ── images: only fields that are just the base species' value ──
    const suffix = slug.startsWith(p.name + '-') ? slug.slice(p.name.length + 1) : null;
    const stale = Object.keys(FIELDS).filter(f =>
      f.startsWith('home') ? false : (fd[f] && fd[f] === p[f]));
    if (suffix && stale.length) {
      const key = `${p.id}-${suffix}`;
      const changed = [];
      for (const f of stale) {
        const url = FIELDS[f](key);
        if (await urlExists(url)) { fd[f] = url; changed.push(f); }
      }
      // a form being fixed also gets its own HOME render when there is one
      // (otherwise the page would fall back to the base species' HOME)
      if (changed.length) {
        for (const f of ['home_url', 'home_shiny']) {
          const url = FIELDS[f](key);
          if (fd[f] !== url && await urlExists(url)) { fd[f] = url; changed.push(f); }
        }
        fixedImages.push(`${slug}: ${changed.join(', ')}`);
      }
      const left = stale.filter(f => !changed.includes(f));
      if (left.length) fixedImages.push(`${slug}: NO FILE for ${left.join(', ')} (left as is)`);
    }

    if (++done % 50 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
  });

  console.log(`\nimages fixed on ${fixedImages.filter(l => !l.includes('NO FILE')).length} forms`);
  for (const l of fixedImages.filter(l => l.includes('NO FILE'))) console.log('  ' + l);
  console.log(`cry_id set on ${cries.length} forms; removed from ${uncried.length} regional forms`);

  if (DRY) { console.log('(dry run — nothing written)'); return; }
  // 2-space indent keeps diffs readable (minified writes = 100k-line diffs)
  fs.writeFileSync(POKEMON_JSON, JSON.stringify(data, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  console.log('wrote', path.relative(process.cwd(), POKEMON_JSON));
}

main();
