import type { FallbackLng, i18n } from "i18next";

/**
 * Normalizes a locale code the way i18next does internally.
 *
 * Telegram clients occasionally send underscore-separated tags (`pt_BR`) and
 * i18next only canonicalizes hyphenated ones, so the separator is normalized
 * first and the result is then run through i18next's own `formatLanguageCode`
 * (`pt-br` becomes `pt-BR`). If the instance is not initialized yet, its
 * language utilities do not exist and only the separator is normalized.
 *
 * @param instance The i18next instance whose language utilities to use.
 * @param locale The locale code to normalize.
 * @returns The canonical form of the locale code.
 */
export function normalizeLocale(instance: i18n, locale: string): string {
    const hyphenated = locale.replaceAll("_", "-");
    // `Services["languageUtils"]` is typed as `any` by i18next, so the call is
    // isolated here and guarded at runtime instead of being typed.
    const format: unknown = instance.services?.languageUtils
        ?.formatLanguageCode;
    if (typeof format !== "function") return hyphenated;
    const formatted: unknown = format.call(
        instance.services.languageUtils,
        hyphenated,
    );
    return typeof formatted === "string" ? formatted : hyphenated;
}

/**
 * Extracts the first locale of an i18next `fallbackLng` option.
 *
 * Handles all shapes i18next accepts: a single code, an array of codes, and a
 * map of codes with a `default` entry. Per-code fallback functions have no
 * single default locale, so `undefined` is returned for those.
 *
 * @param fallback The `fallbackLng` value of an i18next instance.
 * @returns The first fallback locale, or `undefined` if there is none.
 */
export function firstFallbackLocale(
    fallback: FallbackLng | false | undefined,
): string | undefined {
    if (typeof fallback === "string") return fallback;
    if (Array.isArray(fallback)) return fallback[0];
    if (typeof fallback === "object" && fallback !== null) {
        const record = fallback as Record<string, FallbackLng>;
        return firstFallbackLocale(record.default);
    }
    return undefined;
}
