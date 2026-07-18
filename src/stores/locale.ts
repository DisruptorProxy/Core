import { createEffect, createSignal, createStore } from 'azerothjs';

import { en } from '../lib/i18n/en';
import { fa } from '../lib/i18n/fa';
import type { Strings } from '../lib/i18n/types';

export type Locale = 'en' | 'fa';
export type Direction = 'ltr' | 'rtl';

const STORAGE_KEY = 'guardian.locale';

const DICTIONARIES: Record<Locale, Strings> =
{
    en,
    fa
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['fa']);

const isLocale = (value: string | null): value is Locale => value === 'en' || value === 'fa';

const readStored = (): Locale =>
{
    const stored = localStorage.getItem(STORAGE_KEY);

    return isLocale(stored) ? stored : 'en';
};

/**
 * Locale and text direction. `t()` returns the whole dictionary rather than
 * doing key lookup by string, so a typo is a type error and a renamed string
 * cannot silently render as its own key.
 *
 * Direction is applied to <html>, never to individual components: every layout
 * uses logical properties (ms/me, ps/pe, start/end), so flipping `dir` mirrors
 * the entire app with no per-component work.
 */
export const useLocale = createStore(() =>
{
    const [locale, setLocale] = createSignal<Locale>(readStored());

    const direction = (): Direction => (RTL_LOCALES.has(locale()) ? 'rtl' : 'ltr');
    const t = (): Strings => DICTIONARIES[locale()];

    createEffect(() =>
    {
        const root = document.documentElement;

        root.lang = locale();
        root.dir = direction();
    }, { name: 'locale-document' });

    createEffect(() =>
    {
        localStorage.setItem(STORAGE_KEY, locale());
    }, { name: 'locale-persist' });

    return {
        locale,
        direction,
        setLocale,
        t
    };
});
