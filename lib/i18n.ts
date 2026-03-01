// lib/i18n.ts — Internationalization module
// Flat key-value JSON locale files, {param} interpolation

import type { SupportedLanguage } from './types.ts';

const browser: typeof chrome = typeof (globalThis as Record<string, unknown>).browser !== 'undefined' ? (globalThis as unknown as { browser: typeof chrome }).browser : chrome;

const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', native: 'English', flag: '\u{1F1FA}\u{1F1F8}', prompt: 'Select your language' },
  { code: 'es', name: 'Spanish', native: 'Espa\u00f1ol', flag: '\u{1F1EA}\u{1F1F8}', prompt: 'Selecciona tu idioma' },
  { code: 'pt', name: 'Portuguese', native: 'Portugu\u00eas', flag: '\u{1F1E7}\u{1F1F7}', prompt: 'Selecione seu idioma' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}', prompt: 'W\u00e4hle deine Sprache' },
  { code: 'fr', name: 'French', native: 'Fran\u00e7ais', flag: '\u{1F1EB}\u{1F1F7}', prompt: 'Choisissez votre langue' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: '\u{1F1EE}\u{1F1F9}', prompt: 'Seleziona la tua lingua' }
];

const DEFAULT_LANG = 'en';
const localeCache: Record<string, Record<string, string>> = {};
let currentLang: string = DEFAULT_LANG;
let currentStrings: Record<string, string> = {};
let langWasChosen: boolean = false;

async function loadLocale(lang: string): Promise<Record<string, string>> {
  if (localeCache[lang]) return localeCache[lang];
  try {
    const url = browser.runtime.getURL(`locales/${lang}.json`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: Record<string, string> = await resp.json();
    localeCache[lang] = data;
    return data;
  } catch (e) {
    console.warn(`[i18n] Failed to load locale "${lang}":`, e);
    if (lang !== DEFAULT_LANG) return loadLocale(DEFAULT_LANG);
    return {};
  }
}

/**
 * Translate a key with optional parameter interpolation.
 * @param key - Dot-separated key, e.g. "wizard.title"
 * @param params - Replacement map, e.g. { count: 5 }
 * @returns Translated string or the key itself as fallback
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let str = currentStrings[key];
  if (str === undefined) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

/**
 * Initialize i18n: read saved language and load locale strings.
 * Call this in DOMContentLoaded before other setup.
 * @returns The language code that was loaded
 */
export async function initI18n(): Promise<string> {
  try {
    // Try sync first, fall back to local
    let lang: string | undefined;
    try {
      const data = await browser.storage.sync.get(['language']);
      lang = data.language as string | undefined;
    } catch { /* sync unavailable */ }
    if (!lang) {
      try {
        const data = await browser.storage.local.get(['language']);
        lang = data.language as string | undefined;
      } catch { /* local unavailable */ }
    }
    currentLang = lang || DEFAULT_LANG;
    langWasChosen = !!lang;
  } catch {
    currentLang = DEFAULT_LANG;
  }
  currentStrings = await loadLocale(currentLang);
  document.documentElement.lang = currentLang;
  return currentLang;
}

/**
 * Switch language: save preference and reload locale strings.
 * @param lang - Language code, e.g. "es"
 */
export async function setLanguage(lang: string): Promise<void> {
  currentLang = lang;
  langWasChosen = true;
  // Save to both sync and local for reliability
  const saveData = { language: lang };
  await Promise.allSettled([
    browser.storage.sync.set(saveData),
    browser.storage.local.set(saveData),
  ]);
  currentStrings = await loadLocale(lang);
  document.documentElement.lang = lang;
}

/**
 * Get current language code.
 */
export function getLanguage(): string {
  return currentLang;
}

/**
 * Check if a language has been explicitly chosen by the user.
 */
export function isLanguageChosen(): boolean {
  return langWasChosen;
}

/**
 * Get list of supported languages.
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return SUPPORTED_LANGUAGES;
}
