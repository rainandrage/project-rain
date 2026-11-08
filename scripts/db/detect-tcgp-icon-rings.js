/**
 * detect-tcgp-icon-rings.js
 *
 * flags profile icons whose bulbagarden upload has a decorative rainbow ring
 * baked into the image edge. the game shows NO border on any profile icon —
 * bulbagarden just uploaded ~29 of them (mostly set/pack promo icons) as
 * framed captures and the rest as bare circular art, so the grid looked
 * inconsistent. items flagged here get `ring: true`; the accessories page then
 * clips the ring off with a circular clip-path and scales the art back up to
 * full size (see .tcgp-accessory--ring in _pages.scss).
 *
 * detection: the ring is a flat, very light + very saturated band starting at
 * ~93% of the radius (identical on every ringed upload: L≈.90, S≈.95, zero
 * radial spread). bare icons never have that. we compare the angular-mean
 * lightness/saturation at 96% vs 87% of the radius and require the outer band
 * to match the ring's signature.
 *
 * run AFTER scrape-tcgp-accessories.js (which rewrites the file) — same 2-step
 * pattern as fetch-tcgp-obtain-methods.js:
 *   node db/scrape-tcgp-accessories.js
 *   node db/fetch-tcgp-obtain-methods.js
 *   node db/detect-tcgp-icon-rings.js
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { PNG } = require('pngjs');

const ACCESSORIES_PATH = path.join(__dirname, '../../app/src/data/tcgp-accessories.json');
// bulbagarden's cloudflare 403s curl but lets node/axios through with this UA
const UA       = 'Mozilla/5.0 (compatible; pokedex-scraper)';
const DELAY_MS = 250;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// angular mean of lightness + saturation at a given fraction of the radius
// (opaque pixels only)
function bandAt(png, rel) {
  const { width: w, height: h, data } = png;
  const cx = (w - 1) / 2, cy = (h - 1) / 2, r = (Math.min(w, h) / 2) * rel;
  let L = 0, S = 0, n = 0;
  for (let deg = 0; deg < 360; deg += 2) {
    const t = deg * Math.PI / 180;
    const x = Math.round(cx + r * Math.cos(t)), y = Math.round(cy + r * Math.sin(t));
    const i = (y * w + x) * 4;
    if (data[i + 3] < 200) continue;
    const R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    L += (mx + mn) / 2;
    S += mx === mn ? 0 : (mx - mn) / (1 - Math.abs(mx + mn - 1));
    n++;
  }
  return n ? { L: L / n, S: S / n } : null;
}

function hasRing(png) {
  const outer = [.94, .95, .96, .97].map(rel => bandAt(png, rel));
  const inner = bandAt(png, .87);
  if (outer.some(b => !b) || !inner) return false;
  const flat  = Math.max(...outer.map(b => b.L)) - Math.min(...outer.map(b => b.L)) < .03;
  const ringy = outer.every(b => b.L > .85 && b.S > .9);
  const step  = Math.abs(outer[2].L - inner.L) + Math.abs(outer[2].S - inner.S);
  return flat && ringy && step > .2;
}

async function main() {
  const items = JSON.parse(fs.readFileSync(ACCESSORIES_PATH, 'utf8'));
  const icons = items.filter(x => x.category === 'icons');
  console.log(`checking ${icons.length} profile icons…`);
  let ringed = 0, failed = 0;
  for (const item of icons) {
    try {
      const { data } = await axios.get(item.image_full, {
        responseType: 'arraybuffer', headers: { 'User-Agent': UA }, timeout: 30000,
      });
      const ring = hasRing(PNG.sync.read(Buffer.from(data)));
      if (ring) { item.ring = true; ringed++; console.log(`  ring  ${item.name}`); }
      else delete item.ring;
    } catch (e) {
      failed++;
      console.warn(`  [err] ${item.uid} ${e.response?.status || e.message}`);
    }
    await sleep(DELAY_MS);
  }
  fs.writeFileSync(ACCESSORIES_PATH, JSON.stringify(items, null, 2));
  console.log(`\n✓ ${ringed} ringed / ${icons.length} icons (${failed} failed) → wrote ${ACCESSORIES_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
