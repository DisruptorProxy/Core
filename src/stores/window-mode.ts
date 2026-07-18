import { createSignal, createStore } from 'azerothjs';

import { LogicalSize, getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Compact is the phone-shaped default (fixed 400x720, matching tauri.conf.json);
 * expanded is a resizable desktop layout bounded by max width 1000 and min
 * height 560 - past the md breakpoint the shell swaps the tab bar for the rail
 * by CSS, so the layout follows the REAL width, not this flag.
 */
export type WindowMode = 'compact' | 'expanded';

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

/** Resizes/centres the native window for `mode`; a no-op in a plain browser. */
const applyToWindow = async (mode: WindowMode): Promise<void> =>
{
    if (!isTauri())
    {
        return;
    }

    const current = getCurrentWindow();

    if (mode === 'expanded')
    {
        await current.setResizable(true);
        await current.setMinSize(EXPANDED_MIN);
        await current.setMaxSize(EXPANDED_MAX);
        await current.setSize(EXPANDED);
    }
    else
    {
        // Pin both bounds to the fixed size BEFORE resizing so no intermediate
        // clamp fights the resize, then lock resizing again.
        await current.setMinSize(COMPACT);
        await current.setMaxSize(COMPACT);
        await current.setSize(COMPACT);
        await current.setResizable(false);
    }

    await current.center();
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
