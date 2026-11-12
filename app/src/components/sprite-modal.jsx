import { useEffect } from 'react';
import Img from './img';
import { SlotBadges, useSlide } from './sprite-carousel';

// full-size viewer for a pokémon's artwork variants — opens when the page's
// SpriteCarousel image is tapped. ‹ › arrows, sideways swipe, or ← / → keys
// cycle (the image follows your finger while swiping); swipe down / Esc /
// backdrop closes.
//
// controlled (`index` / `onIndex`) so the page's carousel lands on whatever
// variant you ended on. every variant is mounted and stacked (only the
// current one visible): cycling is instant instead of remounting + reloading
// an image per tap, which is what made the old viewer feel unresponsive.
//
// `slots` shape: [{ src, gender: 'male'|'female'|null, shiny: bool }]
export default function SpriteModal({ slots, index, onIndex, pokemonName, onClose, closing = false, retro = false }) {
  const total = slots.length;
  const { stageRef, handlers, slotStyle, step } = useSlide({ total, index, onIndex });

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (total < 2) return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const slot = slots[index];
  if (!slot) return null;

  return (
    <div className={`sprite-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div className="sprite-modal" onClick={e => e.stopPropagation()}>
        <button className="sprite-modal__close" onClick={onClose} aria-label="close">✕</button>

        <div className="sprite-modal__stage" ref={stageRef} {...handlers}>
          {slots.map((s, i) => (
            <Img
              key={s.src + i}
              src={s.src}
              alt={i === index ? `${pokemonName}${s.gender ? ' ' + s.gender : ''}${s.shiny ? ' shiny' : ''}` : ''}
              wrapClassName="sprite-modal__slot"
              style={slotStyle(i)}
              className={`sprite-modal__img${retro && !s.shiny ? ' is-retro' : ''}`}
              draggable={false}
            />
          ))}
          {total > 1 && (
            <>
              <button className="sprite-modal__arrow sprite-modal__arrow--prev" onClick={() => step(-1)} aria-label="previous variant">‹</button>
              <button className="sprite-modal__arrow sprite-modal__arrow--next" onClick={() => step(1)} aria-label="next variant">›</button>
            </>
          )}
        </div>

        <div className="sprite-modal__badges">
          <SlotBadges slot={slot} />
          {!slot.gender && !slot.shiny && <span className="slot-badge slot-badge--default">default</span>}
        </div>

        {total > 1 && (
          <div className="sprite-modal__dots">
            {slots.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`sprite-modal__dot${i === index ? ' is-active' : ''}`}
                onClick={() => onIndex(i)}
                aria-label={`variant ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
