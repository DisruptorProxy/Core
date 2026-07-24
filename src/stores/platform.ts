import { createSignal, createStore } from 'azerothjs';

import { invoke } from '@tauri-apps/api/core';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type OsKind = 'windows' | 'linux' | 'macos' | 'android' | 'ios';

/** The desktop OSes: they get window chrome (titlebar), a tray, and the window-mode
 *  toggle. Mobile (android/ios) has none of that - the OS owns the window. */
const DESKTOP: ReadonlySet<OsKind> = new Set<OsKind>(['windows', 'linux', 'macos']);

/**
 * A synchronous first guess, so the shell can decide about window chrome on the very
 * first paint rather than flashing a titlebar on a phone. The mobile webviews carry
 * their platform in the user-agent; everything else - the three desktop OSes and
 * browser dev - reads as desktop (the exact desktop OS doesn't matter for gating and is
 * refined by `platform_kind` below).
 */
const guessOs = (): OsKind =>
{
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    if (/android/i.test(ua))
    {
        return 'android';
    }

    if (/iphone|ipad|ipod/i.test(ua))
    {
        return 'ios';
    }

    return 'windows';
};

/**
 * Which OS the app is running on, and the desktop-vs-mobile split the UI branches on.
 *
 * The authoritative answer comes from Rust (`platform_kind`), but that is async, so the
 * store seeds itself synchronously from the user-agent and corrects once the command
 * resolves - the two only ever disagree, if at all, for a single frame. Off-Tauri
 * (browser dev) there is nothing to ask, so the seed stands and reads as desktop.
 */
export const usePlatform = createStore(() =>
{
    const [os, setOs] = createSignal<OsKind>(guessOs());

    if (isTauri())
    {
        void invoke<string>('platform_kind')
            .then((kind) => setOs(kind as OsKind))
            .catch(() =>
            {
                // Keep the user-agent guess - a failed platform read must not blank the UI.
            });
    }

    const isDesktop = (): boolean => DESKTOP.has(os());
    const isMobile = (): boolean => !isDesktop();

    return { os, isDesktop, isMobile };
});

/**
 * A synchronous desktop-vs-mobile check from the user-agent, for code outside the reactive
 * store (e.g. the connection engine choosing the native VPN plugin over the desktop core).
 * The mobile webviews carry their platform in the UA, so this is reliable without waiting
 * on the async `platform_kind` command.
 */
export const isMobilePlatform = (): boolean =>
{
    const os = guessOs();

    return os === 'android' || os === 'ios';
};
