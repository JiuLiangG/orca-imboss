import { DEFAULT_LOCALE } from "./constants/locales";

type Translations = { [locale: string]: { [key: string]: string } };

let _locale = DEFAULT_LOCALE;
let _translations: Translations = {};

/**
 * Set the active locale and the built-in translation dictionary.
 * English keys are used verbatim when no translation exists for the active
 * locale, so an `en` dictionary is intentionally not required.
 */
export function setupL10N(
  locale: string,
  builtinTranslations: Translations,
): void {
  _locale = locale;
  _translations = builtinTranslations;
}

export function getLocale(): string {
  return _locale;
}

/**
 * Translate `key` for the active (or explicit) locale. Falls back to the key
 * itself (English) when no translation is found. Supports `${name}` interpolation.
 */
export function t(
  key: string,
  args?: { [key: string]: string },
  locale?: string,
): string {
  const template = _translations[locale ?? _locale]?.[key] ?? key;
  if (args == null) return template;
  return Object.entries(args).reduce(
    (str, [name, val]) => str.replaceAll(`\${${name}}`, val),
    template,
  );
}
