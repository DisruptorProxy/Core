import { createEffect, createSignal, createStore } from 'azerothjs';

import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';
import { es } from '../lib/i18n/es';
import { fa } from '../lib/i18n/fa';
import { hi } from '../lib/i18n/hi';
import { id } from '../lib/i18n/id';
import { ru } from '../lib/i18n/ru';
import { tr } from '../lib/i18n/tr';
import { vi } from '../lib/i18n/vi';
import { zh } from '../lib/i18n/zh';
import type { Strings } from '../lib/i18n/types';

export type Locale = 'en' | 'fa' | 'ar' | 'zh' | 'ru' | 'tr' | 'hi' | 'es' | 'vi' | 'id';
type Direction = 'ltr' | 'rtl';

const STORAGE_KEY = 'guardian.locale';

const DICTIONARIES: Record<Locale, Strings> =
{
    en,
    fa,
    ar,
    zh,
    ru,
    tr,
    hi,
    es,
    vi,
    id
};

/** Display order of the language picker. */
export const LOCALES: Locale[] = ['en', 'fa', 'ar', 'zh', 'ru', 'tr', 'hi', 'es', 'vi', 'id'];

/**
 * Each language named in ITSELF (endonym) - deliberately identical across
 * locales, so the picker stays readable to someone stuck in the wrong language.
 */
export const LOCALE_LABELS: Record<Locale, string> =
{
    en: 'English',
    fa: 'فارسی',
    ar: 'العربية',
    zh: '中文',
    ru: 'Русский',
    tr: 'Türkçe',
    hi: 'हिन्दी',
    es: 'Español',
    vi: 'Tiếng Việt',
    id: 'Bahasa Indonesia'
};

/**
 * A representative country per language, for the picker's flag - a visual anchor,
 * not a claim of ownership (zh/es/ar all span many countries; these are simply the
 * most recognizable choice for each).
 */
export const LOCALE_COUNTRY: Record<Locale, string> =
{
    en: 'us',
    fa: 'ir',
    ar: 'sa',
    zh: 'cn',
    ru: 'ru',
    tr: 'tr',
    hi: 'in',
    es: 'es',
    vi: 'vn',
    id: 'id'
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['fa', 'ar']);

const isLocale = (value: string | null): value is Locale =>
    value !== null && (LOCALES as string[]).includes(value);

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
