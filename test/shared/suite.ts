import { expect } from "@std/expect";
import i18next, {
    type i18n,
    type Namespace,
    type TFunction,
    type TOptions,
} from "i18next";
import { sessionLocaleStore } from "../../src/core/session.ts";
import type {
    I18nextControls,
    I18nextHearsOptions,
    I18nextOptions,
} from "../../src/core/types.ts";
import {
    captionUpdate,
    fakeBackend,
    messageUpdate,
    resources,
    type UpdateFixture,
} from "./fixtures.ts";

/**
 * The context shape the shared suite relies on. Both majors' flavored context
 * types provide all of it; the adapters cast their real context to this type
 * once at the boundary.
 */
export interface SuiteContext {
    readonly from?: { id?: number; language_code?: string } | undefined;
    t: TFunction;
    translate: TFunction;
    i18n: I18nextControls;
    /** Installed by {@link SuiteChain.session}. */
    session: Record<string, unknown>;
    /** Scratch property that some tests install from a middleware. */
    extra?: string;
    hasText(trigger: string[]): boolean;
}

/** A middleware written against {@link SuiteContext}. */
export type SuiteMiddleware = (
    ctx: SuiteContext,
    next: () => Promise<void>,
) => Promise<void>;

/** A filter predicate written against {@link SuiteContext}. */
export type SuitePredicate = (ctx: SuiteContext) => boolean;

/** The parts of the plugin the shared suite uses. */
export interface SuitePlugin {
    readonly instance: i18n;
    readonly locales: string[];
    ready(): Promise<void>;
    t(locale: string, key: string, options?: TOptions): string;
    hears(key: string, options?: I18nextHearsOptions): SuitePredicate;
}

/** A middleware chain, i.e. either the bot itself or a nested composer. */
export interface SuiteChain {
    /** Appends plain middleware. */
    use(...middleware: SuiteMiddleware[]): void;
    /** Appends the plugin in its object form, like `bot.use(i18n)`. */
    plugin(plugin: SuitePlugin): void;
    /** Appends a filtered branch, like `bot.filter(predicate, handler)`. */
    filter(predicate: SuitePredicate, ...middleware: SuiteMiddleware[]): void;
    /** Appends a nested `Composer` and returns its chain. */
    composer(): SuiteChain;
    /** Appends session middleware backed by the given storage. */
    session(storage: Map<number, Record<string, unknown>>): void;
}

/** A running bot with its outgoing API calls intercepted. */
export interface SuiteHarness {
    /** The root middleware chain of the bot. */
    readonly chain: SuiteChain;
    /** Every outgoing Bot API call, in order. */
    readonly calls: { method: string; payload: Record<string, unknown> }[];
    /**
     * Runs one update through `bot.handleUpdate`. grammY's `BotError` wrapper
     * is unwrapped so that both majors reject with the original error.
     */
    handle(update: UpdateFixture): Promise<void>;
}

/** Everything the shared suite needs to know about a grammY major. */
export interface SuiteAdapter {
    /** Human readable name used as a test name prefix. */
    readonly name: string;
    /** Creates a real `Bot` whose outgoing calls are recorded. */
    createBot(): SuiteHarness;
    /** Creates this major's `I18next` plugin. */
    createPlugin<Ns extends Namespace>(
        options: I18nextOptions<SuiteContext, Ns>,
    ): SuitePlugin;
    /** Sends a text message: `ctx.reply` on 1.x, `ctx.send` on 2.x. */
    reply(ctx: SuiteContext, text: string): Promise<unknown>;
    /** The matched text: `ctx.match` on 1.x, `ctx.payload` on 2.x. */
    matched(ctx: SuiteContext): unknown;
}

/**
 * Runs the version-independent integration suite against one grammY major.
 * Every test drives a real `Bot` through `bot.handleUpdate`, so the whole
 * middleware pipeline of that major is exercised.
 *
 * @param adapter The bindings for the grammY major under test.
 */
export function runSharedSuite(adapter: SuiteAdapter): void {
    const test = (name: string, fn: () => Promise<void>): void => {
        Deno.test(`${adapter.name}: ${name}`, fn);
    };
    const makePlugin = (
        options: I18nextOptions<SuiteContext> = {},
    ): SuitePlugin =>
        adapter.createPlugin({
            initOptions: { fallbackLng: "en", resources },
            ...options,
        });
    const texts = (harness: SuiteHarness): unknown[] =>
        harness.calls.map((call) => call.payload.text);
    const replyWithGreeting: SuiteMiddleware = async (ctx) => {
        await adapter.reply(ctx, ctx.t("greeting"));
    };

    test("translates replies in the negotiated locale", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));
        await bot.handle(messageUpdate("hi", "en"));

        expect(texts(bot)).toEqual(["Hallo", "Hello"]);
    });

    test("falls back to the default locale without a language_code", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hello"]);
    });

    test("prefers the defaultLocale option over fallbackLng", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({ defaultLocale: "de" }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("a middleware before the plugin can be read by the negotiator", async () => {
        const bot = adapter.createBot();
        bot.chain.use((ctx, next) => {
            ctx.extra = "de";
            return next();
        });
        bot.chain.plugin(makePlugin({ localeNegotiator: (ctx) => ctx.extra }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "en"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("a middleware after the plugin sees ctx.t and ctx.i18n", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(async (ctx, next) => {
            await adapter.reply(
                ctx,
                `${ctx.i18n.getLocale()}:${ctx.t("greeting")}`,
            );
            await next();
        });
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));

        expect(texts(bot)).toEqual(["de:Hallo", "Hallo"]);
    });

    test("sessionLocaleStore persists setLocale across updates", async () => {
        const storage = new Map<number, Record<string, unknown>>();
        const bot = adapter.createBot();
        bot.chain.session(storage);
        bot.chain.plugin(makePlugin({ localeStore: sessionLocaleStore() }));
        bot.chain.use(async (ctx) => {
            if (ctx.hasText(["/de"])) await ctx.i18n.setLocale("de");
            await adapter.reply(ctx, ctx.t("greeting"));
        });

        await bot.handle(messageUpdate("/de"));
        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hallo", "Hallo"]);
        expect(storage.get(1234)).toEqual({ __language_code: "de" });
    });

    test("works inside a nested composer", async () => {
        const bot = adapter.createBot();
        const nested = bot.chain.composer();
        nested.plugin(makePlugin());
        nested.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("a nested plugin instance only owns its own scope", async () => {
        const seen: string[] = [];
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(async (ctx, next) => {
            seen.push(ctx.t("greeting"));
            await next();
            // The inner chain returned, so the outer translator is back.
            seen.push(ctx.t("greeting"));
            expect(ctx.i18n.getLocale()).toBe("en");
        });
        const nested = bot.chain.composer();
        nested.plugin(
            makePlugin({
                initOptions: {
                    fallbackLng: "en",
                    resources: { en: { translation: { greeting: "Howdy" } } },
                },
            }),
        );
        nested.use((ctx, next) => {
            seen.push(ctx.t("greeting"));
            return next();
        });

        await bot.handle(messageUpdate("hi"));

        expect(seen).toEqual(["Hello", "Howdy", "Hello"]);
    });

    test("the locale store and negotiator receive the full context", async () => {
        const storage = new Map<number, Record<string, unknown>>();
        const bot = adapter.createBot();
        bot.chain.session(storage);
        bot.chain.use((ctx, next) => {
            ctx.extra = "de";
            return next();
        });
        bot.chain.plugin(makePlugin({
            localeNegotiator: (ctx) => ctx.extra,
            localeStore: {
                read: (ctx) => {
                    const stored = ctx.session.locale;
                    return typeof stored === "string" ? stored : undefined;
                },
                write: (ctx, locale) => {
                    ctx.session.locale = `${locale}/${ctx.extra}`;
                },
            },
        }));
        bot.chain.use(async (ctx) => {
            await adapter.reply(ctx, ctx.t("greeting"));
            await ctx.i18n.setLocale("en");
        });

        await bot.handle(messageUpdate("hi", "en"));

        expect(texts(bot)).toEqual(["Hallo"]);
        expect(storage.get(1234)).toEqual({ locale: "en/de" });
    });

    test("hears matches texts and captions in every locale", async () => {
        const matched: unknown[] = [];
        const plugin = makePlugin();
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.filter(plugin.hears("button.report"), async (ctx) => {
            matched.push(adapter.matched(ctx));
            await adapter.reply(ctx, ctx.t("greeting"));
        });

        // An English user presses a button that was rendered in German.
        await bot.handle(messageUpdate("Melden"));
        await bot.handle(captionUpdate("Report"));
        await bot.handle(messageUpdate("unrelated"));

        expect(texts(bot)).toEqual(["Hello", "Hello"]);
        expect(matched).toEqual(["Melden", "Report"]);
    });

    test("hears in current-locale mode only matches the current locale", async () => {
        const plugin = makePlugin();
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.filter(
            plugin.hears("button.report", { mode: "current-locale" }),
            replyWithGreeting,
        );

        await bot.handle(messageUpdate("Melden"));
        await bot.handle(messageUpdate("Melden", "de"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("hears interpolates variables before matching", async () => {
        const plugin = makePlugin();
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.filter(
            plugin.hears("items", { variables: { count: 3 } }),
            replyWithGreeting,
        );

        await bot.handle(messageUpdate("3 items"));
        await bot.handle(messageUpdate("4 items"));

        expect(texts(bot)).toEqual(["Hello"]);
    });

    test("hears matches lazily loaded locales listed in supportedLocales", async () => {
        const backend = fakeBackend({
            en: { translation: { button: { report: "Report" } } },
            de: { translation: { button: { report: "Melden" } } },
        });
        const plugin = makePlugin({
            i18next: i18next.createInstance().use(backend),
            initOptions: { fallbackLng: "en" },
            supportedLocales: ["en", "de"],
        });
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.filter(plugin.hears("button.report"), async (ctx) => {
            await adapter.reply(ctx, "matched");
        });

        // Nothing was ever negotiated into German, so only the preloading at
        // `ready()` can make the German button text known to the predicate.
        await bot.handle(messageUpdate("Melden"));

        expect(texts(bot)).toEqual(["matched"]);
        expect(backend.requested).toContain("de:translation");
    });

    test("useLocale rebinds ctx.t synchronously for loaded locales", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(async (ctx) => {
            const pending = ctx.i18n.useLocale("de");
            // Deliberately read before awaiting.
            await adapter.reply(ctx, ctx.t("greeting"));
            expect(ctx.i18n.getLocale()).toBe("de");
            await pending;
        });

        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("useLocale rejects empty locales", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(async (ctx) => {
            await expect(ctx.i18n.useLocale("")).rejects.toThrow(
                "Cannot use an empty locale",
            );
        });

        await bot.handle(messageUpdate("hi"));
    });

    test("renegotiate and renegotiateLocale re-run the negotiator", async () => {
        let negotiated: string | undefined = "de";
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({ localeNegotiator: () => negotiated }));
        bot.chain.use(async (ctx) => {
            await adapter.reply(ctx, ctx.t("greeting"));
            negotiated = undefined;
            expect(await ctx.i18n.renegotiate()).toBe("en");
            await adapter.reply(ctx, ctx.t("greeting"));
            negotiated = "de";
            expect(await ctx.i18n.renegotiateLocale()).toBe("de");
            await adapter.reply(ctx, ctx.t("greeting"));
        });

        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hallo", "Hello", "Hallo"]);
    });

    test("a stored locale wins over negotiation", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            localeStore: { read: () => "de", write: () => {} },
        }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "en"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("normalizes locale codes", async () => {
        const seen: string[] = [];
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(async (ctx) => {
            seen.push(ctx.i18n.getLocale());
            await ctx.i18n.useLocale("pt_BR");
            seen.push(ctx.i18n.getLocale());
        });

        await bot.handle(messageUpdate("hi", "pt-br"));

        expect(seen).toEqual(["pt-BR", "pt-BR"]);
    });

    test("loads a negotiated language from a lazy backend", async () => {
        const backend = fakeBackend({
            en: { translation: { greeting: "Hello" } },
            de: { translation: { greeting: "Hallo" } },
        });
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            i18next: i18next.createInstance().use(backend),
            initOptions: { fallbackLng: "en" },
        }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));

        expect(backend.requested).toContain("de:translation");
        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("loads namespaces bound only via the ns option from a backend", async () => {
        const backend = fakeBackend({
            en: { main: { greeting: "Hello" } },
            de: { main: { greeting: "Hallo" } },
        });
        const bot = adapter.createBot();
        // "main" is absent from the i18next init options, so the plugin must
        // register and load it for every negotiated locale.
        bot.chain.plugin(adapter.createPlugin<"main">({
            i18next: i18next.createInstance().use(backend),
            initOptions: { fallbackLng: "en" },
            ns: "main",
        }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));

        expect(backend.requested).toContain("de:main");
        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("binds the namespaces of the ns option into ctx.t", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(adapter.createPlugin<"main">({
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
        }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hello"]);
    });

    test("uses an external i18next instance that is already initialized", async () => {
        const instance = i18next.createInstance();
        await instance.init({ fallbackLng: "en", resources });
        const plugin = adapter.createPlugin({ i18next: instance });
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));

        expect(plugin.instance).toBe(instance);
        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("initializes an external i18next instance that is not initialized", async () => {
        const instance = i18next.createInstance({
            fallbackLng: "en",
            resources,
        });
        const bot = adapter.createBot();
        bot.chain.plugin(adapter.createPlugin({ i18next: instance }));
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi"));

        expect(instance.isInitialized).toBe(true);
        expect(texts(bot)).toEqual(["Hello"]);
    });

    test("a failing initialization rejects every update", async () => {
        const backend = fakeBackend({}, ["en"]);
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            i18next: i18next.createInstance().use(backend),
            initOptions: { fallbackLng: "en" },
        }));
        bot.chain.use(replyWithGreeting);

        await expect(bot.handle(messageUpdate("hi"))).rejects.toThrow(
            "i18next failed to initialize",
        );
        // The cached failure is replayed instead of hanging or retrying.
        await expect(bot.handle(messageUpdate("hi"))).rejects.toThrow(
            "i18next failed to initialize",
        );
        expect(backend.requested).toEqual(["en:translation"]);
    });

    test("initOptions for an already initialized instance are an error", async () => {
        const instance = i18next.createInstance();
        await instance.init({ fallbackLng: "en", resources });
        const bot = adapter.createBot();
        bot.chain.plugin(adapter.createPlugin({
            i18next: instance,
            initOptions: { fallbackLng: "de" },
        }));
        bot.chain.use(replyWithGreeting);

        await expect(bot.handle(messageUpdate("hi"))).rejects.toThrow(
            "already initialized",
        );
    });

    test("a backend failure while loading a locale falls back instead of failing", async () => {
        const backend = fakeBackend(
            { en: { translation: { greeting: "Hello" } } },
            ["de"],
        );
        const instance = i18next.createInstance().use(backend);
        const failed: string[] = [];
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            i18next: instance,
            initOptions: { fallbackLng: "en" },
        }));
        bot.chain.use(replyWithGreeting);
        instance.on("failedLoading", (lng: string) => failed.push(lng));

        // Mirrors i18next's `changeLanguage` contract: the update is handled
        // in the fallback language and the failure is observable through
        // i18next's own `failedLoading` event.
        await bot.handle(messageUpdate("hi", "de"));
        expect(failed).toContain("de");
        // i18next's backend connector remembers the failed load and reports
        // no further error for it, so later updates keep falling back to
        // English instead of failing or hanging.
        await bot.handle(messageUpdate("hi", "de"));
        await bot.handle(messageUpdate("hi", "en"));
        expect(
            backend.requested.filter((r) => r === "de:translation"),
        ).toHaveLength(1);
        expect(texts(bot)).toEqual(["Hello", "Hello", "Hello"]);
    });

    test("a failing locale store read rejects the update", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            localeStore: {
                read: () => Promise.reject(new Error("store is down")),
                write: () => {},
            },
        }));
        bot.chain.use(replyWithGreeting);

        await expect(bot.handle(messageUpdate("hi"))).rejects.toThrow(
            "store is down",
        );
        expect(texts(bot)).toEqual([]);
    });

    test("a failing locale store write keeps the locale in flight", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            localeStore: {
                read: () => undefined,
                write: () => Promise.reject(new Error("disk is full")),
            },
        }));
        bot.chain.use(async (ctx) => {
            await expect(ctx.i18n.setLocale("de")).rejects.toThrow(
                "disk is full",
            );
            expect(ctx.i18n.getLocale()).toBe("de");
            await adapter.reply(ctx, ctx.t("greeting"));
        });

        await bot.handle(messageUpdate("hi"));

        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("a failing negotiator rejects the update", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin({
            localeNegotiator: () => Promise.reject(new Error("no idea")),
        }));
        bot.chain.use(replyWithGreeting);

        await expect(bot.handle(messageUpdate("hi"))).rejects.toThrow(
            "no idea",
        );
    });

    test("a throwing downstream middleware propagates and still restores", async () => {
        let captured: SuiteContext | undefined;
        const bot = adapter.createBot();
        bot.chain.use((ctx, next) => {
            captured = ctx;
            return next();
        });
        bot.chain.plugin(makePlugin());
        bot.chain.use(() => Promise.reject(new Error("handler exploded")));

        await expect(bot.handle(messageUpdate("hi"))).rejects.toThrow(
            "handler exploded",
        );
        expect(captured).toBeDefined();
        for (const property of ["t", "translate", "i18n"]) {
            expect(Object.hasOwn(captured as object, property)).toBe(false);
        }
    });

    test("installing the same plugin twice keeps the state coherent", async () => {
        const seen: string[] = [];
        const plugin = makePlugin();
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.plugin(plugin);
        bot.chain.use(async (ctx) => {
            seen.push(ctx.i18n.getLocale());
            await ctx.i18n.useLocale("de");
            await adapter.reply(ctx, ctx.t("greeting"));
        });

        await bot.handle(messageUpdate("hi", "en"));

        expect(seen).toEqual(["en"]);
        expect(texts(bot)).toEqual(["Hallo"]);
    });

    test("installs t, translate, and i18n as hidden properties", async () => {
        let captured: SuiteContext | undefined;
        const bot = adapter.createBot();
        bot.chain.use((ctx, next) => {
            captured = ctx;
            return next();
        });
        bot.chain.plugin(makePlugin());
        bot.chain.use((ctx, next) => {
            expect(Object.keys(ctx)).not.toContain("t");
            expect(Object.keys(ctx)).not.toContain("translate");
            expect(Object.keys(ctx)).not.toContain("i18n");
            expect(JSON.stringify({ ...ctx })).not.toContain("translate");
            expect(ctx.t).toBe(ctx.translate);
            expect(ctx.t("greeting")).toBe("Hello");
            return next();
        });

        await bot.handle(messageUpdate("hi"));

        // Everything is gone again once the plugin's scope ended.
        for (const property of ["t", "translate", "i18n"]) {
            expect(Object.hasOwn(captured as object, property)).toBe(false);
        }
    });

    test("restores a ctx.t that an earlier middleware defined", async () => {
        const earlier = (() => "earlier") as unknown as TFunction;
        const bot = adapter.createBot();
        bot.chain.use(async (ctx, next) => {
            Object.defineProperty(ctx, "t", {
                configurable: true,
                enumerable: false,
                value: earlier,
                writable: true,
            });
            await next();
            expect(ctx.t).toBe(earlier);
            expect(Object.hasOwn(ctx, "translate")).toBe(false);
        });
        bot.chain.plugin(makePlugin());
        bot.chain.use((ctx, next) => {
            expect(ctx.t("greeting")).toBe("Hello");
            return next();
        });

        await bot.handle(messageUpdate("hi"));
    });

    test("keeps locales apart across many interleaved updates", async () => {
        const bot = adapter.createBot();
        bot.chain.plugin(makePlugin());
        bot.chain.use(async (ctx) => {
            for (let i = 0; i < 1 + Math.floor(Math.random() * 4); i++) {
                await Promise.resolve();
            }
            await adapter.reply(ctx, ctx.t("greeting"));
        });

        const updates = Array.from(
            { length: 60 },
            (_, i) => messageUpdate("hi", i % 2 === 0 ? "de" : "en", 1000 + i),
        );
        await Promise.all(updates.map((update) => bot.handle(update)));

        const byChat = new Map(
            bot.calls.map((
                call,
            ) => [call.payload.chat_id, call.payload.text]),
        );
        expect(byChat.size).toBe(60);
        for (let i = 0; i < 60; i++) {
            expect(byChat.get(1000 + i)).toBe(i % 2 === 0 ? "Hallo" : "Hello");
        }
    });

    test("t, locales, and ready work outside of middleware", async () => {
        const plugin = makePlugin();
        expect(() => plugin.t("en", "greeting")).toThrow(
            "i18next is not initialized yet",
        );
        await plugin.ready();
        expect(plugin.t("de", "greeting")).toBe("Hallo");
        expect(plugin.t("en", "items", { count: 3 })).toBe("3 items");
        expect(plugin.locales.toSorted()).toEqual(["de", "en"]);
    });

    test("concurrent ready calls initialize exactly once", async () => {
        const backend = fakeBackend({
            en: { translation: { greeting: "Hello" } },
        });
        const plugin = makePlugin({
            i18next: i18next.createInstance().use(backend),
            initOptions: { fallbackLng: "en" },
        });

        await Promise.all(Array.from({ length: 20 }, () => plugin.ready()));

        expect(backend.requested).toEqual(["en:translation"]);
    });

    test("never mutates the global language of the instance", async () => {
        const plugin = makePlugin();
        await plugin.ready();
        const globalLanguage = plugin.instance.language;
        const bot = adapter.createBot();
        bot.chain.plugin(plugin);
        bot.chain.use(replyWithGreeting);

        await bot.handle(messageUpdate("hi", "de"));

        expect(plugin.instance.language).toBe(globalLanguage);
        expect(texts(bot)).toEqual(["Hallo"]);
    });
}
