import { expect } from "@std/expect";
import i18next from "i18next";
import { I18next } from "../src/mod.ts";
import type { LocaleStore } from "../src/mod.ts";
import {
    applyMiddleware,
    makeContext,
    makePlugin,
    messageUpdate,
    resources,
} from "./helpers.ts";

Deno.test("negotiates the locale from the user's language_code", async () => {
    const ctx = await applyMiddleware(
        makePlugin(),
        makeContext(messageUpdate("hi", "de")),
    );
    expect(ctx.i18n.getLocale()).toBe("de");
    expect(ctx.t("greeting")).toBe("Hallo");
});

Deno.test("uses the fallback locale when there is no language_code", async () => {
    const ctx = await applyMiddleware(makePlugin(), makeContext());
    expect(ctx.i18n.getLocale()).toBe("en");
    expect(ctx.t("greeting")).toBe("Hello");
});

Deno.test("prefers the defaultLocale option over fallbackLng", async () => {
    const ctx = await applyMiddleware(
        makePlugin({ defaultLocale: "de" }),
        makeContext(),
    );
    expect(ctx.t("greeting")).toBe("Hallo");
});

Deno.test("useLocale rebinds ctx.t immediately", async () => {
    const ctx = await applyMiddleware(
        makePlugin(),
        makeContext(messageUpdate("hi", "de")),
        () => Promise.resolve(),
    );
    expect(ctx.t("greeting")).toBe("Hallo");
    ctx.i18n.useLocale("en");
    expect(ctx.i18n.getLocale()).toBe("en");
    expect(ctx.t("greeting")).toBe("Hello");
});

Deno.test("useLocale rejects empty locales", async () => {
    const ctx = await applyMiddleware(makePlugin(), makeContext());
    expect(() => ctx.i18n.useLocale("")).toThrow(
        "Cannot use an empty locale",
    );
});

Deno.test("supports plurals and interpolation", async () => {
    const ctx = await applyMiddleware(makePlugin(), makeContext());
    expect(ctx.t("items", { count: 1 })).toBe("1 item");
    expect(ctx.t("items", { count: 5 })).toBe("5 items");
});

Deno.test("missing keys fall back to the fallback locale", async () => {
    const ctx = await applyMiddleware(
        makePlugin(),
        makeContext(messageUpdate("hi", "de")),
    );
    // "items" is not translated in German.
    expect(ctx.t("items", { count: 2 })).toBe("2 items");
});

function memoryStore(): LocaleStore & { data: Map<number, string> } {
    const data = new Map<number, string>();
    return {
        data,
        read: (ctx) => data.get(ctx.from?.id ?? -1),
        write: (ctx, locale) => {
            data.set(ctx.from?.id ?? -1, locale);
        },
    };
}

Deno.test("setLocale persists the locale via the locale store", async () => {
    const localeStore = memoryStore();
    const plugin = makePlugin({ localeStore });
    const ctx = await applyMiddleware(plugin, makeContext());
    await ctx.i18n.setLocale("de");
    expect(ctx.t("greeting")).toBe("Hallo");
    expect(localeStore.data.get(1234)).toBe("de");

    // The next update of the same user restores the stored locale, even
    // though negotiation would yield English.
    const later = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("hi", "en")),
    );
    expect(later.i18n.getLocale()).toBe("de");
    expect(later.t("greeting")).toBe("Hallo");
});

Deno.test("renegotiate re-runs the locale negotiator", async () => {
    let locale: string | undefined = "de";
    const plugin = makePlugin({ localeNegotiator: () => locale });
    const ctx = await applyMiddleware(plugin, makeContext());
    expect(ctx.t("greeting")).toBe("Hallo");
    locale = undefined;
    expect(await ctx.i18n.renegotiate()).toBe("en");
    expect(ctx.t("greeting")).toBe("Hello");
});

Deno.test("works with a user-provided, initialized i18next instance", async () => {
    const instance = i18next.createInstance();
    await instance.init({ fallbackLng: "en", resources });
    const plugin = new I18next({ i18next: instance });
    const ctx = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("hi", "de")),
    );
    expect(plugin.instance).toBe(instance);
    expect(ctx.t("greeting")).toBe("Hallo");
});

Deno.test("initializes a user-provided instance that was not initialized", async () => {
    const instance = i18next.createInstance({ fallbackLng: "en", resources });
    const plugin = new I18next({ i18next: instance });
    const ctx = await applyMiddleware(plugin, makeContext());
    expect(instance.isInitialized).toBe(true);
    expect(ctx.t("greeting")).toBe("Hello");
});

Deno.test("throws without an instance and without init options", () => {
    expect(() => new I18next({})).toThrow(
        "Cannot create the i18next plugin without translations",
    );
});

Deno.test("never mutates the global language of the instance", async () => {
    const plugin = makePlugin();
    await plugin.ready();
    const globalLanguage = plugin.instance.language;
    await applyMiddleware(plugin, makeContext(messageUpdate("hi", "de")));
    expect(plugin.instance.language).toBe(globalLanguage);
});

Deno.test("plugin-level t translates into a given locale", async () => {
    const plugin = makePlugin();
    await plugin.ready();
    expect(plugin.t("de", "greeting")).toBe("Hallo");
    expect(plugin.t("en", "items", { count: 3 })).toBe("3 items");
});

Deno.test("plugin-level t throws before initialization", () => {
    const plugin = makePlugin();
    expect(() => plugin.t("en", "greeting")).toThrow(
        "i18next is not initialized yet",
    );
});

Deno.test("exposes the registered locales", async () => {
    const plugin = makePlugin();
    await plugin.ready();
    expect(plugin.locales.toSorted()).toEqual(["de", "en"]);
});

Deno.test("normalizes locale casing like i18next does", async () => {
    const ctx = await applyMiddleware(
        makePlugin(),
        makeContext(messageUpdate("hi", "pt-br")),
    );
    expect(ctx.i18n.getLocale()).toBe("pt-BR");
});

Deno.test("the last installed plugin instance wins downstream", async () => {
    const first = makePlugin();
    const second = makePlugin({
        initOptions: {
            fallbackLng: "en",
            resources: { en: { translation: { greeting: "Howdy" } } },
        },
    });
    const ctx = makeContext();
    await first.middleware()(ctx, async () => {
        expect(ctx.t("greeting")).toBe("Hello");
        await second.middleware()(ctx, () => {
            expect(ctx.t("greeting")).toBe("Howdy");
            expect(ctx.i18n.instance).toBe(second.instance);
            return Promise.resolve();
        });
    });
});
