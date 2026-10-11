import { APP_NAME } from './brand.js';

// Eye dimensions are CSS pixels at the default 160px avatar size. SVG geometry
// lives in a 280-unit viewBox, so the uniform scale below makes 28 × 42 mean real
// on-screen pixels, not accidentally smaller viewBox units. Compact layouts scale
// the entire face proportionally; verify-avatar checks both coordinate systems.
const VIEWBOX = 280;
const AVATAR_SIZE = 160;
const EYE = { width: 28, height: 42, gap: 18, cy: 60 };
const PIXEL_TO_SVG = VIEWBOX / AVATAR_SIZE;
const CENTER = VIEWBOX / 2;
const EYE_Y = EYE.cy * PIXEL_TO_SVG;
const EYE_OFFSET = (EYE.width + EYE.gap) / 2 * PIXEL_TO_SVG;
const EYES = [
  { side: 'left', cx: CENTER - EYE_OFFSET },
  { side: 'right', cx: CENTER + EYE_OFFSET },
];

function Eye({ side, cx }) {
  return (
    <g className={`robot-eye robot-eye-${side}`} transform={`translate(${cx} ${EYE_Y}) scale(${PIXEL_TO_SVG})`}>
      {/* A fixed local origin prevents a changing blink bounding box from moving
          the eyes' pivot. Both copies receive exactly the same pose and paint. */}
      <g className="eye-scale">
        <ellipse className="eye-iris" cx="0" cy="0" rx={EYE.width / 2} ry={EYE.height / 2} fill="url(#eyeWell)" />
        {/* A filled, symmetric crescent occupying the same 28 × 42 local bounds.
            The happy/wake pose squashes it to 33.6 × 16.8 on-screen pixels. */}
        <path className="eye-crescent" d="M-14 21C-14 -35 14 -35 14 21C8 -11 -8 -11 -14 21Z" fill="url(#eyeWell)" />
      </g>
    </g>
  );
}

function RobotAvatar() {
  return (
    <svg className="robot-avatar" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} fill="none" role="img" aria-label={`${APP_NAME}, a softly glowing orb with expressive eyes`}>
      <defs>
        <radialGradient id="orbSurface" cx="0" cy="0" r="1" gradientTransform="matrix(145 164 -153 135 93 76)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFDF9" />
          <stop offset=".48" stopColor="#FFF8EF" />
          <stop offset=".8" stopColor="#F2E5D5" />
          <stop offset="1" stopColor="#D8C4AE" />
        </radialGradient>
        <radialGradient id="orbHighlight" cx="0" cy="0" r="1" gradientTransform="matrix(48 54 -49 44 91 72)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity=".9" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <filter id="orbBloom" x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="15" />
        </filter>
        <filter id="orbShadow" x="-35%" y="-25%" width="170%" height="180%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="11" stdDeviation="10" floodColor="#000000" floodOpacity=".28" />
        </filter>
        <radialGradient id="eyeWell" cx=".5" cy=".5" r=".5">
          <stop className="eye-shade" offset="0" stopColor="#161616" />
          <stop className="eye-surface" offset="1" stopColor="#1a1a1a" />
        </radialGradient>
      </defs>

      <circle className="orb-bloom" cx="140" cy="140" r="106" fill="#FFF0DB" filter="url(#orbBloom)" />
      <path className="blob-shape" d="M141 29C202 29 251 77 251 139C251 199 207 247 146 251C83 254 31 208 29 146C27 84 74 32 134 29C136 29 139 29 141 29Z" fill="url(#orbSurface)" stroke="#FFFDFC" strokeOpacity=".88" strokeWidth="2" filter="url(#orbShadow)" />
      <ellipse cx="116" cy="83" rx="52" ry="39" fill="url(#orbHighlight)" opacity=".72" />
      <path d="M63 171C73 215 108 237 146 237" stroke="#C6AD92" strokeOpacity=".22" strokeWidth="2" strokeLinecap="round" />
      <path d="M217 76C237 95 246 119 246 144" stroke="#FFFFFF" strokeOpacity=".58" strokeWidth="2" strokeLinecap="round" />

      {/* Gaze, blink and speech light each act on the pair, never on just one eye.
          Only pose scale is local to an eye, with identical centered origins. */}
      <g className="eyes-gaze" style={{ '--eye-shift': `${6 * PIXEL_TO_SVG}px` }}>
        <g className="eyes-blink" style={{ transformOrigin: `${CENTER}px ${EYE_Y}px` }}>
          <g className="eyes-voice">
            {EYES.map((eye) => <Eye key={eye.side} {...eye} />)}
          </g>
        </g>
      </g>
    </svg>
  );
}

export default RobotAvatar;
