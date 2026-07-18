import { createEffect } from 'azerothjs';

import { defaultWindowIcon } from '@tauri-apps/api/app';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** The tray's localized strings, read reactively so a locale switch re-labels the menu. */
interface TrayLabels
{
    tooltip: string;
    show: string;
    quit: string;
}

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Restores the window from the tray: visible, un-minimized, focused. */
const showWindow = async (): Promise<void> =>
{
    const current = getCurrentWindow();

    await current.show();
    await current.unminimize();
    await current.setFocus();
};

const buildMenu = async (labels: TrayLabels): Promise<Menu> =>
    Menu.new({
        items:
        [
            await MenuItem.new({ id: 'show', text: labels.show, action: () => void showWindow() }),
            // Quit goes through close(), the same graceful path as the titlebar
            // button, so engine teardown behaves identically from both exits.
            await MenuItem.new({ id: 'quit', text: labels.quit, action: () => void getCurrentWindow().close() })
        ]
    });

let installed = false;

/**
 * Puts Guardian in the system tray: left-click restores the window, the menu
 * offers Show/Quit. A no-op in a plain browser and on a second call. Call it
 * from a component scope - the locale is tracked with an effect, so the menu
 * re-labels live when the language changes.
 */
export const installTray = (labels: () => TrayLabels): void =>
{
    if (!isTauri() || installed)
    {
        return;
    }

    installed = true;

    let tray: TrayIcon | null = null;

    createEffect(() =>
    {
        const current = labels();

        void (async (): Promise<void> =>
        {
            if (tray === null)
            {
                tray = await TrayIcon.new({
                    id: 'guardian',
                    tooltip: current.tooltip,
                    icon: (await defaultWindowIcon()) ?? undefined,
                    showMenuOnLeftClick: false,
                    menu: await buildMenu(current),
                    action: (event) =>
                    {
                        if (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Down')
                        {
                            void showWindow();
                        }
                    }
                });
            }
            else
            {
                await tray.setTooltip(current.tooltip);
                await tray.setMenu(await buildMenu(current));
            }
        })();
    }, { name: 'tray-locale' });
};
