import { type FallbackLng, type i18n, isSafeLanguageCode } from "i18next";

/**
 * Whether a locale code has a shape that is safe to accept from outside the
 * bot's own code: the `language_code` of an update, a value read back from a
 * locale store, or user input handed to `ctx.i18n.setLocale`.
 *
 * This is i18next's own rule (`isSafeLanguageCode`): letters, digits, `-`,
 * `_`, `@` and `.`, no `..`, at most 128 characters, and not a prototype key.
 * It is deliberately not a BCP 47 check, so `en_US` and `sr@latin` pass. What
 * it keeps out is everything a locale must never carry into a file path, a
 * URL, markup, or a log line.
 *
 * @param locale The value to check.
 * @returns `true` if the value is a non-empty, safely shaped locale code.
 */
export function isSafeLocale(locale: unknown): locale is string {
    return typeof locale === "string" && isSafeLanguageCode(locale);
}

/**
 * Renders an untrusted locale value for a log line: truncated, quoted, and
 * with control characters escaped, so that it cannot forge log entries.
 *
 * @param locale The value to render.
 * @returns A quoted, single-line representation of the value.
 */
export function printableLocale(locale: unknown): string {
    return JSON.stringify(String(locale).slice(0, 64))
        .replace(/[\u007f-\u009f]/g, "?");
}

/**
 * Lists a locale code together with its less specific parents, lowercased:
 * `zh-Hant-TW` yields `zh-hant-tw`, `zh-hant`, and `zh`. This mirrors the
 * language hierarchy i18next resolves translations along.
 *
 * @param locale A hyphen-separated locale code.
 * @returns The code and its parents, most specific first.
 */
export function localeChain(locale: string): string[] {
    const parts = locale.toLowerCase().split("-");
    return parts.map((_, index) =>
        parts.slice(0, parts.length - index).join("-")
    );
}

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
