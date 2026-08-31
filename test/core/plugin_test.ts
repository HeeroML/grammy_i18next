import { expect } from "@std/expect";
import i18next from "i18next";
import { I18nextCore } from "../../src/core/plugin.ts";
import type { LocaleStore } from "../../src/core/types.ts";
import { resources } from "../shared/fixtures.ts";
import {
    inMiddleware,
    makeContext,
    makePlugin,
    type TestContext,
} from "./helpers.ts";

Deno.test("negotiates the locale from the user's language_code", async () => {
    await inMiddleware(makePlugin(), makeContext("hi", "de"), (ctx) => {
        expect(ctx.i18n.getLocale()).toBe("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
});

Deno.test("uses the fallback locale when there is no language_code", async () => {
    await inMiddleware(makePlugin(), makeContext(), (ctx) => {
        expect(ctx.i18n.getLocale()).toBe("en");
        expect(ctx.t("greeting")).toBe("Hello");
    });
});

Deno.test("prefers the defaultLocale option over fallbackLng", async () => {
    await inMiddleware(
        makePlugin({ defaultLocale: "de" }),
        makeContext(),
        (ctx) => expect(ctx.t("greeting")).toBe("Hallo"),
    );
});

Deno.test("falls back to 'dev' without any fallbackLng", async () => {
    const plugin = makePlugin({
        initOptions: { fallbackLng: false, resources },
    });
    await plugin.ready();
    expect(plugin.defaultLocale).toBe("dev");
});

Deno.test("reads the first locale of a fallbackLng array", async () => {
    const plugin = makePlugin({
        initOptions: { fallbackLng: ["de", "en"], resources },
    });
    await plugin.ready();
    expect(plugin.defaultLocale).toBe("de");
});

Deno.test("reads the default entry of a fallbackLng map", async () => {
    const plugin = makePlugin({
        initOptions: { fallbackLng: { default: ["de"] }, resources },
    });
    await plugin.ready();
    expect(plugin.defaultLocale).toBe("de");
});

Deno.test("supports plurals and interpolation", async () => {
    await inMiddleware(makePlugin(), makeContext(), (ctx) => {
        expect(ctx.t("items", { count: 1 })).toBe("1 item");
        expect(ctx.t("items", { count: 5 })).toBe("5 items");
    });
});

Deno.test("missing keys fall back to the fallback locale", async () => {
    // "items" is not translated in German.
    await inMiddleware(
        makePlugin(),
        makeContext("hi", "de"),
        (ctx) => expect(ctx.t("items", { count: 2 })).toBe("2 items"),
    );
});

function memoryStore(): LocaleStore<TestContext> & {
    data: Map<number, string>;
} {
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
    await inMiddleware(plugin, makeContext(), async (ctx) => {
        await ctx.i18n.setLocale("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
    expect(localeStore.data.get(1234)).toBe("de");

    // The next update of the same user restores the stored locale, even
    // though negotiation would yield English.
    await inMiddleware(plugin, makeContext("hi", "en"), (ctx) => {
        expect(ctx.i18n.getLocale()).toBe("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
});

Deno.test("an empty stored locale falls through to negotiation", async () => {
    const plugin = makePlugin({
        localeStore: { read: () => "", write: () => {} },
    });
    await inMiddleware(
        plugin,
        makeContext("hi", "de"),
        (ctx) => expect(ctx.i18n.getLocale()).toBe("de"),
    );
});

Deno.test("works with a user-provided, initialized i18next instance", async () => {
    const instance = i18next.createInstance();
    await instance.init({ fallbackLng: "en", resources });
    const plugin = new I18nextCore<TestContext>({ i18next: instance });
    expect(plugin.instance).toBe(instance);
    await inMiddleware(
        plugin,
        makeContext("hi", "de"),
        (ctx) => expect(ctx.t("greeting")).toBe("Hallo"),
    );
});

Deno.test("initializes a user-provided instance that was not initialized", async () => {
    const instance = i18next.createInstance({ fallbackLng: "en", resources });
    const plugin = new I18nextCore<TestContext>({ i18next: instance });
    await inMiddleware(
        plugin,
        makeContext(),
        (ctx) => expect(ctx.t("greeting")).toBe("Hello"),
    );
    expect(instance.isInitialized).toBe(true);
});

Deno.test("throws without an instance and without init options", () => {
    expect(() => new I18nextCore({})).toThrow(
        "Cannot create the i18next plugin without translations",
    );
});

Deno.test("never mutates the global language of the instance", async () => {
    const plugin = makePlugin();
    await plugin.ready();
    const globalLanguage = plugin.instance.language;
    await inMiddleware(plugin, makeContext("hi", "de"), () => {});
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
    expect(plugin.locales).toEqual([]);
    await plugin.ready();
    expect(plugin.locales.toSorted()).toEqual(["de", "en"]);
});

Deno.test("supportedLocales override the registered locales", async () => {
    const plugin = makePlugin({ supportedLocales: ["en", "fr"] });
    await plugin.ready();
    expect(plugin.locales).toEqual(["en", "fr"]);
});

Deno.test("normalizes locale casing and separators like i18next does", async () => {
    await inMiddleware(
        makePlugin(),
        makeContext("hi", "pt-br"),
        (ctx) => expect(ctx.i18n.getLocale()).toBe("pt-BR"),
    );
    await inMiddleware(
        makePlugin(),
        makeContext("hi", "pt_BR"),
        (ctx) => expect(ctx.i18n.getLocale()).toBe("pt-BR"),
    );
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
    await inMiddleware(first, ctx, async () => {
        expect(ctx.t("greeting")).toBe("Hello");
        await inMiddleware(second, ctx, () => {
            expect(ctx.t("greeting")).toBe("Howdy");
            expect(ctx.i18n.instance).toBe(second.instance);
        });
        // The inner scope ended, so the outer instance is back in charge.
        expect(ctx.t("greeting")).toBe("Hello");
        expect(ctx.i18n.instance).toBe(first.instance);
    });
});

Deno.test("binds the namespaces of the ns option into ctx.t", async () => {
    const plugin = new I18nextCore<TestContext, "main">({
        initOptions: {
            fallbackLng: "en",
            resources: {
                en: {
                    translation: { greeting: "wrong" },
                    main: { greeting: "Hello" },
                },
            },
        },
        ns: "main",
    });
    await inMiddleware(
        plugin,
        makeContext(),
        (ctx) => expect(ctx.t("greeting")).toBe("Hello"),
    );
});
