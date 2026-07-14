/**
 * Joins class names, dropping anything falsy.
 *
 * Why this exists rather than the framework's `class:name={cond}` directive:
 * Tailwind finds classes by scanning source TEXT, and it reads `class:bg-good={x}`
 * as one unknown candidate - so a class that only ever appears in a directive is
 * never emitted into the stylesheet and silently does nothing. Every conditional
 * class in this app therefore goes through cx(), where the class name appears as
 * a plain string literal that Tailwind can see.
 */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
    parts.filter(Boolean).join(' ');
