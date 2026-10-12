import { APP_NAME } from './brand.js';

// The face is a soft blob of surface colour with two pure-white oval eyes, and the
// eyes are the only thing on it that ever moves with meaning. Sizes are deliberately
// expressed as fractions of --avatar-size in the stylesheet (22 × 34 CSS pixels with a
// 24px gap at the default 180px), so every compact viewport stays proportional.
// This component only carries what cannot live in CSS: the accessibility contract and
// the one pose variable, as a fraction of the avatar so a shift never overshoots.
const EYE_SHIFT = 1 / 18; // ≈10px at 180px: both eyes drop, together, while thinking.

function RobotAvatar() {
  return (
    <div className="robot-avatar" role="img" aria-label={`${APP_NAME}, a soft shape with two white eyes`}>
      {/* Body colour and the slow radius morph live on this child, so the pose and the
          rhythm can keep composing on separate ancestors. */}
      <div className="avatar-blob" />
      {/* Gaze, blink and speech rhythm each act on the pair, never on just one eye.
          Identical markup and no per-side style means both eyes always match. */}
      <div className="eyes-gaze" style={{ '--eye-shift': `${EYE_SHIFT}` }}>
        <div className="eyes-blink">
          <div className="eyes-voice">
            <span className="robot-eye robot-eye-left" />
            <span className="robot-eye robot-eye-right" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default RobotAvatar;
