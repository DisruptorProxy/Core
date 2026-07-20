import { createSignal, createStore } from 'azerothjs';

import { LogicalSize, getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Compact is the phone-shaped default (fixed 400x720, matching tauri.conf.json);
 * expanded is a resizable desktop layout bounded by max width 1000 and min
 * height 560 - past the md breakpoint the shell swaps the tab bar for the rail
 * by CSS, so the layout follows the REAL width, not this flag.
 */
type WindowMode = 'compact' | 'expanded';

const STORAGE_KEY = 'guardian.window-mode';

const COMPACT = new LogicalSize(400, 720);
/** The size an expand lands on - comfortably inside the bounds below. */
const EXPANDED = new LogicalSize(960, 680);
/** Expanded bounds: the user may drag-resize between these. */
const EXPANDED_MIN = new LogicalSize(400, 560);
const EXPANDED_MAX = new LogicalSize(1000, 1400);

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const readStored = (): WindowMode =>
    (localStorage.getItem(STORAGE_KEY) === 'expanded' ? 'expanded' : 'compact');

/**
 * Resizes/centres the native window for `mode`; a no-op in a plain browser.
 *
 * Each call is its own IPC round-trip to the OS, so five sequential `await`s
 * read as a visible lag between tapping the titlebar button and the window
 * actually moving. The two bound calls (min/max) are independent of each other
 * and safe to fire together; only their ORDER relative to `setSize` matters
 * (bounds must land first, or an intermediate clamp fights the resize) - so
 * this batches everything that can overlap and keeps only the true dependency
 * chain sequential.
 */
const applyToWindow = async (mode: WindowMode): Promise<void> =>
{
    if (!isTauri())
    {
        return;
    }

    const current = getCurrentWindow();

    if (mode === 'expanded')
    {
        await Promise.all([
            current.setResizable(true),
            current.setMinSize(EXPANDED_MIN),
            current.setMaxSize(EXPANDED_MAX)
        ]);
        await current.setSize(EXPANDED);
        await current.center();
    }
    else
    {
        await Promise.all([
            current.setMinSize(COMPACT),
            current.setMaxSize(COMPACT)
        ]);
        await current.setSize(COMPACT);
        await Promise.all([
            current.setResizable(false),
            current.center()
        ]);
    }
};

/**
 * The window-mode toggle behind the titlebar button. A lazy singleton like the
 * theme store: the persisted mode is re-applied once on startup (the window
 * itself always OPENS compact - that is what tauri.conf.json describes).
 */
export const useWindowMode = createStore(() =>
{
    const [mode, setMode] = createSignal<WindowMode>(readStored());

    // Restore a persisted expanded mode on startup. Fire-and-forget: the app is
    // fully usable at the compact size while the resize settles.
    if (mode() === 'expanded')
    {
        void applyToWindow('expanded');
    }

    const toggle = (): void =>
    {
        const next: WindowMode = mode() === 'compact' ? 'expanded' : 'compact';

        setMode(next);
        localStorage.setItem(STORAGE_KEY, next);
        void applyToWindow(next);
    };

    return { mode, toggle };
});
