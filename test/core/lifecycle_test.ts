import { expect } from "@std/expect";
import i18next from "i18next";
import { I18nextCore } from "../../src/core/plugin.ts";
import { fakeBackend, resources } from "../shared/fixtures.ts";
import {
    inMiddleware,
    makeContext,
    makePlugin,
    type TestContext,
} from "./helpers.ts";

Deno.test("ready initializes exactly once for concurrent callers", async () => {
    const backend = fakeBackend({ en: { translation: { greeting: "Hi" } } });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });

    await Promise.all(Array.from({ length: 25 }, () => plugin.ready()));

    expect(backend.requested).toEqual(["en:translation"]);
    expect(plugin.instance.isInitialized).toBe(true);
});

Deno.test("ready returns the same promise on every call", () => {
    const plugin = makePlugin();
    expect(plugin.ready()).toBe(plugin.ready());
});

Deno.test("ready waits for an initialization started elsewhere", async () => {
    const backend = {
        type: "backend" as const,
        init(): void {},
        read(
            _language: string,
            _namespace: string,
            callback: (error: unknown, data?: object) => void,
        ): void {
            setTimeout(() => callback(null, { greeting: "Hello" }), 5);
        },
    };
    const instance = i18next.createInstance().use(backend);
    // Somebody else starts the initialization before the plugin does.
    const external = instance.init({ fallbackLng: "en" });
    expect(instance.isInitializing).toBe(true);

    const plugin = new I18nextCore<TestContext>({ i18next: instance });
    await plugin.ready();

    expect(instance.isInitialized).toBe(true);
    await inMiddleware(
        plugin,
        makeContext(),
        (ctx) => expect(ctx.t("greeting")).toBe("Hello"),
    );
    await external;
});

Deno.test("a failing initialization rejects and stays rejected", async () => {
    const backend = fakeBackend({}, ["en"]);
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });

    await expect(plugin.ready()).rejects.toThrow(
        "i18next failed to initialize",
    );
    // Replayed rather than retried, so no update ever hangs.
    await expect(plugin.ready()).rejects.toThrow(
        "i18next failed to initialize",
    );
    await expect(inMiddleware(plugin, makeContext(), () => {})).rejects
        .toThrow("i18next failed to initialize");
    expect(backend.requested).toEqual(["en:translation"]);
});

Deno.test("the initialization error keeps the backend error as its cause", async () => {
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(fakeBackend({}, ["en"])),
        initOptions: { fallbackLng: "en" },
    });
    const error = await plugin.ready().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeDefined();
});

Deno.test("initOptions for an already initialized instance are an error", async () => {
    const instance = i18next.createInstance();
    await instance.init({ fallbackLng: "en", resources });
    const plugin = new I18nextCore<TestContext>({
        i18next: instance,
        initOptions: { fallbackLng: "de" },
    });
    await expect(plugin.ready()).rejects.toThrow("already initialized");
});

Deno.test("an initialized instance without initOptions is used as is", async () => {
    const instance = i18next.createInstance();
    await instance.init({ fallbackLng: "en", resources });
    const plugin = new I18nextCore<TestContext>({ i18next: instance });
    await plugin.ready();
    expect(plugin.t("de", "greeting")).toBe("Hallo");
});

Deno.test("ready preloads supportedLocales from a backend", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
        de: { translation: { greeting: "Hallo" } },
        fr: { translation: { greeting: "Bonjour" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
        supportedLocales: ["de", "fr"],
    });

    await plugin.ready();

    expect(backend.requested.toSorted()).toEqual([
        "de:translation",
        "en:translation",
        "fr:translation",
    ]);
    expect(plugin.t("fr", "greeting")).toBe("Bonjour");
});

Deno.test("ready registers plugin-bound namespaces with a backend", async () => {
    const backend = fakeBackend({
        en: { main: { greeting: "Hello" } },
        de: { main: { greeting: "Hallo" } },
    });
    const plugin = new I18nextCore<TestContext, "main">({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
        ns: "main",
    });

    await inMiddleware(
        plugin,
        makeContext("hi", "de"),
        (ctx) => expect(ctx.t("greeting")).toBe("Hallo"),
    );

    expect(backend.requested).toContain("en:main");
    expect(backend.requested).toContain("de:main");
});

Deno.test("loads a negotiated language from a lazy backend on demand", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
        de: { translation: { greeting: "Hallo" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });

    await inMiddleware(plugin, makeContext("hi", "de"), async (ctx) => {
        expect(ctx.t("greeting")).toBe("Hallo");
        await ctx.i18n.useLocale("en");
        expect(ctx.t("greeting")).toBe("Hello");
    });

    expect(backend.requested).toEqual(["en:translation", "de:translation"]);

    // The second update finds the resources in the store and loads nothing.
    await inMiddleware(plugin, makeContext("hi", "de"), () => {});
    expect(backend.requested).toEqual(["en:translation", "de:translation"]);
});

Deno.test("a backend failure while loading a locale falls back instead of failing", async () => {
    const backend = fakeBackend(
        { en: { translation: { greeting: "Hello" } } },
        ["de"],
    );
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });
    await plugin.ready();
    const failed: string[] = [];
    plugin.instance.on("failedLoading", (lng: string) => failed.push(lng));

    // Mirrors i18next's `changeLanguage`: the locale is used, the missing
    // resources fall back along the hierarchy, and the failure is observable
    // through i18next's own `failedLoading` event.
    await inMiddleware(plugin, makeContext("hi", "de"), (ctx) => {
        expect(ctx.i18n.getLocale()).toBe("de");
        expect(ctx.t("greeting")).toBe("Hello");
    });
    expect(failed).toContain("de");
});

Deno.test("concurrent updates in an unloaded locale share one load", async () => {
    const backend = fakeBackend({
        en: { translation: { greeting: "Hello" } },
        de: { translation: { greeting: "Hallo" } },
    });
    const plugin = makePlugin({
        i18next: i18next.createInstance().use(backend),
        initOptions: { fallbackLng: "en" },
    });
    await plugin.ready();

    await Promise.all(
        Array.from({ length: 10 }, () =>
            inMiddleware(
                plugin,
                makeContext("hi", "de"),
                (ctx) => expect(ctx.t("greeting")).toBe("Hallo"),
            )),
    );

    expect(
        backend.requested.filter((r) => r === "de:translation"),
    ).toHaveLength(1);
});

Deno.test("without a backend nothing is loaded lazily", async () => {
    const plugin = makePlugin();
    await inMiddleware(plugin, makeContext("hi", "fr"), (ctx) => {
        // No backend, so an unknown locale simply falls back.
        expect(ctx.i18n.getLocale()).toBe("fr");
        expect(ctx.t("greeting")).toBe("Hello");
    });
});
