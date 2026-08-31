import { createDebug } from "@grammyjs/debug";
import i18next, {
    type DefaultNamespace,
    type i18n,
    type Namespace,
    type TFunction,
    type TOptions,
} from "i18next";
import { installI18nextProperties } from "./install.ts";
import { firstFallbackLocale, normalizeLocale } from "./locale.ts";
import { defaultLocaleNegotiator } from "./negotiator.ts";
import type {
    ContextLike,
    I18nextControls,
    I18nextFlavor,
    I18nextHearsOptions,
    I18nextOptions,
} from "./types.ts";

const debug = createDebug("grammy:i18next");

/**
 * The version-independent implementation of the i18next plugin for grammY.
 *
 * It connects a shared i18next instance to the middleware tree: for every
 * update, it resolves the locale of the user and installs a translation
 * function bound to that locale as `ctx.t` and `ctx.translate`, along with
 * locale controls as `ctx.i18n`.
 *
 * ```ts
 * const i18n = new I18next({
 *     initOptions: {
 *         fallbackLng: "en",
 *         resources: await loadLocales("./locales"),
 *     },
 * });
 * bot.use(i18n);
 * ```
 *
 * Import `I18next` from `@heeroml/grammy-i18next/v1` or
 * `@heeroml/grammy-i18next/v2` instead of using this class directly—those
 * subclasses bind the `Context` and `HearsContext` types of the grammY version
 * you installed.
 *
 * The plugin never mutates the global language of the i18next instance.
 * Instead, every update receives its own translation function via
 * `getFixedT`, which makes concurrent update processing safe by construction.
 */
export class I18nextCore<
    C extends ContextLike = ContextLike,
    Ns extends Namespace = DefaultNamespace,
> {
    /**
     * The underlying i18next instance shared by all updates. It is either the
     * instance passed via the `i18next` option, or one created internally
     * from `initOptions`.
     */
    readonly instance: i18n;

    readonly #options: I18nextOptions<C, Ns>;
    readonly #loading = new Map<string, Promise<void>>();
    #readiness: Promise<void> | undefined;

    /**
     * Constructs a new i18next plugin instance.
     *
     * @param options Plugin options. Pass an i18next instance via `i18next`,
     * or init options via `initOptions` to let the plugin create one
     * internally. Both may be combined to initialize an instance that you
     * configured with i18next plugins yourself.
     */
    constructor(options: I18nextOptions<C, Ns>) {
        if (
            options.i18next === undefined && options.initOptions === undefined
        ) {
            throw new Error(
                "Cannot create the i18next plugin without translations. " +
                    "Either pass an existing i18next instance via the `i18next` option, " +
                    "or pass `initOptions` to let the plugin create one.",
            );
        }
        this.instance = options.i18next ?? i18next.createInstance();
        this.#options = options;
    }

    /**
     * Resolves once the underlying i18next instance is initialized and the
     * namespaces and locales bound to the plugin were loaded. The middleware
     * awaits this automatically before handling the first update, so you only
     * need to call it yourself if you want to use {@link I18nextCore.t} or
     * {@link I18nextCore.locales} outside of middleware.
     *
     * Initialization runs exactly once no matter how often this is called, and
     * a failed initialization keeps failing instead of hanging or silently
     * retrying.
     *
     * @returns A promise that resolves when the plugin is ready to translate.
     */
    ready(): Promise<void> {
        this.#readiness ??= this.#initialize();
        return this.#readiness;
    }

    /**
     * The locale used when locale negotiation fails. This is the
     * `defaultLocale` option if set, the first configured `fallbackLng` of the
     * i18next instance otherwise, and `"dev"` if there is neither.
     */
    get defaultLocale(): string {
        return this.#options.defaultLocale ??
            firstFallbackLocale(this.instance.options?.fallbackLng) ??
            // "dev" is what i18next itself falls back to when nothing is set.
            "dev";
    }

    /**
     * The locales this plugin translates into. These are the
     * `supportedLocales` option if set, and the locales that currently have
     * resources registered on the i18next instance otherwise. Note that with a
     * lazy-loading backend the latter only reflects the resources loaded so
     * far, which is why `hears` in `"all-locales"` mode needs the option.
     */
    get locales(): string[] {
        const supported = this.#options.supportedLocales;
        if (supported !== undefined) return [...supported];
        const data = this.instance.store?.data;
        return data === undefined ? [] : Object.keys(data);
    }

    /**
     * Translates a message key in a specific locale, independently of any
     * update. Useful outside of middleware, e.g. for broadcasts.
     *
     * The i18next instance must be initialized—await {@link ready} first when
     * calling this outside of middleware. With a lazy-loading backend, only
     * locales that are already loaded can be translated here; load others
     * beforehand via the `supportedLocales` option.
     *
     * @param locale The locale to translate into.
     * @param key The message key to translate.
     * @param options Interpolation variables and i18next translate options.
     * @returns The translated message.
     */
    t(locale: string, key: string, options?: TOptions): string {
        if (!this.instance.isInitialized) {
            throw new Error(
                "i18next is not initialized yet. " +
                    "Await `ready()` before translating outside of middleware.",
            );
        }
        return String(
            (this.#bindTranslator(locale) as TFunction)(
                key as never,
                options as never,
            ),
        );
    }

    /**
     * Creates a predicate function that matches updates whose text equals the
     * translation of the given message key. Use it with `bot.filter` to react
     * to localized keyboard buttons without hard-coding every translation:
     *
     * ```ts
     * bot.filter(i18n.hears("menu.settings"), (ctx) => {
     *     // The user pressed the "Settings" button, in whatever language.
     * });
     * ```
     *
     * By default the text is matched against the translations in _all_
     * supported locales, because a keyboard may have been rendered in a
     * different locale than the one negotiated for the current update. Pass
     * `{ mode: "current-locale" }` to only match the current locale.
     *
     * Matching delegates to grammY's own `ctx.hasText`, so message texts and
     * media captions both match, and `ctx.match` (as well as `ctx.payload` on
     * grammY 2.x) is populated for the matched update.
     *
     * @param key The message key whose translations should be matched.
     * @param options Matching mode and interpolation variables.
     * @returns A predicate suitable for `bot.filter`.
     */
    hears(
        key: string,
        options?: I18nextHearsOptions,
    ): <FC extends I18nextFlavor<C, Ns>>(ctx: FC) => boolean {
        const mode = options?.mode ?? "all-locales";
        return <FC extends I18nextFlavor<C, Ns>>(ctx: FC): boolean => {
            const texts = mode === "current-locale"
                ? [
                    String(
                        (ctx.t as TFunction)(
                            key as never,
                            options?.variables as never,
                        ),
                    ),
                ]
                : this.#translateInAllLocales(key, options?.variables);
            return ctx.hasText(texts);
        };
    }

    /**
     * The middleware of the plugin. Install it early, before any middleware
     * that uses `ctx.t` or `ctx.i18n`:
     *
     * ```ts
     * bot.use(i18n);
     * ```
     *
     * For every update, the middleware determines the locale (locale store,
     * then locale negotiator, then default locale) and installs `ctx.t` and
     * `ctx.translate` bound to it, as well as the `ctx.i18n` controls. The
     * properties are removed again once the downstream middleware returned, so
     * nested plugin instances nest properly.
     *
     * @returns The middleware function to pass to `bot.use`.
     */
    middleware(): (
        ctx: I18nextFlavor<C, Ns>,
        next: () => Promise<void>,
    ) => Promise<void> {
        const negotiator = this.#options.localeNegotiator ??
            defaultLocaleNegotiator;
        const store = this.#options.localeStore;

        return async (ctx, next) => {
            await this.ready();

            let locale = this.defaultLocale;
            let translate = this.#bindTranslator(locale);

            const apply = (normalized: string): void => {
                locale = normalized;
                translate = this.#bindTranslator(normalized);
                debug(`Using locale '${normalized}'`);
            };
            const useLocale = (newLocale: string): Promise<void> => {
                if (typeof newLocale !== "string" || newLocale.length === 0) {
                    return Promise.reject(
                        new Error(
                            "Cannot use an empty locale for translations.",
                        ),
                    );
                }
                const normalized = normalizeLocale(this.instance, newLocale);
                const loading = this.#ensureLoaded(normalized);
                // Rebinding synchronously whenever nothing has to be loaded
                // means `ctx.i18n.useLocale("de"); ctx.t("key")` works without
                // an await for the common case of preloaded resources.
                if (loading === undefined) {
                    apply(normalized);
                    return Promise.resolve();
                }
                return loading.then(() => apply(normalized));
            };
            const setLocale = async (newLocale: string): Promise<void> => {
                await useLocale(newLocale);
                // A failing store keeps the locale in flight for this update.
                await store?.write(ctx, locale);
            };
            const renegotiate = async (): Promise<string> => {
                const negotiated = await negotiator(ctx);
                debug(
                    negotiated == null
                        ? `Negotiation failed, using default locale '${this.defaultLocale}'`
                        : `Negotiated locale '${negotiated}'`,
                );
                await useLocale(negotiated ?? this.defaultLocale);
                return locale;
            };

            const restore = installI18nextProperties<Ns>(ctx, {
                getTranslate: () => translate,
                controls: {
                    getLocale: () => locale,
                    useLocale,
                    setLocale,
                    renegotiate,
                    renegotiateLocale: renegotiate,
                    instance: this.instance,
                } satisfies I18nextControls,
            });

            try {
                const stored = await store?.read(ctx);
                if (typeof stored === "string" && stored.length > 0) {
                    debug(`Restored locale '${stored}' from the locale store`);
                    await useLocale(stored);
                } else {
                    await renegotiate();
                }
                await next();
            } finally {
                restore();
            }
        };
    }

    async #initialize(): Promise<void> {
        const instance = this.instance;
        const initOptions = this.#options.initOptions;
        if (instance.isInitialized) {
            if (initOptions !== undefined) {
                throw new Error(
                    "Cannot apply `initOptions` to an i18next instance that is " +
                        "already initialized: a second `init` call would rebuild " +
                        "all i18next services and discard loaded resources. " +
                        "Drop either the `initOptions` or the `i18next` option.",
                );
            }
        } else if (instance.isInitializing) {
            debug("Waiting for an i18next initialization started elsewhere");
            await new Promise<void>((resolve) => {
                instance.once("initialized", () => resolve());
            });
        } else {
            debug("Initializing i18next");
            await new Promise<void>((resolve, reject) => {
                const fail = (cause: unknown): void =>
                    reject(
                        new Error("i18next failed to initialize", { cause }),
                    );
                // The promise returned by `init` resolves even when a backend
                // failed to load resources; the callback is the only signal
                // that reports such errors. It is still awaited for the case
                // of i18next itself rejecting, which must not hang `ready()`.
                instance.init(initOptions ?? {}, (err) => {
                    if (err == null) resolve();
                    else fail(err);
                }).catch(fail);
            });
        }
        await this.#preload();
    }

    async #preload(): Promise<void> {
        if (!this.#hasBackend()) return;
        const ns = this.#options.ns;
        if (ns !== undefined) {
            // Registers the bound namespaces in `options.ns` so that every
            // locale loaded later also fetches them. This must happen exactly
            // once: `loadNamespaces` mutates the instance options and reloads
            // the namespace for every preloaded language.
            debug(`Loading plugin-bound namespaces`);
            await loadNamespaces(this.instance, namespaceList(ns));
        }
        const supported = this.#options.supportedLocales;
        if (supported !== undefined && supported.length > 0) {
            debug(`Preloading locales ${supported.join(", ")}`);
            await loadLanguages(this.instance, supported);
        }
    }

    #bindTranslator(locale: string): TFunction<Ns> {
        // i18next widens the namespace of `getFixedT` to
        // `DefaultNamespace | Ns` because `ns` may be `null` here. The plugin
        // knows the bound namespace exactly, so the result is re-typed.
        return this.instance.getFixedT(
            locale,
            this.#options.ns ?? null,
        ) as TFunction<Ns>;
    }

    #translateInAllLocales(key: string, variables?: TOptions): string[] {
        const texts = new Set<string>();
        for (const locale of this.locales) {
            texts.add(this.t(locale, key, variables));
        }
        return [...texts];
    }

    #hasBackend(): boolean {
        // `Services["backendConnector"]` is typed as `any` by i18next, so the
        // shape is narrowed at runtime instead of being trusted.
        const connector: unknown = this.instance.services?.backendConnector;
        if (typeof connector !== "object" || connector === null) return false;
        return (connector as { backend?: unknown }).backend != null;
    }

    #namespacesToCheck(): string[] {
        const ns = this.#options.ns;
        if (ns !== undefined) return namespaceList(ns);
        const defaultNs = this.instance.options?.defaultNS;
        if (typeof defaultNs === "string") return [defaultNs];
        if (Array.isArray(defaultNs)) return [...defaultNs];
        return ["translation"];
    }

    /**
     * Makes sure the resources of a locale are available before a translator is
     * bound to it, and returns `undefined` when nothing has to be loaded.
     *
     * This only does work when a lazy-loading backend is attached to the
     * instance—initialization typically loads only the initial and fallback
     * languages, so other negotiated locales must be requested explicitly.
     */
    #ensureLoaded(code: string): Promise<void> | undefined {
        if (!this.#hasBackend()) return undefined;
        if (
            !this.#namespacesToCheck().some((ns) =>
                !this.instance.hasResourceBundle(code, ns)
            )
        ) {
            return undefined;
        }
        const pending = this.#loading.get(code);
        if (pending !== undefined) return pending;
        const loading = loadLanguages(this.instance, [code]).catch(
            (error: unknown) => {
                // Mirrors i18next's own `changeLanguage` contract: a locale
                // whose resources cannot be loaded is still used, and
                // translations fall back along the language hierarchy. The
                // failure is reported through i18next's `failedLoading`
                // event (emitted by its backend connector) and this log, so
                // one missing regional file does not take the bot down for
                // every user of that locale. Dropping the memo lets a later
                // update ask the backend again once i18next allows it.
                this.#loading.delete(code);
                debug(`Failed to load locale '${code}': ${String(error)}`);
            },
        );
        this.#loading.set(code, loading);
        return loading;
    }
}

function namespaceList(ns: Namespace): string[] {
    return typeof ns === "string" ? [ns] : [...ns];
}

function loadNamespaces(instance: i18n, ns: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        instance.loadNamespaces(ns, (err) => {
            if (err == null) resolve();
            else {
                reject(
                    new Error(
                        `i18next failed to load the namespaces ${
                            ns.join(", ")
                        }`,
                        { cause: err },
                    ),
                );
            }
        }).catch(reject);
    });
}

function loadLanguages(instance: i18n, locales: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        instance.loadLanguages(locales, (err) => {
            if (err == null) resolve();
            else {
                reject(
                    new Error(
                        `i18next failed to load the locales ${
                            locales.join(", ")
                        }`,
                        { cause: err },
                    ),
                );
            }
        }).catch(reject);
    });
}
