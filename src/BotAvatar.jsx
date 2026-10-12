import { useId } from 'react';
import { APP_NAME } from './brand.js';
import useAvatarExpression from './useAvatarExpression.js';
import { AvatarFaceDefinitions, AvatarEyes, AvatarWaveform, AvatarIndicators } from './AvatarFace.jsx';
export { AVATAR_EXPRESSIONS } from './avatar-expressions.js';
import { BOT_BODY, BOT_EYES, BOT_FACE, BOT_HELMET, BOT_NECK, BOT_POSITION, BOT_SPARKLE, BOT_VIEWBOX } from './bot-shape.js';

// Hand-drawn SVG surfaces follow the concept's three-quarter perspective. The
// ceramic helmet, smoked glass, ports and body move together on the Orb's motion
// rhythms. Local visual reactions never touch the assistant or its voice timers.
export default function BotAvatar({ expression = 'neutral' }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { activity, face, wakeDrawing } = useAvatarExpression(expression);
  // The expression suffix also makes independently SSR-rendered state-sheet cells
  // unique. useId keeps two real instances of the same expression independent.
  const id = (name) => `nova-bot-${instance}-${face}-${name}`;
  const paint = (name) => `url(#${id(name)})`;
  return (
    <div className={`nova-bot expression-${face} activity-${activity}`} data-expression={face} data-activity={activity} onPointerEnter={wakeDrawing} onPointerDown={wakeDrawing} role="img" aria-label={`${APP_NAME} Bot, a pearl-white robot with a dark glass face and blue eyes — ${face}`}>
      {/* The floor stays grounded while the character floats and jumps above it. */}
      <svg className="bot-shadow-drawing" viewBox={BOT_VIEWBOX} fill="none" aria-hidden="true" focusable="false">
        <defs>
          <filter id={id('ground-blur')} x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="10" /></filter>
          <filter id={id('contact-blur')} x="-30%" y="-120%" width="160%" height="340%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <g transform={BOT_POSITION}>
          <g className="bot-ground-shadow">
            <ellipse cx="352" cy="909" rx="145" ry="18" fill="#02040F" opacity=".45" filter={paint('ground-blur')} />
            <ellipse cx="352" cy="901" rx="76" ry="8" fill="#02040B" opacity=".58" filter={paint('contact-blur')} />
          </g>
        </g>
      </svg>
      <svg className="bot-drawing" viewBox={BOT_VIEWBOX} fill="none" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={id('ceramic')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(-292 190 -182 -279 414 365)">
            <stop stopColor="#FEFEFF" />
            <stop offset=".4" stopColor="#ECECF3" />
            <stop offset=".74" stopColor="#C9CBD9" />
            <stop offset="1" stopColor="#8C91AB" />
          </radialGradient>
          <radialGradient id={id('body')} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(-138 225 -201 -124 403 685)">
            <stop stopColor="#F8F8FD" />
            <stop offset=".34" stopColor="#E4E5EF" />
            <stop offset=".69" stopColor="#B8BBD0" />
            <stop offset="1" stopColor="#7C829F" />
          </radialGradient>
          <linearGradient id={id('glass')} x1="344" y1="372" x2="409" y2="641" gradientUnits="userSpaceOnUse">
            <stop stopColor="#20212C" />
            <stop offset=".38" stopColor="#11131D" />
            <stop offset="1" stopColor="#080B12" />
          </linearGradient>
          <linearGradient id={id('bevel')} x1="269" y1="409" x2="462" y2="615" gradientUnits="userSpaceOnUse">
            <stop stopColor="#606574" />
            <stop offset=".35" stopColor="#1B1E2C" />
            <stop offset=".7" stopColor="#B9BECF" />
            <stop offset="1" stopColor="#F9FAFF" />
          </linearGradient>
          <linearGradient id={id('port')} x1="-32" y1="-35" x2="31" y2="15" gradientUnits="userSpaceOnUse">
            <stop stopColor="#171E34" />
            <stop offset=".46" stopColor="#424D70" />
            <stop offset="1" stopColor="#0B1122" />
          </linearGradient>
          <linearGradient id={id('ring')} x1="-26" y1="-49" x2="7" y2="54" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ADDCFF" />
            <stop offset=".4" stopColor="#77B4FF" />
            <stop offset="1" stopColor="#4274DD" />
          </linearGradient>
          <linearGradient id={id('star')} x1="-20" y1="-20" x2="20" y2="25" gradientUnits="userSpaceOnUse">
            <stop stopColor="#97C2FF" />
            <stop offset="1" stopColor="#568BF5" />
          </linearGradient>
          <AvatarFaceDefinitions id={id} palette="ice" />
          <filter id={id('ceramic-grain')} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" seed="8" result="grain" />
            <feColorMatrix in="grain" type="saturate" values="0" />
            <feComponentTransfer><feFuncA type="linear" slope=".035" /></feComponentTransfer>
            <feComposite in2="SourceGraphic" operator="in" result="surface" />
            <feBlend in="SourceGraphic" in2="surface" mode="soft-light" />
          </filter>
        </defs>

        <g className="bot-model" transform={BOT_POSITION}>
          <path className="bot-body" d={BOT_BODY} fill={paint('body')} filter={paint('ceramic-grain')} />
          <path className="bot-body-seam" d="M253 705C283 724 318 741 357 744C387 747 416 741 448 727" stroke="#F8FAFF" strokeOpacity=".22" strokeWidth="1.4" />
          <g transform="translate(402 733) rotate(-7)">
            <path className="bot-sparkle" d={BOT_SPARKLE} fill={paint('star')} />
          </g>
          <path className="bot-neck" d={BOT_NECK} fill="#080B13" />
          {/* The far port is occluded by the helmet; the near one overlaps the shell. */}
          <g className="bot-ear bot-ear-right" transform="translate(532 518) rotate(-8)">
            <ellipse rx="13" ry="49" fill="#20283F" />
            <ellipse rx="7" ry="39" fill="#0C1429" stroke="#7EB8FF" strokeWidth="3" />
          </g>
          <path className="bot-head" d={BOT_HELMET} fill={paint('ceramic')} filter={paint('ceramic-grain')} />
          <path className="bot-shell-rim" d="M197 410C239 356 321 330 400 348C450 359 492 386 516 425" stroke="#FFFFFF" strokeOpacity=".44" strokeWidth="1.5" strokeLinecap="round" />
          <path className="bot-face-bevel" d={BOT_FACE} fill={paint('bevel')} stroke={paint('bevel')} strokeWidth="6" />
          <path className="bot-face" d={BOT_FACE} fill={paint('glass')} stroke="#111420" strokeWidth="1.8" />
          <path className="bot-glass-reflection" d="M248 443C263 415 298 397 335 388C374 379 415 379 445 391" stroke="#83899E" strokeOpacity=".16" strokeWidth="1.5" strokeLinecap="round" />
          <g className="bot-ear bot-ear-left" transform="translate(154 551) rotate(-11)">
            <ellipse cx="6" rx="29" ry="69" fill="#11192B" />
            <ellipse cx="-2" rx="25" ry="65" fill={paint('port')} stroke="#69748E" strokeOpacity=".5" strokeWidth="1.3" />
            <ellipse className="bot-ear-ring" cx="-7" cy="-1" rx="18" ry="53" fill="#10172C" stroke={paint('ring')} strokeWidth="4.5" filter={paint('ring-glow')} />
            <ellipse cx="-7" cy="-1" rx="12" ry="44" fill="#0C1223" />
            <path d="M-18-40C-15-50-10-54-6-51" stroke="#D0E9FF" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
          </g>
          <AvatarEyes eyes={BOT_EYES} paint={paint} roll={-9} glow />
          <AvatarIndicators contour={BOT_HELMET} paint={paint} surpriseTransform="translate(337 327)" sleepTransform="translate(525 369)" />
          <AvatarWaveform transform="translate(390 513) rotate(-9)" paint={paint} glow />
        </g>
      </svg>
    </div>
  );
}
