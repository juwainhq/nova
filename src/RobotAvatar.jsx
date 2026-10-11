import { APP_NAME } from './brand.js';

// NOVA's avatar. Purely presentational: every expression is driven by state classes
// on `.avatar-container` from index.css, so all motion lives in one place.
//
// There is deliberately no mouth. Expression comes from the eyes and the body only,
// so the eye markup is layered to let each kind of motion compose without fighting:
//
//   .robot-eye   — the outermost group; state transforms (the happy lift) apply here
//   .eye-tilt    — the resting lean, a plain presentation attribute
//   .eye-scale   — size: grow, squint, droop; a transitioned static transform
//   .eye-lid     — blinking, the only animated scaleY, plus iris glow
//
// Separate elements keep a blink from overriding a size change: nested transforms
// multiply, whereas sharing one element would make the animation win outright.
//
// The lean is a presentation attribute rather than a CSS rule on .robot-eye on
// purpose: CSS `transform` overrides the attribute, so `.is-happy .robot-eye` would
// silently straighten the eyes.

// Eye geometry, in viewBox units on a 280-wide canvas. The pair is the face's focal
// point: each pill is a quarter of the avatar's width, and the two together with the
// narrow gap between them span a little over half of it.
const EYE = {
  width: 58,
  height: 92,
  gap: 16, // between the facing edges, not between the centres
  cy: 112, // above the orb's midpoint, so the face reads as upper-centred
  // Both eyes lean the same way, which is what gives the pair its attitude. 5 degrees
  // was invisible at the 128px display size; 14 tips them over. 10 reads at both.
  lean: 10,
};

// A gap is measured between the facing edges, so each centre sits half a gap plus
// half an eye either side of the midline.
const EYE_CX = {
  left: 140 - (EYE.gap + EYE.width) / 2,
  right: 140 + (EYE.gap + EYE.width) / 2,
};

// A closed, upward-curving eye for the happy state, scaled to the pill it replaces.
function crescentPath(cx) {
  const half = EYE.width * 0.37;
  const lift = EYE.height * 0.22;
  const foot = EYE.height * 0.09;
  return `M${cx - half} ${EYE.cy + foot}Q${cx} ${EYE.cy - lift} ${cx + half} ${EYE.cy + foot}`;
}

const EYES = ['left', 'right'].map((side) => ({ side, cx: EYE_CX[side] }));

function Eye({ side, cx }) {
  const x = cx - EYE.width / 2;
  const y = EYE.cy - EYE.height / 2;
  const radius = EYE.width / 2;
  return (
    <g className={`robot-eye robot-eye-${side}`}>
      <g className="eye-tilt" transform={`rotate(${EYE.lean} ${cx} ${EYE.cy})`}>
        <g className="eye-drift">
          <g className="eye-scale">
            <g className="eye-lid">
              {/* A capsule: corner radius equal to half the width, so both ends are
                  true semicircles. The vertical gradient is the inner shadow — the
                  well is dark where it turns away from the light at the top and lifts
                  toward the bottom, which is what stops a solid dark shape reading as
                  flat. */}
              <rect
                className="eye-iris"
                x={x}
                y={y}
                width={EYE.width}
                height={EYE.height}
                rx={radius}
                ry={radius}
                fill="url(#eyeWell)"
              />
              {/* No highlight. A gleam this size reads as a pupil and makes the eye
                  look like a ball; the depth comes from the well gradient instead. */}
            </g>
          </g>
          {/* Inside the drift layer, so a blink and a drift never fight: the crescent
              has to travel with the eye it replaces. */}
          <path className="eye-crescent" d={crescentPath(cx)} stroke="#2A1C13" strokeWidth={EYE.width * 0.1} strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

function RobotAvatar() {
  return (
    <svg className="robot-avatar" viewBox="0 0 280 280" fill="none" role="img" aria-label={`${APP_NAME}, a softly glowing orb with expressive eyes`}>
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
        <linearGradient id="eyeWell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0A0604" />
          <stop offset=".5" stopColor="#180F0A" />
          <stop offset="1" stopColor="#2B1C14" />
        </linearGradient>
      </defs>

      <circle className="orb-bloom" cx="140" cy="140" r="106" fill="#FFF0DB" filter="url(#orbBloom)" />
      <path className="blob-shape" d="M141 29C202 29 251 77 251 139C251 199 207 247 146 251C83 254 31 208 29 146C27 84 74 32 134 29C136 29 139 29 141 29Z" fill="url(#orbSurface)" stroke="#FFFDFC" strokeOpacity=".88" strokeWidth="2" filter="url(#orbShadow)" />
      <ellipse cx="116" cy="83" rx="52" ry="39" fill="url(#orbHighlight)" opacity=".72" />
      <path d="M63 171C73 215 108 237 146 237" stroke="#C6AD92" strokeOpacity=".22" strokeWidth="2" strokeLinecap="round" />
      <path d="M217 76C237 95 246 119 246 144" stroke="#FFFFFF" strokeOpacity=".58" strokeWidth="2" strokeLinecap="round" />

      {EYES.map((eye) => <Eye key={eye.side} {...eye} />)}
    </svg>
  );
}

export default RobotAvatar;
