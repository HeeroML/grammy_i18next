import { expect } from "@std/expect";
import { createInstance } from "i18next";
import type { BackendModule, i18n, ReadCallback } from "i18next";
import { FluentNumber } from "@fluent/bundle";
import type { FluentValue } from "@fluent/bundle";
import {
    createFluentFormat,
    createFluentI18next,
    FLUENT_SOURCE_KEY,
    type FluentError,
    FluentFormat,
    type FluentI18nextOptions,
    fluentSource,
} from "../../src/fluent/mod.ts";

const FSI = "⁨";
const PDI = "⁩";

const EN = `
-brand = Fluent
-thing = { $article ->
   *[definite] the thing
    [indefinite] a thing
}
-titled = Title
    .gender = feminine

simple = Just text
greeting = Hello, { $name }!
multiline =
    Line one
    Line two
about = Powered by { -brand }.
this-thing = This is { -thing(article: "indefinite") }.
term-attr = { -titled.gender ->
    [feminine] She
   *[masculine] He
  }
ref = { simple } and more.
emails = { $count ->
    [one] one email
   *[other] { $count } emails
  }
numeric = { $n ->
    [0] zero
    [1] exactly one
   *[other] many
  }
pi = PI is { NUMBER($pi, maximumFractionDigits: 2) }.
when = Date: { DATETIME($date, month: "long", day: "numeric", year: "numeric", timeZone: "UTC") }
login = Sign in
    .tooltip = Click to sign in as { $user }
noval =
    .attr = Only an attribute
unicode = Héllo — «{ $name }» ✔ 😀 ü
escaped = Braces { "{" } and { "}" }
custom = Custom: { UPPER($word) }
`;

const DE = `
greeting = Hallo, { $name }!
emails = { $count ->
    [one] eine E-Mail
   *[other] { $count } E-Mails
  }
`;

const RU = `
emails = { $count ->
    [one] { $count } письмо
    [few] { $count } письма
    [many] { $count } писем
   *[other] { $count } письма
  }
`;

type Overrides = Partial<
    Omit<FluentI18nextOptions, "defaultLocale" | "resources">
>;

/** Builds an instance over the shared fixtures, with errors captured. */
async function fixture(
    extra: Overrides = {},
): Promise<{ i18next: i18n; errors: FluentError[] }> {
    const errors: FluentError[] = [];
    const i18next = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: EN, de: DE, ru: RU },
        onError: (error) => errors.push(error),
        ...extra,
    });
    return { i18next, errors };
}

Deno.test("formats a simple message", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("simple")).toBe("Just text");
});

Deno.test("interpolates variables", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("greeting", { name: "Jane" })).toBe(
        `Hello, ${FSI}Jane${PDI}!`,
    );
});

Deno.test("keeps multiline blocks", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("multiline")).toBe("Line one\nLine two");
});

Deno.test("resolves message references", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("ref")).toBe(
        `${FSI}Just text${PDI} and more.`,
    );
});

Deno.test("resolves terms", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("about")).toBe(
        `Powered by ${FSI}Fluent${PDI}.`,
    );
});

Deno.test("resolves terms with arguments", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("this-thing")).toBe(
        `This is ${FSI}a thing${PDI}.`,
    );
});

Deno.test("selects on a term attribute", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("term-attr")).toBe("She");
});

Deno.test("selects numeric variants", async () => {
    const { i18next } = await fixture();
    const t = i18next.getFixedT("en");
    expect(t("numeric", { n: 0 })).toBe("zero");
    expect(t("numeric", { n: 1 })).toBe("exactly one");
    expect(t("numeric", { n: 7 })).toBe("many");
});

Deno.test("uses English cardinal plural categories", async () => {
    const { i18next } = await fixture();
    const t = i18next.getFixedT("en");
    expect(t("emails", { count: 1 })).toBe("one email");
    expect(t("emails", { count: 5 })).toBe(`${FSI}5${PDI} emails`);
});

Deno.test("uses locale-sensitive plural categories (ru few/many)", async () => {
    const { i18next } = await fixture();
    const t = i18next.getFixedT("ru");
    expect(t("emails", { count: 1 })).toBe(`${FSI}1${PDI} письмо`);
    expect(t("emails", { count: 2 })).toBe(`${FSI}2${PDI} письма`);
    expect(t("emails", { count: 5 })).toBe(`${FSI}5${PDI} писем`);
});

Deno.test("reads attributes with 'message.attribute'", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("login.tooltip", { user: "Ada" })).toBe(
        `Click to sign in as ${FSI}Ada${PDI}`,
    );
    expect(i18next.getFixedT("en")("login")).toBe("Sign in");
});

Deno.test("formats NUMBER() with the bundle locale", async () => {
    const { i18next } = await fixture();
    const expected = new Intl.NumberFormat("en", { maximumFractionDigits: 2 })
        .format(3.14159);
    expect(i18next.getFixedT("en")("pi", { pi: 3.14159 })).toBe(
        `PI is ${FSI}${expected}${PDI}.`,
    );
});

Deno.test("formats DATETIME() independently of the host time zone", async () => {
    const { i18next } = await fixture();
    const date = new Date(Date.UTC(2026, 7, 31, 12, 0, 0));
    const expected = new Intl.DateTimeFormat("en", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    }).format(date);
    expect(i18next.getFixedT("en")("when", { date })).toBe(
        `Date: ${FSI}${expected}${PDI}`,
    );
});

Deno.test("passes FluentType variables through untouched", async () => {
    const { i18next } = await fixture();
    const amount = new FluentNumber(1234.5, {
        style: "currency",
        currency: "EUR",
    });
    const expected = new Intl.NumberFormat("en", {
        style: "currency",
        currency: "EUR",
    }).format(1234.5);
    expect(i18next.getFixedT("en")("greeting", { name: amount })).toBe(
        `Hello, ${FSI}${expected}${PDI}!`,
    );
});

Deno.test("supports static custom functions", async () => {
    const { i18next } = await fixture({
        bundleOptions: {
            functions: {
                UPPER: (positional: FluentValue[]) =>
                    String(positional[0]).toUpperCase(),
            },
        },
    });
    expect(i18next.getFixedT("en")("custom", { word: "abc" })).toBe(
        `Custom: ${FSI}ABC${PDI}`,
    );
});

Deno.test("supports a per-locale bundle option factory", async () => {
    const seen: string[] = [];
    const { i18next } = await fixture({
        bundleOptions: (locale: string) => {
            seen.push(locale);
            return {
                functions: {
                    UPPER: (positional: FluentValue[]) =>
                        `${locale}:${String(positional[0]).toUpperCase()}`,
                },
            };
        },
    });
    expect(seen.sort()).toEqual(["de", "en", "ru"]);
    expect(i18next.getFixedT("en")("custom", { word: "abc" })).toBe(
        `Custom: ${FSI}en:ABC${PDI}`,
    );
});

Deno.test("applies a bundle transform", async () => {
    const { i18next } = await fixture({
        bundleOptions: { transform: (text: string) => text.toUpperCase() },
    });
    expect(i18next.getFixedT("en")("simple")).toBe("JUST TEXT");
});

Deno.test("keeps Unicode and escape sequences intact", async () => {
    const { i18next } = await fixture();
    const t = i18next.getFixedT("en");
    expect(t("unicode", { name: "Ω" })).toBe(
        `Héllo — «${FSI}Ω${PDI}» ✔ 😀 ü`,
    );
    expect(t("escaped")).toBe(`Braces ${FSI}{${PDI} and ${FSI}}${PDI}`);
});

Deno.test("isolates placeables by default and not with useIsolating false", async () => {
    const isolated = await fixture();
    expect(isolated.i18next.getFixedT("en")("greeting", { name: "J" })).toBe(
        "Hello, ⁨J⁩!",
    );
    const plain = await fixture({ bundleOptions: { useIsolating: false } });
    expect(plain.i18next.getFixedT("en")("greeting", { name: "J" })).toBe(
        "Hello, J!",
    );
});

Deno.test("returns the key for a missing message, '{key}' in compat mode", async () => {
    const native = await fixture();
    expect(native.i18next.getFixedT("en")("nope")).toBe("nope");
    const compat = await fixture({ compat: true });
    expect(compat.i18next.getFixedT("en")("nope")).toBe("{nope}");
});

Deno.test("treats a missing attribute as a miss", async () => {
    const native = await fixture();
    expect(native.i18next.getFixedT("en")("login.nope")).toBe("login.nope");
    const compat = await fixture({ compat: true });
    expect(compat.i18next.getFixedT("en")("login.nope")).toBe("{login.nope}");
});

Deno.test("value-less messages miss natively and render '' in compat mode", async () => {
    const native = await fixture();
    expect(native.i18next.getFixedT("en")("noval")).toBe("noval");
    expect(native.i18next.getFixedT("en")("noval.attr")).toBe(
        "Only an attribute",
    );
    const compat = await fixture({ compat: true });
    expect(compat.i18next.getFixedT("en")("noval")).toBe("");
    expect(compat.i18next.getFixedT("en")("noval.attr")).toBe(
        "Only an attribute",
    );
});

Deno.test("falls back from a region to its base language", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("de-DE")("greeting", { name: "Welt" })).toBe(
        `Hallo, ${FSI}Welt${PDI}!`,
    );
    expect(i18next.getFixedT("de-AT")("greeting", { name: "Welt" })).toBe(
        `Hallo, ${FSI}Welt${PDI}!`,
    );
});

Deno.test("falls back to the default locale for a missing key", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("de")("simple")).toBe("Just text");
    expect(i18next.getFixedT("de-DE")("about")).toBe(
        `Powered by ${FSI}Fluent${PDI}.`,
    );
});

Deno.test("reports unknown variables and keeps Fluent's fallback output", async () => {
    const { i18next, errors } = await fixture();
    expect(i18next.getFixedT("en")("greeting")).toBe(
        `Hello, ${FSI}{$name}${PDI}!`,
    );
    expect(errors.length).toBe(1);
    expect(errors[0].kind).toBe("format");
    expect(errors[0].locale).toBe("en");
    expect(errors[0].namespace).toBe("translation");
    expect(errors[0].key).toBe("greeting");
    expect(errors[0].errors[0]).toBeInstanceOf(ReferenceError);
    expect(errors[0].errors[0].message).toBe("Unknown variable: $name");
    expect(errors[0].message).toContain("greeting");
});

Deno.test("keeps the first duplicate id and reports it", async () => {
    const errors: FluentError[] = [];
    const i18next = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: "dup = first\ndup = second\n" },
        onError: (error) => errors.push(error),
    });
    expect(i18next.getFixedT("en")("dup")).toBe("first");
    expect(errors.length).toBe(1);
    expect(errors[0].kind).toBe("resource");
    expect(errors[0].locale).toBe("en");
    expect(errors[0].namespace).toBe("translation");
});

Deno.test("lets the last duplicate id win with allowOverrides and in compat mode", async () => {
    const overriding = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: "dup = first\ndup = second\n" },
        allowOverrides: true,
        onError: () => {},
    });
    expect(overriding.getFixedT("en")("dup")).toBe("second");
    const errors: FluentError[] = [];
    const compat = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: "dup = first\ndup = second\n" },
        compat: true,
        onError: (error) => errors.push(error),
    });
    expect(compat.getFixedT("en")("dup")).toBe("second");
    expect(errors).toEqual([]);
});

Deno.test("supports multiple namespaces per locale", async () => {
    const i18next = await createFluentI18next({
        defaultLocale: "en",
        defaultNS: "main",
        resources: {
            en: { main: "hi = Hi", errors: "boom = Boom" },
            de: { main: "hi = Hallo", errors: "boom = Peng" },
        },
        onError: () => {},
    });
    expect(i18next.getFixedT("en")("hi")).toBe("Hi");
    expect(i18next.getFixedT("en")("boom", { ns: "errors" })).toBe("Boom");
    expect(i18next.getFixedT("de", "errors")("boom")).toBe("Peng");
    expect(i18next.getFixedT("de-DE", "errors")("boom")).toBe("Peng");
});

Deno.test("forwards count as $count", async () => {
    const { i18next } = await fixture();
    expect(i18next.getFixedT("en")("emails", { count: 1 })).toBe("one email");
    expect(i18next.getFixedT("de")("emails", { count: 3 })).toBe(
        `${FSI}3${PDI} E-Mails`,
    );
});

Deno.test("gives options.replace precedence over the option bag", async () => {
    const { i18next } = await fixture();
    expect(
        i18next.getFixedT("en")("greeting", {
            name: "ignored",
            replace: { name: "used" },
        }),
    ).toBe(`Hello, ${FSI}used${PDI}!`);
});

Deno.test("honours interpolation.defaultVariables", async () => {
    const { i18next } = await fixture({
        initOptions: {
            interpolation: { defaultVariables: { name: "Anonymous" } },
        },
    });
    expect(i18next.getFixedT("en")("greeting")).toBe(
        `Hello, ${FSI}Anonymous${PDI}!`,
    );
    expect(i18next.getFixedT("en")("greeting", { name: "Jane" })).toBe(
        `Hello, ${FSI}Jane${PDI}!`,
    );
});

Deno.test("merges interpolation.defaultVariables underneath replace", async () => {
    // i18next's own interpolator applies `defaultVariables` even when the
    // caller uses `replace`; the Fluent format must not lose them.
    const { i18next } = await fixture({
        initOptions: {
            interpolation: { defaultVariables: { name: "Anonymous" } },
        },
    });
    expect(
        i18next.getFixedT("en")("greeting", { replace: { other: 1 } }),
    ).toBe(`Hello, ${FSI}Anonymous${PDI}!`);
    expect(
        i18next.getFixedT("en")("greeting", { replace: { name: "Jane" } }),
    ).toBe(`Hello, ${FSI}Jane${PDI}!`);
});

Deno.test("drops variables Fluent cannot render", async () => {
    const { i18next, errors } = await fixture();
    expect(
        i18next.getFixedT("en")("greeting", {
            name: true as unknown as string,
        }),
    ).toBe(`Hello, ${FSI}{$name}${PDI}!`);
    expect(errors[0].errors[0]).toBeInstanceOf(ReferenceError);
});

Deno.test("loads Fluent sources lazily from a backend", async () => {
    const sources: Record<string, string> = {
        "en|translation": "greeting = Hello, { $name }!",
        "de|translation": "greeting = Hallo, { $name }!",
    };
    const backend: BackendModule = {
        type: "backend",
        init: () => {},
        read: (lng: string, ns: string, callback: ReadCallback) => {
            const source = sources[`${lng}|${ns}`];
            callback(null, source === undefined ? {} : fluentSource(source));
        },
    };
    const i18next = createInstance();
    await i18next.use(backend).use(createFluentFormat({ onError: () => {} }))
        .init({
            lng: "en",
            fallbackLng: "en",
            ns: ["translation"],
            defaultNS: "translation",
            keySeparator: false,
        });
    expect(i18next.store.data.en.translation).toEqual({
        [FLUENT_SOURCE_KEY]: sources["en|translation"],
    });
    expect(i18next.getFixedT("en")("greeting", { name: "Jane" })).toBe(
        `Hello, ${FSI}Jane${PDI}!`,
    );
    await i18next.loadLanguages("de");
    expect(i18next.getFixedT("de")("greeting", { name: "Welt" })).toBe(
        `Hallo, ${FSI}Welt${PDI}!`,
    );
});

Deno.test("recompiles when addResourceBundle replaces a source", async () => {
    const i18next = await createFluentI18next({
        defaultLocale: "en",
        resources: { en: "greeting = Hello" },
        onError: () => {},
    });
    expect(i18next.getFixedT("en")("greeting")).toBe("Hello");
    i18next.addResourceBundle(
        "en",
        "translation",
        fluentSource("greeting = Howdy"),
        false,
        true,
    );
    expect(i18next.getFixedT("en")("greeting")).toBe("Howdy");
    i18next.addResourceBundle(
        "fr",
        "translation",
        fluentSource("greeting = Bonjour"),
        false,
        true,
    );
    expect(i18next.getFixedT("fr")("greeting")).toBe("Bonjour");
    i18next.removeResourceBundle("fr", "translation");
    // French is gone again, so the lookup falls back to the updated English.
    expect(i18next.getFixedT("fr")("greeting")).toBe("Howdy");
});

Deno.test("reports store content that is not a Fluent source", async () => {
    const errors: FluentError[] = [];
    const i18next = createInstance();
    await i18next.use(createFluentFormat({ onError: (e) => errors.push(e) }))
        .init({
            lng: "en",
            fallbackLng: "en",
            keySeparator: false,
            ns: ["translation"],
            defaultNS: "translation",
            resources: { en: { translation: { greeting: "Hello" } } },
        });
    expect(errors.length).toBe(1);
    expect(errors[0].kind).toBe("resource");
    expect(errors[0].message).toContain("en/translation");
    expect(i18next.getFixedT("en")("greeting")).toBe("greeting");
    // Reported once, not once per lookup.
    i18next.getFixedT("en")("greeting");
    expect(errors.length).toBe(1);
});

Deno.test("the default error handler warns instead of throwing", async () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(args);
    };
    try {
        const i18next = await createFluentI18next({
            defaultLocale: "en",
            resources: { en: "greeting = Hello, { $name }!" },
        });
        expect(i18next.getFixedT("en")("greeting")).toBe(
            `Hello, ${FSI}{$name}${PDI}!`,
        );
    } finally {
        console.warn = original;
    }
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("Unknown variable: $name");
});

Deno.test("keeps per-request translators independent", async () => {
    const { i18next } = await fixture();
    const en = i18next.getFixedT("en");
    const de = i18next.getFixedT("de");
    const results = await Promise.all([
        Promise.resolve().then(() => en("greeting", { name: "A" })),
        Promise.resolve().then(() => de("greeting", { name: "B" })),
        Promise.resolve().then(() => en("emails", { count: 2 })),
        Promise.resolve().then(() => de("emails", { count: 2 })),
    ]);
    expect(results).toEqual([
        `Hello, ${FSI}A${PDI}!`,
        `Hallo, ${FSI}B${PDI}!`,
        `${FSI}2${PDI} emails`,
        `${FSI}2${PDI} E-Mails`,
    ]);
});

Deno.test("compiles lazily when the store was filled without an event", async () => {
    const { i18next } = await fixture();
    // Write past the ResourceStore API, so no "added" event is emitted.
    i18next.store.data.it = { translation: "simple = Solo testo" };
    expect(i18next.getFixedT("it")("simple")).toBe("Solo testo");
});

Deno.test("leaves lookup keys untouched (no plural or context suffixes)", () => {
    const format = createFluentFormat();
    const keys = ["emails"];
    expect(format.addLookupKeys(keys)).toBe(keys);
    expect(keys).toEqual(["emails"]);
});

Deno.test("adds no enumerable properties to the i18next instance", async () => {
    const bare = createInstance();
    await bare.init({ lng: "en", fallbackLng: "en", resources: {} });
    const withFormat = createInstance();
    await withFormat.use(createFluentFormat()).init({
        lng: "en",
        fallbackLng: "en",
        keySeparator: false,
        resources: {},
    });
    expect(Object.keys(withFormat).sort()).toEqual(Object.keys(bare).sort());
    expect(withFormat.services.i18nFormat).toBeInstanceOf(FluentFormat);
});
