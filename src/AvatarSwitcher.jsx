import { AVATARS } from './avatar.js';
import { APP_NAME } from './brand.js';
import { BOT_BODY, BOT_EYES, BOT_FACE, BOT_HELMET, BOT_NECK, BOT_POSITION, BOT_SPARKLE, BOT_VIEWBOX } from './bot-shape.js';

// Tiny, static silhouettes keep the picker legible without duplicating the
// animated avatars (or introducing duplicate SVG gradient IDs).
function AvatarIcon({ avatar }) {
  return avatar === 'bot' ? (
    <svg viewBox={BOT_VIEWBOX} fill="none" aria-hidden="true" focusable="false">
      <g transform={BOT_POSITION}>
        <path d={BOT_BODY} fill="#e4e7f3" />
        <path d={BOT_SPARKLE} transform="translate(402 733) rotate(-7)" fill="#76a7ff" />
        <path d={BOT_NECK} fill="#0b1020" />
        <path d={BOT_HELMET} fill="#f1f2fa" />
        <path d={BOT_FACE} fill="#0d101b" />
        {BOT_EYES.map(({ side, x, y }) => <rect key={side} x="-15.5" y="-39" width="31" height="78" rx="15.5" transform={`translate(${x} ${y}) rotate(-9)`} fill="#bae7ff" />)}
        <ellipse cx="154" cy="551" rx="25" ry="64" transform="rotate(-11 154 551)" fill="#141d33" />
        <ellipse cx="148" cy="550" rx="17" ry="51" transform="rotate(-11 154 551)" stroke="#76a7ff" strokeWidth="6" />
      </g>
    </svg>
  ) : (
    <svg viewBox="0 0 32 36" fill="none" aria-hidden="true" focusable="false">
      <path d="M16 4C24 4 30 10 30 18c0 8-6 14-14 14S2 26 2 18C2 10 8 4 16 4Z" fill="#fff8ef" />
      <path d="M5 23c3 8 15 10 22 2-3 6-8 8-13 7-5-1-8-4-9-9Z" fill="#eadac7" />
      <rect x="10.5" y="11.725" width="3" height="7.55" rx="1.5" fill="#1a1a1a" />
      <rect x="18.5" y="11.725" width="3" height="7.55" rx="1.5" fill="#1a1a1a" />
    </svg>
  );
}

export default function AvatarSwitcher({ avatar, onChange }) {
  return (
    <div className="avatar-switcher" role="group" aria-label="Avatar style">
      {AVATARS.map((option) => (
        <button
          key={option.id}
          className={`avatar-choice${avatar === option.id ? ' is-selected' : ''}`}
          type="button"
          data-avatar-choice={option.id}
          aria-label={`Use ${option.id === 'bot' ? `${APP_NAME} Bot` : option.name} avatar`}
          aria-pressed={avatar === option.id}
          title={option.description}
          onClick={() => onChange(option.id)}
        >
          <AvatarIcon avatar={option.id} />
          <span className="avatar-choice-name" aria-hidden="true">{option.name}</span>
        </button>
      ))}
    </div>
  );
}
