import { useEffect, useMemo, useState } from 'react';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { useModalCycleNav } from '../hooks/use-modal-cycle-nav';
import { pulseElement } from '../utils/pulse';
import Img from '../components/img';
import accessories from '../data/tcgp-accessories.json';

// section by category in a fixed display order. each section gets
// {slug, label, items} — items already in source order from the scraper.
// labels are shorter than `category_label` from the scraper so the tab grid
// stays uniform (e.g. "covers" instead of "binder covers"). full label is
// kept for the modal's category subtitle since space isn't constrained there.
const CATEGORY_ORDER = ['icons', 'sleeves', 'coins', 'playmats', 'backdrops', 'binder-covers', 'emblems'];

const TAB_LABELS = {
  'icons':         'icons',
  'sleeves':       'sleeves',
  'coins':         'coins',
  'playmats':      'playmats',
  'backdrops':     'backdrops',
  'binder-covers': 'covers',
  'emblems':       'emblems',
};

const SECTIONED_ACCESSORIES = (() => {
  const byCat = new Map();
  for (const a of accessories) {
    if (!byCat.has(a.category)) {
      byCat.set(a.category, {
        slug:  a.category,
        label: a.category_label,
        items: [],
      });
    }
    byCat.get(a.category).items.push(a);
  }
  return CATEGORY_ORDER.map(k => byCat.get(k)).filter(Boolean);
})();

function AccessoryModal({ item, modalRef, onClose, onPrev, onNext, closing, bump }) {
  // cycle-pulse on every prev/next via WAAPI — same pattern as the other modals.
  useEffect(() => {
    if (bump.n === 0) return;
    const anim = pulseElement(modalRef.current);
    return () => anim?.cancel();
  }, [bump.n, modalRef]);

  // preload the full-res image proactively when the item changes. on a JS
  // Image object, setting `referrerPolicy = 'no-referrer'` BEFORE `src`
  // guarantees the request goes out without a Referer header — bulbagarden's
  // cdn intermittently 403s when a Referer leaks through. by the time the
  // React <img> below renders, the response is already cached so the visible
  // load is instant. previously we got a flaky "first modal doesn't render
  // the image, but coming back via arrow keys works" pattern; preloading
  // resolves that race.
  useEffect(() => {
    if (!item?.image_full) return;
    const preload = new Image();
    preload.referrerPolicy = 'no-referrer';
    preload.src = item.image_full;
  }, [item?.image_full]);

  return (
    <div className={`ability-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div ref={modalRef} className="ball-modal tcgp-accessory-modal" onClick={e => e.stopPropagation()}>
        {/* only the title bar pins. hero + any meta scroll together. matches
            the leader / tcgp-card modal pattern so users get the full modal
            height for image + reading rather than a tiny strip. */}
        <div className="ball-modal__header">
          <button className="modal-cycle-arrow modal-cycle-arrow--prev" onClick={onPrev} aria-label="previous">‹</button>
          <div className="tcgp-accessory-modal__title">
            <h2>{item.name}</h2>
          </div>
          <button className="modal-cycle-arrow modal-cycle-arrow--next" onClick={onNext} aria-label="next">›</button>
        </div>

        <div className="tcgp-accessory-modal__scroll">
          <div className="tcgp-accessory-modal__hero">
            {/* key forces a fresh DOM node per item so referrerPolicy lands
                on the element before src triggers the load. without this,
                React reuses the same <img> across cycles and the initial
                attribute-application order can race the first request. */}
            <Img
              key={item.uid}
              wrapClassName={`tcgp-accessory-modal__hero-box${item.ring ? ' tcgp-accessory--ring' : ''}`}
              src={item.image_full}
              alt={item.name}
              referrerPolicy="no-referrer"
              loading="eager"
              style={item.width && item.height ? { width: `${item.width}px`, aspectRatio: `${item.width} / ${item.height}` } : undefined}
            />
          </div>
          {/* always rendered: items with no unlock text get an invisible
              one-line placeholder so their art centers in the same spot as
              the ones that have it, instead of dropping to the middle. */}
          <div
            className={`tcgp-accessory-modal__obtain${item.obtain_method ? '' : ' tcgp-accessory-modal__obtain--empty'}`}
            aria-hidden={item.obtain_method ? undefined : true}
          >
            <span className="tcgp-accessory-modal__obtain-label">how to unlock</span>
            <p className="tcgp-accessory-modal__obtain-text">{item.obtain_method || '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TCGPocketAccessoriesPage() {
  // single-select category tabs. default = first category (icons). progressive
  // load isn't needed here because each category sits at 50-200 items —
  // browsable in one scroll without paying for all 860 thumbs at once.
  const [activeCategory, setActiveCategory] = useState(
    SECTIONED_ACCESSORIES[0]?.slug ?? null,
  );

  const visibleSections = useMemo(
    () => SECTIONED_ACCESSORIES.filter(s => s.slug === activeCategory),
    [activeCategory],
  );

  const visibleCount = visibleSections[0]?.items.length ?? 0;

  const { current: currentItem, bump, modalRef, open, close, prev, next } = useModalCycleNav(visibleSections);
  const { displayed: shownItem, isClosing } = useModalAnimation(currentItem);

  return (
    <div className="items-page">
      <p className="items-page__sub">
        {visibleCount} {visibleSections[0]?.label || 'items'}
      </p>

      <div className="tcgp-cat-tabs" role="tablist" aria-label="filter by category">
        {SECTIONED_ACCESSORIES.map(section => {
          const active = activeCategory === section.slug;
          return (
            <button
              key={section.slug}
              type="button"
              role="tab"
              aria-selected={active}
              className={`tcgp-cat-tab${active ? ' is-active' : ''}`}
              onClick={() => setActiveCategory(section.slug)}
            >
              <span className="tcgp-cat-tab__label">{TAB_LABELS[section.slug] || section.label}</span>
              <span className="tcgp-cat-tab__count">{section.items.length}</span>
            </button>
          );
        })}
      </div>

      {visibleSections.map((section, sectionIdx) => (
        <div key={section.slug} className="items-section">
          <div className="tcgp-accessory-grid">
            {section.items.map((item, index) => (
              <button
                key={item.uid}
                className="tcgp-accessory-thumb"
                onClick={(e) => {
                  const t = e.currentTarget;
                  pulseElement(t, { scale: 1.05, duration: 220, offset: 0.3 });
                  setTimeout(() => open(sectionIdx, index), 70);
                }}
                title={item.name}
              >
                <Img
                  src={item.image_url}
                  alt={item.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  wrapClassName={`tcgp-accessory-thumb__img${item.ring ? ' tcgp-accessory--ring' : ''}`}
                />
              </button>
            ))}
          </div>
        </div>
      ))}

      {shownItem && (
        <AccessoryModal
          item={shownItem}
          modalRef={modalRef}
          onClose={close}
          onPrev={prev}
          onNext={next}
          closing={isClosing}
          bump={bump}
        />
      )}
    </div>
  );
}
