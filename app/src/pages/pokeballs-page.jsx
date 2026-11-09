import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useModalAnimation } from '../hooks/use-modal-animation';
import { useModalCycleNav } from '../hooks/use-modal-cycle-nav';
import { formatSlugLower } from '../utils/format-name';
import { pulseElement } from '../utils/pulse';
import { STORAGE_KEYS, getString } from '../utils/storage';
import balls from '../data/pokeballs.json';

const STANDARD_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball', 'safari-ball', 'sport-ball'];

const SECTIONS = [
  { key: 'standard-balls', label: 'standard', sort: (a, b) => {
    const ai = STANDARD_ORDER.indexOf(a.name), bi = STANDARD_ORDER.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }},
  { key: 'special-balls',  label: 'special',  sort: (a, b) => a.name.localeCompare(b.name) },
  { key: 'apricorn-balls', label: 'apricorn', sort: (a, b) => a.name.localeCompare(b.name) },
];

const SECTIONED_BALLS = SECTIONS.map(s => ({
  ...s,
  items: balls.filter(b => b.category === s.key).sort(s.sort),
})).filter(s => s.items.length);

function BallModal({ ball, modalRef, onClose, closing }) {

  return (
    <div className={`ability-modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div ref={modalRef} className="ball-modal" onClick={e => e.stopPropagation()}>
        <div className="ball-modal__header">
          <div className="ball-modal__title">
            {ball.sprite && <img src={ball.sprite} alt={ball.name} />}
            <div className="ball-modal__title-text">
              <h2>{formatSlugLower(ball.name)}</h2>
              {ball.name_jp && (
                <small className="jp-subtitle">
                  {ball.name_jp}{ball.romaji ? ` [${ball.romaji}]` : ''}
                </small>
              )}
            </div>
          </div>
        </div>
        {ball.effect && <p className="ball-modal__effect">{ball.effect}</p>}
        {ball.flavor_text && <p className="ball-modal__flavor">{ball.flavor_text}</p>}
        <div className="ball-modal__meta">
          <div className="info-cell">
            <span className="info-cell__label">price</span>
            <span className="info-cell__value">
              {ball.cost > 0 ? `₽${ball.cost.toLocaleString()}` : 'not sold'}
            </span>
          </div>
          {ball.category && (
            <div className="info-cell">
              <span className="info-cell__label">class</span>
              <span className="info-cell__value">
                {ball.category.replace(/-/g, ' ').replace(' balls', '')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PokeballsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialOpenId = location.state?.openId ?? null;
  const { current: currentBall, modalRef, open, close } =
    useModalCycleNav(SECTIONED_BALLS, initialOpenId);
  const { displayed: shownBall, isClosing } = useModalAnimation(currentBall);

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
      <p className="items-page__sub">{balls.length} types</p>

      {SECTIONED_BALLS.map((section, sectionIdx) => (
        <div key={section.key} className="items-section">
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

      {shownBall && (
        <BallModal
          ball={shownBall}
          modalRef={modalRef}
          onClose={close}
          closing={isClosing}
        />
      )}
    </div>
  );
}
