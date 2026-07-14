import { animate } from 'motion';
import type { AnimationPlaybackControls } from 'motion';

/**
 * Motion is spent in exactly two places in this app: the connection gate opening,
 * and sheets/drawers arriving. Rows are never animated - at 8000 of them, motion
 * on a row is a dropped frame, not a delight.
 */

const REDUCED = '(prefers-reduced-motion: reduce)';

/** True when the user asked the OS for less motion. Checked at call time, not cached. */
export const prefersReducedMotion = (): boolean => window.matchMedia(REDUCED).matches;

/** Sheets and drawers: a spring that settles quickly, no bounce on exit. */
export const SHEET_SPRING = { type: 'spring', stiffness: 420, damping: 38 } as const;

/** The gate: slower and heavier, because it is the one moment that should feel physical. */
export const GATE_SPRING = { type: 'spring', stiffness: 180, damping: 24 } as const;

/**
 * `animate()` with the reduced-motion contract applied: the element still ends in
 * the target state, it just gets there instantly. Callers never branch on the
 * media query themselves.
 */
export const motion = (
    element: Element,
    keyframes: Parameters<typeof animate>[1],
    options?: Parameters<typeof animate>[2]
): AnimationPlaybackControls =>
{
    if (prefersReducedMotion())
    {
        return animate(element, keyframes, { ...options, duration: 0 });
    }

    return animate(element, keyframes, options);
};
