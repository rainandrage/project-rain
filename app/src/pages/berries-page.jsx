import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { useModalCycleNav } from '../hooks/use-modal-cycle-nav';
import { formatSlugLower } from '../utils/format-name';
import { pulseElement } from '../utils/pulse';
import { STORAGE_KEYS, getString } from '../utils/storage';
import berries from '../data/berries.json';

const FLAVOR_ORDER = ['spicy', 'dry', 'sweet', 'bitter', 'sour'];

const SECTIONS = [
  { label: 'status cure',       match: b => b.id <= 10 },
  { label: 'hp + flavor',       match: b => b.id >= 11 && b.id <= 15 },
  { label: 'ev reducing',       match: b => b.id >= 21 && b.id <= 26 },
  { label: 'type resist',       match: b => b.id >= 36 && b.id <= 52 },
  { label: 'pinch stat boost',  match: b => b.id >= 53 && b.id <= 57 },
  { label: 'special',           match: b => b.id >= 58 && b.id <= 64 },
  { label: 'pokéblock / poffin', match: b => (b.id >= 16 && b.id <= 20) || (b.id >= 27 && b.id <= 35) },
];

const SECTIONED_BERRIES = SECTIONS.map(s => ({
  ...s,
  items: berries.filter(s.match).sort((a, b) => a.id - b.id),
})).filter(s => s.items.length);

function BerryModal({ berry, modalRef, onClose, closing }) {

  const hasFlavors = FLAVOR_ORDER.some(f => berry.flavors[f]);

  return (
    <div className={`ability-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div ref={modalRef} className="ball-modal ball-modal--berry" onClick={e => e.stopPropagation()}>
        <div className="ball-modal__header">
          <div className="ball-modal__title">
            {berry.sprite && <img src={berry.sprite} alt={berry.name} />}
            <div className="ball-modal__title-text">
              <h2>{formatSlugLower(berry.name)} berry</h2>
              {berry.name_jp && (
                <small className="jp-subtitle">
                  {berry.name_jp}{berry.romaji ? ` [${berry.romaji}]` : ''}
                </small>
              )}
            </div>
          </div>
        </div>
        {berry.effect && <p className="ball-modal__effect">{berry.effect}</p>}
        {berry.flavor_text && <p className="ball-modal__flavor">{berry.flavor_text}</p>}

        {hasFlavors && (
          <div className="berry-flavors">
            {FLAVOR_ORDER.map(f => berry.flavors[f] ? (
              <span key={f} className={`berry-flavor flavor-${f}`}>
                {f} <strong>{berry.flavors[f]}</strong>
              </span>
            ) : null)}
          </div>
        )}

        <div className="ball-modal__meta">
          {berry.natural_gift_type && (
            <div className="info-cell">
              <span className="info-cell__label">type</span>
              <span className="info-cell__value">
                <span className={`type-badge type-${berry.natural_gift_type}`}>{berry.natural_gift_type}</span>
              </span>
            </div>
          )}
          {berry.natural_gift_power > 0 && (
            <div className="info-cell">
              <span className="info-cell__label">power</span>
              <span className="info-cell__value">{berry.natural_gift_power}</span>
            </div>
          )}
          {berry.growth_time > 0 && (
            <div className="info-cell">
              <span className="info-cell__label">growth</span>
              <span className="info-cell__value">{berry.growth_time}h</span>
            </div>
          )}
          {berry.max_harvest > 0 && (
            <div className="info-cell">
              <span className="info-cell__label">yield</span>
              <span className="info-cell__value">{berry.max_harvest}</span>
            </div>
          )}
          {berry.size > 0 && (
            <div className="info-cell">
              <span className="info-cell__label">size</span>
              <span className="info-cell__value">{(berry.size / 10).toFixed(1)} cm</span>
            </div>
          )}
          {berry.firmness && (
            <div className="info-cell">
              <span className="info-cell__label">firmness</span>
              <span className="info-cell__value">{formatSlugLower(berry.firmness)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BerriesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialOpenId = location.state?.openId ?? null;
  const { current: currentBerry, modalRef, open, close } =
    useModalCycleNav(SECTIONED_BERRIES, initialOpenId);
  const { displayed: shownBerry, isClosing } = useModalAnimation(currentBerry);

  useEffect(() => {
    if (!initialOpenId) return;
    navigate(location.pathname, { replace: true, state: null });
    const mode = getString(STORAGE_KEYS.XFADE_MODE, 'snap');
    if (mode !== 'view') {
      setTimeout(() => { if (modalRef.current) pulseElement(modalRef.current); }, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="items-page">
      <p className="items-page__sub">{berries.length} berry types</p>

      {SECTIONED_BERRIES.map((section, sectionIdx) => (
        <div key={section.label} className="items-section">
          <h2 className="items-section__label">{section.label}</h2>
          <div className="ball-grid">
            {section.items.map((b, index) => (
              <button key={b.id} className="ball-thumb"
                      onClick={(e) => {
                        const t = e.currentTarget;
                        pulseElement(t, { scale: 1.07, duration: 220, offset: 0.3 });
                        setTimeout(() => open(sectionIdx, index), 70);
                      }}>
                {b.sprite && <img src={b.sprite} alt={b.name} />}
                <span>{formatSlugLower(b.name)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {shownBerry && (
        <BerryModal
          berry={shownBerry}
          modalRef={modalRef}
          onClose={close}
          closing={isClosing}
        />
      )}
    </div>
  );
}
