import { useCallback, useEffect, useMemo, useState } from 'react';
import { AVATAR_REACTIONS, validAvatarExpression } from './avatar-expressions.js';

// Presentation-only clock, separate from the assistant's state machine. A fresh
// sequence identity hides stale reactions immediately, even idle → busy → idle.
export default function useAvatarExpression(requested) {
  const activity = validAvatarExpression(requested);
  const [restart, setRestart] = useState(0);
  const sequence = useMemo(() => ({ activity, restart }), [activity, restart]);
  const [reaction, setReaction] = useState(null);

  useEffect(() => {
    const steps = AVATAR_REACTIONS[activity];
    if (!steps) return undefined;
    const start = Date.now();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let alive = true;
    let timers = [];
    const clear = () => { timers.forEach((timer) => window.clearTimeout(timer)); timers = []; };
    const publish = (face) => { if (alive) setReaction({ sequence, face }); };
    const schedule = () => {
      clear();
      const elapsed = Date.now() - start;
      let current = activity;
      for (const step of steps) {
        // Reduced motion still communicates rest, but skips decorative winks.
        if (reduced?.matches && step.decorative) continue;
        if (step.after <= elapsed) current = step.face;
        else timers.push(window.setTimeout(() => publish(step.face), step.after - elapsed));
      }
      publish(current);
    };
    schedule();
    reduced?.addEventListener?.('change', schedule);
    return () => {
      alive = false;
      clear();
      reduced?.removeEventListener?.('change', schedule);
    };
  }, [activity, sequence]);

  // Hover/touch wakes only the drawing. Activity changes already cancel all
  // reactions; no click can interrupt a reply or start recognition.
  const wakeDrawing = useCallback(() => {
    if (activity === 'idle') setRestart((value) => value + 1);
  }, [activity]);

  return { activity, face: reaction?.sequence === sequence ? reaction.face : activity, wakeDrawing };
}
