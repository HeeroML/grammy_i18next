/**
 * Differential tests against the real `@grammyjs/i18n@1.1.2` `Fluent` class.
 *
 * The oracle is the published npm build, loaded in-process under Deno (see
 * `./oracle.ts` for the one permission quirk of its `dnt` shim). Its `Fluent`
 * class touches the file system only for the `filePath` variant of
 * `addTranslation`, which these tests do not use. No generated fixture is
 * involved: both engines run in the same process, over the same `.ftl` files
 * in `test/fixtures/fluent/diff/`, so time zone and ICU data are identical by
 * construction.
 *
 * Note that the oracle brings its own `@fluent/bundle@0.17.1` while this
 * package uses `0.19.1`; every output compared below was verified to be
 * byte-identical across the two.
 */
import { expect } from "@std/expect";
import { fromFileUrl, join } from "@std/path";
import type { Fluent } from "@grammyjs/i18n";
import type { i18n } from "i18next";
import { createFluentI18next } from "../../src/fluent/mod.ts";
import { loadOracle } from "./oracle.ts";

const Oracle = await loadOracle();

const DIR = fromFileUrl(
    new URL("../fixtures/fluent/diff", import.meta.url),
);
const EN = await Deno.readTextFile(join(DIR, "en.ftl"));
const DE = await Deno.readTextFile(join(DIR, "de.ftl"));
const RU = await Deno.readTextFile(join(DIR, "ru.ftl"));

type Variables = Record<string, string | number | Date>;

const UPPER = (positional: unknown[]): string =>
    String(positional[0]).toUpperCase();

/** Builds the oracle over the shared fixtures. */
function oracle(useIsolating = true): Fluent {
    const bundleOptions = { functions: { UPPER }, useIsolating };
    const fluent = new Oracle({ warningHandler: () => {} });
    fluent.addTranslationSync({
        locales: "en",
        source: EN,
        isDefault: true,
        bundleOptions,
    });
    fluent.addTranslationSync({ locales: "de", source: DE, bundleOptions });
    fluent.addTranslationSync({ locales: "ru", source: RU, bundleOptions });
    return fluent;
}

/** Builds this package's engine over the shared fixtures, in compat mode. */
function subject(useIsolating = true): Promise<i18n> {
    return createFluentI18next({
        defaultLocale: "en",
        resources: { en: EN, de: DE, ru: RU },
        compat: true,
        bundleOptions: { functions: { UPPER }, useIsolating },
        onError: () => {},
    });
}

/** Asserts that both engines return the same string, and returns it. */
function same(
    fluent: Fluent,
    i18next: i18n,
    locale: string,
    key: string,
    variables?: Variables,
): string {
    const expected = fluent.translate(locale, key, variables);
    const actual = i18next.getFixedT(locale)(key, variables);
    expect(actual).toBe(expected);
    return actual;
}

const fluent = oracle();
const i18next = await subject();

Deno.test("identical: simple, multiline and unicode messages", () => {
    expect(same(fluent, i18next, "en", "simple")).toBe("Just text");
    expect(same(fluent, i18next, "en", "multiline")).toBe(
        "Line one\nLine two",
    );
    same(fluent, i18next, "en", "unicode", { name: "Ω" });
    same(fluent, i18next, "en", "escaped");
});

Deno.test("identical: variables", () => {
    same(fluent, i18next, "en", "greeting", { name: "Jane" });
    same(fluent, i18next, "de", "greeting", { name: "Welt" });
});

Deno.test("identical: message references, terms and term arguments", () => {
    same(fluent, i18next, "en", "about");
    same(fluent, i18next, "en", "this-thing");
    same(fluent, i18next, "en", "term-attr");
    same(fluent, i18next, "en", "ref");
});

Deno.test("identical: select expressions and numeric variants", () => {
    for (const n of [0, 1, 7]) same(fluent, i18next, "en", "numeric", { n });
});

Deno.test("identical: plural categories (en one/other, ru one/few/many)", () => {
    for (const count of [0, 1, 2, 5]) {
        same(fluent, i18next, "en", "emails", { count });
        same(fluent, i18next, "ru", "emails", { count });
        same(fluent, i18next, "de", "emails", { count });
    }
});

Deno.test("identical: attributes", () => {
    same(fluent, i18next, "en", "login.tooltip", { user: "Ada" });
    same(fluent, i18next, "en", "login");
});

Deno.test("identical: NUMBER() and DATETIME()", () => {
    same(fluent, i18next, "en", "pi", { pi: 3.14159 });
    same(fluent, i18next, "en", "price", { amount: 1234.5 });
    same(fluent, i18next, "de", "price", { amount: 1234.5 });
    const date = new Date(Date.UTC(2026, 7, 31, 12, 0, 0));
    same(fluent, i18next, "en", "when", { date });
    same(fluent, i18next, "de-DE", "when", { date });
});

Deno.test("identical: custom functions", () => {
    same(fluent, i18next, "en", "custom", { word: "abc" });
});

Deno.test("identical: isolation on and off", async () => {
    for (const useIsolating of [true, false]) {
        const oracleBundle = oracle(useIsolating);
        const ours = await subject(useIsolating);
        same(oracleBundle, ours, "en", "greeting", { name: "J" });
        same(oracleBundle, ours, "en", "about");
        same(oracleBundle, ours, "en", "simple");
    }
});

Deno.test("identical: region fallback and default locale fallback", () => {
    // The oracle negotiates with @fluent/langneg, this package uses i18next's
    // resolve hierarchy — the outcome agrees for both region forms.
    same(fluent, i18next, "de-DE", "greeting", { name: "Welt" });
    same(fluent, i18next, "de-AT", "greeting", { name: "Welt" });
    same(fluent, i18next, "de-DE", "about");
    same(fluent, i18next, "de", "simple");
    expect(same(fluent, i18next, "fr", "simple")).toBe("Just text");
});

Deno.test("identical: missing message, missing attribute, value-less message", () => {
    expect(same(fluent, i18next, "en", "nope")).toBe("{nope}");
    expect(same(fluent, i18next, "en", "login.nope")).toBe("{login.nope}");
    expect(same(fluent, i18next, "en", "noval")).toBe("");
});

Deno.test("identical: duplicate ids inside one source (last wins)", () => {
    expect(same(fluent, i18next, "en", "dup")).toBe("second");
});

Deno.test("intentional difference: the oracle throws on unknown references", async () => {
    const source = "unknown-var = Hi { $name }\nunknown-msg = { nowhere }\n" +
        "unknown-fn = { NOPE($a) }\nunknown-term = { -nothing }\n";
    const oracleBundle = new Oracle({ warningHandler: () => {} });
    oracleBundle.addTranslationSync({
        locales: "en",
        source,
        isDefault: true,
    });
    const ours = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: source },
        compat: true,
        onError: () => {},
    });
    const t = ours.getFixedT("en");
    const cases: [string, string][] = [
        ["unknown-var", "Hi ⁨{$name}⁩"],
        ["unknown-msg", "{nowhere}"],
        ["unknown-fn", "{NOPE()}"],
        ["unknown-term", "{-nothing}"],
    ];
    for (const [key, expected] of cases) {
        // @grammyjs/i18n calls formatPattern without an errors array, so the
        // first resolver error escapes as a throw from ctx.t.
        expect(() => oracleBundle.translate("en", key, {})).toThrow(
            ReferenceError,
        );
        // This package always passes an errors array, keeps Fluent's own
        // fallback rendering and routes the error to onError instead.
        expect(t(key)).toBe(expected);
    }
});

Deno.test("intentional difference: repeated loads of one locale", async () => {
    const first = "a = first A\nb = first B\n";
    const second = "a = second A\nc = second C\n";
    const oracleBundle = new Oracle({ warningHandler: () => {} });
    oracleBundle.addTranslationSync({
        locales: "en",
        source: first,
        isDefault: true,
    });
    oracleBundle.addTranslationSync({ locales: "en", source: second });
    // The oracle keeps one bundle per load and picks the first that matches,
    // so the second load is invisible.
    expect(oracleBundle.translate("en", "a")).toBe("first A");
    expect(oracleBundle.translate("en", "c")).toBe("{c}");

    const ours = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: first },
        compat: true,
        onError: () => {},
    });
    ours.addResourceBundle(
        "en",
        "translation",
        { ftl: `${first}${second}` },
        false,
        true,
    );
    // One bundle per (locale, namespace): the second source is merged in and,
    // in compat mode, overrides the ids it repeats.
    expect(ours.getFixedT("en")("a")).toBe("second A");
    expect(ours.getFixedT("en")("b")).toBe("first B");
    expect(ours.getFixedT("en")("c")).toBe("second C");
});
