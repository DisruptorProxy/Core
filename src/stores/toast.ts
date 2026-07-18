import { createSignal, createStore } from 'azerothjs';

/** Toast tone. `error` lingers longer than `success`/`info`. */
export type ToastKind = 'success' | 'error' | 'info';

interface Toast
{
    id: number;
    kind: ToastKind;
    message: string;
    /** True while the leave animation plays, just before removal. */
    leaving: boolean;
}

/** Newest-at-most this many on screen; a burst drops the oldest. */
const MAX = 4;
const DEFAULT_MS = 3500;
const ERROR_MS = 6000;
/** Matches the g-toast-out animation in styles.css. */
const LEAVE_MS = 200;

/**
 * App-wide transient status, shown by the single ToastHost mounted in the shell.
 * A store (not prop-threading) because the trigger - a bulk delete, a copy, an
 * async result - is often deep in a sheet or bar that closes the instant it fires,
 * so the confirmation has to live somewhere the closing control does not.
 *
 * Callers pass a fully-formed, already-localized message; the store stays i18n-free.
 */
export const useToast = createStore(() =>
{
    const [toasts, setToasts] = createSignal<Toast[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextId = 1;

    const clearTimer = (id: number): void =>
    {
        const timer = timers.get(id);

        if (timer !== undefined)
        {
            clearTimeout(timer);
            timers.delete(id);
        }
    };

    const remove = (id: number): void =>
    {
        clearTimer(id);
        setToasts(toasts().filter((toast) => toast.id !== id));
    };

    /** Begins the leave animation, then removes. Idempotent (a second call no-ops). */
    const dismiss = (id: number): void =>
    {
        const current = toasts().find((toast) => toast.id === id);

        if (current === undefined || current.leaving)
        {
            return;
        }

        clearTimer(id);
        setToasts(toasts().map((toast) => toast.id === id ? { ...toast, leaving: true } : toast));
        window.setTimeout(() => remove(id), LEAVE_MS);
    };

    const show = (kind: ToastKind, message: string, duration?: number): number =>
    {
        const id = nextId++;
        const next = [...toasts(), { id, kind, message, leaving: false }];

        // Cap the queue: drop the oldest (and its timer) beyond MAX.
        while (next.length > MAX)
        {
            const dropped = next.shift();

            if (dropped !== undefined)
            {
                clearTimer(dropped.id);
            }
        }

        setToasts(next);
        timers.set(id, setTimeout(() => dismiss(id), duration ?? (kind === 'error' ? ERROR_MS : DEFAULT_MS)));

        return id;
    };

    return {
        toasts,
        show,
        success: (message: string, duration?: number): number => show('success', message, duration),
        error: (message: string, duration?: number): number => show('error', message, duration),
        info: (message: string, duration?: number): number => show('info', message, duration),
        dismiss
    };
});
