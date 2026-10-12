import { useId } from 'react';
import { APP_NAME } from './brand.js';
import useAvatarExpression from './useAvatarExpression.js';
import { AvatarFaceDefinitions, AvatarEyes, AvatarWaveform, AvatarIndicators } from './AvatarFace.jsx';

// Keep the original Orb silhouette, eye centers and 42px design-height. Only
// the facial shapes change to the Bot's slimmer 31:78 capsules and expression set.
const ORB_SHAPE = 'M141 29C202 29 251 77 251 139C251 199 207 247 146 251C83 254 31 208 29 146C27 84 74 32 134 29C136 29 139 29 141 29Z';
const EYE_SCALE = (42 * 280 / 160) / 78;
const EYES = [
  { side: 'left', x: 99.75, y: 105 },
  { side: 'right', x: 180.25, y: 105 },
];

export default function RobotAvatar({ expression = 'neutral' }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { activity, face, wakeDrawing } = useAvatarExpression(expression);
  const id = (name) => `nova-orb-${instance}-${face}-${name}`;
  const paint = (name) => `url(#${id(name)})`;
  return (
    <div className={`nova-orb expression-${face} activity-${activity}`} data-expression={face} data-activity={activity}
      onPointerEnter={wakeDrawing} onPointerDown={wakeDrawing} role="img"
      aria-label={`${APP_NAME} Orb, a softly glowing white orb with expressive charcoal eyes — ${face}`}>
      <svg className="robot-avatar" viewBox="0 0 280 280" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={id('orbSurface')} cx="0" cy="0" r="1" gradientTransform="matrix(145 164 -153 135 93 76)" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFDF9" />
            <stop offset=".48" stopColor="#FFF8EF" />
            <stop offset=".8" stopColor="#F2E5D5" />
            <stop offset="1" stopColor="#D8C4AE" />
          </radialGradient>
          <radialGradient id={id('orbHighlight')} cx="0" cy="0" r="1" gradientTransform="matrix(48 54 -49 44 91 72)" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity=".9" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <filter id={id('orbBloom')} x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="15" />
          </filter>
          <filter id={id('orbShadow')} x="-35%" y="-25%" width="170%" height="180%" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="11" stdDeviation="10" floodColor="#000000" floodOpacity=".28" />
          </filter>
          <AvatarFaceDefinitions id={id} palette="ink" />
        </defs>

        <circle className="orb-bloom" cx="140" cy="140" r="106" fill="#FFF0DB" filter={paint('orbBloom')} />
        <path className="blob-shape" d={ORB_SHAPE} fill={paint('orbSurface')} stroke="#FFFDFC" strokeOpacity=".88" strokeWidth="2" filter={paint('orbShadow')} />
        <ellipse className="orb-sheen" cx="116" cy="83" rx="52" ry="39" fill={paint('orbHighlight')} opacity=".72" />
        <path d="M217 76C237 95 246 119 246 144" stroke="#FFFFFF" strokeOpacity=".58" strokeWidth="2" strokeLinecap="round" />

        <AvatarEyes eyes={EYES} scale={EYE_SCALE} eyeShift="10.5px" paint={paint} />
        <AvatarIndicators contour={ORB_SHAPE} ringWidth={1.5} paint={paint}
          surpriseTransform="translate(140 22) scale(.7)" sleepTransform="translate(212 34) scale(.6)" />
        <AvatarWaveform transform="translate(140 130) scale(.85)" paint={paint} />
      </svg>
    </div>
  );
}
