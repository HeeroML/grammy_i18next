import { expect } from "@std/expect";
import i18next from "i18next";
import {
    isSafeLocale,
    localeChain,
    printableLocale,
} from "../../src/core/locale.ts";
import { fakeBackend, resources } from "../shared/fixtures.ts";
import { inMiddleware, makeContext, makePlugin } from "./helpers.ts";

/**
 * Locale codes as they could arrive in `from.language_code` of a forged or
 * hand-crafted update. None of them may reach `ctx.i18n.getLocale()`, a
 * backend, or a locale store.
 */
const HOSTILE = [
    "<b>x</b>",
    "../../etc/passwd",
    "..\\..\\secret",
    "en/../../x",
    "de..en",
    "__proto__",
    "constructor",
    "en\nfake log line",
    "en de",
    "de;rm -rf",
    "x".repeat(129),
];

Deno.test("isSafeLocale accepts locale codes and rejects everything else", () => {
    for (const locale of ["en", "pt-BR", "pt_BR", "zh-Hant-TW", "sr@latin"]) {
        expect(isSafeLocale(locale)).toBe(true);
    }
    for (const locale of [...HOSTILE, "", undefined, null, 42, ["en"]]) {
        expect(isSafeLocale(locale)).toBe(false);
    }
});

Deno.test("printableLocale quotes, truncates and escapes control characters", () => {
    expect(printableLocale("en\nfake")).toBe('"en\\nfake"');
    expect(printableLocale("x".repeat(500)).length).toBe(66);
    expect(printableLocale("a\u0085b")).toBe('"a?b"');
    expect(printableLocale(undefined)).toBe('"undefined"');
});

Deno.test("localeChain lists a locale and its parents", () => {
    expect(localeChain("zh-Hant-TW")).toEqual(["zh-hant-tw", "zh-hant", "zh"]);
    expect(localeChain("de")).toEqual(["de"]);
});

Deno.test("a hostile negotiated locale falls back to the default locale", async () => {
    const plugin = makePlugin();
    for (const code of HOSTILE) {
        const seen = await inMiddleware(
            plugin,
            makeContext("hi", code),
            (ctx) => [ctx.i18n.getLocale(), ctx.t("greeting")],
        );
        expect(seen).toEqual(["en", "Hello"]);
    }
});

Deno.test("renegotiate returns the default locale for a hostile locale", async () => {
    const plugin = makePlugin({ defaultLocale: "de" });
    const locale = await inMiddleware(
        plugin,
        makeContext("hi", "<script>"),
        (ctx) => ctx.i18n.renegotiate(),
    );
    expect(locale).toBe("de");
});

Deno.test("a hostile stored locale is ignored in favour of negotiation", async () => {
    for (const stored of HOSTILE) {
        const plugin = makePlugin({
            localeStore: { read: () => stored, write: () => {} },
        });
        const locale = await inMiddleware(
            plugin,
            makeContext("hi", "de"),
            (ctx) => ctx.i18n.getLocale(),
        );
        expect(locale).toBe("de");
    }
});

Deno.test("useLocale and setLocale reject hostile locales and persist nothing", async () => {
    const written: string[] = [];
    const plugin = makePlugin({
        localeStore: {
            read: () => undefined,
            write: (_ctx, locale) => void written.push(locale),
        },
    });
    await inMiddleware(plugin, makeContext("hi", "de"), async (ctx) => {
        for (const code of HOSTILE) {
            await expect(ctx.i18n.useLocale(code)).rejects.toThrow(
                "Cannot use the locale",
            );
            await expect(ctx.i18n.setLocale(code)).rejects.toThrow(
                "Cannot use the locale",
            );
        }
        // The locale in flight is untouched by the rejected calls.
        expect(ctx.i18n.getLocale()).toBe("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
    expect(written).toEqual([]);
});

Deno.test("the rejection message does not echo control characters", async () => {
    const plugin = makePlugin();
    await inMiddleware(plugin, makeContext(), async (ctx) => {
        const error = await ctx.i18n.useLocale("en\nINJECTED").catch((
            reason: unknown,
        ) => reason);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain("\n");
    });
});

Deno.test("a configured locale is accepted whatever its shape", async () => {
    // Locales the developer configured are trusted: here one that only
    // exists as resources and one that is only listed as supported.
    const plugin = makePlugin({
        initOptions: {
            fallbackLng: "en",
            resources: {
                ...resources,
                "pirate speak": { translation: { greeting: "Ahoy" } },
            },
        },
    });
    const greeting = await inMiddleware(
        plugin,
        makeContext("hi", "pirate speak"),
        (ctx) => [ctx.i18n.getLocale(), ctx.t("greeting")],
    );
    expect(greeting).toEqual(["pirate speak", "Ahoy"]);

    const listed = makePlugin({ supportedLocales: ["en", "x y"] });
    await inMiddleware(listed, makeContext(), async (ctx) => {
        await ctx.i18n.useLocale("x y");
        expect(ctx.i18n.getLocale()).toBe("x y");
    });
});

Deno.test("a hostile locale never reaches the backend", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });
    for (const code of HOSTILE) {
        const greeting = await inMiddleware(
            plugin,
            makeContext("hi", code),
            (ctx) => ctx.t("greeting"),
        );
        expect(greeting).toBe("Hello");
    }
    expect(backend.requested).toEqual(["en:translation"]);
});

Deno.test("on-demand loading is bounded for a stream of distinct locales", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
        de: { translation: { greeting: "Hallo" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });
    for (let i = 0; i < 650; i++) {
        const greeting = await inMiddleware(
            plugin,
            makeContext("hi", `zz${i.toString(36)}`),
            (ctx) => ctx.t("greeting"),
        );
        // Unknown locales keep translating through the fallback language.
        expect(greeting).toBe("Hello");
    }
    // 500 on-demand locales plus the fallback language loaded at start-up.
    expect(backend.requested.length).toBe(501);
    const preload = plugin.instance.options.preload;
    expect(Array.isArray(preload) && preload.length).toBe(500);

    // Once the bound is reached, further locales are used without loading.
    const late = await inMiddleware(
        plugin,
        makeContext("hi", "de"),
        (ctx) => [ctx.i18n.getLocale(), ctx.t("greeting")],
    );
    expect(late).toEqual(["de", "Hello"]);
    expect(backend.requested.length).toBe(501);
});

Deno.test("supportedLocales stay translated once the on-demand bound is reached", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
        de: { translation: { greeting: "Hallo" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
        supportedLocales: ["en", "de"],
    });
    for (let i = 0; i < 650; i++) {
        await inMiddleware(plugin, makeContext("hi", `de-x${i}`), () => {});
    }
    const greeting = await inMiddleware(
        plugin,
        makeContext("hi", "de"),
        (ctx) => ctx.t("greeting"),
    );
    expect(greeting).toBe("Hallo");
});

Deno.test("with supportedLocales only those and their variants are loaded on demand", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
        de: { translation: { greeting: "Hallo" } },
        "de-AT": { translation: { greeting: "Servus" } },
        fr: { translation: { greeting: "Bonjour" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
        supportedLocales: ["en", "de"],
    });
    const greet = (code: string) =>
        inMiddleware(
            plugin,
            makeContext("hi", code),
            (ctx) => ctx.t("greeting"),
        );

    expect(await greet("de_AT")).toBe("Servus");
    expect(await greet("fr")).toBe("Hello");
    expect(await greet("zz")).toBe("Hello");
    expect(backend.requested.toSorted()).toEqual([
        "de-AT:translation",
        "de:translation",
        "en:translation",
    ]);
});

Deno.test("an unusually shaped locale needs i18next's supportedLngs to load from a backend", async () => {
    const data = {
        en: { translation: { greeting: "Hello" } },
        "pirate speak": { translation: { greeting: "Ahoy" } },
    };
    const greet = async (initOptions: { supportedLngs?: string[] }) => {
        const backend = fakeBackend(data);
        const plugin = makePlugin({
            i18next: i18next.createInstance().use(backend),
            initOptions: { fallbackLng: "en", ...initOptions },
            supportedLocales: ["en", "pirate speak"],
        });
        const greeting = await inMiddleware(
            plugin,
            makeContext("hi", "pirate speak"),
            (ctx) => ctx.t("greeting"),
        );
        return [greeting, backend.requested.toSorted()];
    };

    // The plugin accepts the locale because it is configured, but i18next
    // applies its own shape check before asking a backend and only trusts
    // what its own options list.
    expect(await greet({})).toEqual(["Hello", ["en:translation"]]);
    expect(await greet({ supportedLngs: ["en", "pirate speak"] })).toEqual([
        "Ahoy",
        ["en:translation", "pirate speak:translation"],
    ]);
});
