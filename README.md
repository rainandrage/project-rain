# project rain

an ever-expanding passion project aiming to provide a convenient and visually pleasing way to explore the world of pokemon.

live at [rainandrage.github.io/project-rain](https://rainandrage.github.io/project-rain)

## what's inside

- **pokedex** — all ~1025 pokemon + their forms (regional, mega, gmax, alt), with search, filtering, sorting, stats, evolutions, and abilities
- **compare** — side-by-side stats for up to three pokemon
- **gallery** — gym leaders, badges, berries, and pokéballs, each browsable with detail modals
- **tcg pocket** — a card browser (3400+ cards across every set, incl. promos) and a cosmetics/accessories catalog with unlock requirements
- **retro mode** — swap in curated gen-2-style sprites site-wide
- **news** — a live feed scraped from pokebeach + serebii
- **changelog** — an on-site, date-segmented history of what's shipped, generated from git
- four themes, an accessibility mode, and a layout tuned for touch + desktop alike

## architecture

mostly static, with one live edge: the frontend ships all its data as committed json (`app/src/data/`) and does its filtering/sorting/pagination in-memory — no database, no per-request server. the **news page** is the exception: it fetches from a small **cloudflare worker** (`worker/`) that scrapes sources on demand and edge-caches the result, falling back to a bundled `news.json` if the worker is unreachable.

- react + vite + react router + sass
- deployed to github pages via github actions on every push to `main`
- the news worker deploys separately with `wrangler` (no site rebuild needed)

see `CLAUDE.md` for the full architecture, data schema, and script reference.

## local dev

```bash
cd app && npm install && npm run dev
```

## regenerating data

data generation scripts live in `scripts/` and are never deployed — they write json into `app/src/data/`, which you then commit.

```bash
cd scripts && npm install

# core pokemon data
node db/generate.js              # fetch pokeapi (~15–20 min)
node db/patch-evolutions.js      # patch evo conditions pokeapi gets wrong
node db/fetch-abilities.js       # rebuild ability descriptions
node db/scrape-flavor.js         # scrape bulbapedia for form-specific flavor text

# catalogs
node db/scrape-gym-leaders.js    # gym leaders by region
node db/scrape-badges.js         # gym badges by region
node db/scrape-tcg-pocket.js     # tcg pocket cards (incremental; run without --set)
node db/scrape-tcgp-accessories.js   # tcg pocket cosmetics
node db/fetch-tcgp-obtain-methods.js # patch accessory unlock requirements

# misc
node news/fetch-news.mjs         # regenerate the bundled news.json fallback
node gen-changelog.mjs           # rebuild changelog.json from git history
```

## deploying the news worker

```bash
cd worker && npx wrangler deploy
```
