import { createDebug } from "@grammyjs/debug";
import {
    Context,
    type HearsContext,
    type MiddlewareFn,
    type MiddlewareObj,
} from "@grammyjs/grammy";
import i18next, {
    type DefaultNamespace,
    type FallbackLng,
    type i18n,
    type Namespace,
    type TFunction,
    type TOptions,
} from "i18next";
import { defaultLocaleNegotiator } from "./negotiator.ts";
import type {
    I18nextControls,
    I18nextFlavor,
    I18nextHearsOptions,
    I18nextOptions,
} from "./types.ts";

const debug = createDebug("grammy:i18next");

/**
 * The i18next plugin for grammY. It connects a shared i18next instance to the
 * middleware tree: for every update, it resolves the locale of the user and
 * installs a translation function bound to that locale as `ctx.t`, along with
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
 * bot.command("start", (ctx) => ctx.send(ctx.t("greeting")));
 * ```
 *
 * The plugin never mutates the global language of the i18next instance.
 * Instead, every update receives its own translation function via
 * `getFixedT`, which makes concurrent update processing safe by construction.
 */
export class I18next<
    C extends Context = Context,
    Ns extends Namespace = DefaultNamespace,
> implements MiddlewareObj<I18nextFlavor<C, Ns>> {
    /**
     * The underlying i18next instance shared by all updates. It is either the
     * instance passed via the `i18next` option, or one created internally
     * from `initOptions`.
     */
    readonly instance: i18n;

    #options: I18nextOptions<C, Ns>;
    #initialization: Promise<void> | undefined;

    /**
     * Constructs a new i18next plugin instance.
     *
     * @param options Plugin options. Pass a ready i18next instance via
     * `i18next`, or init options via `initOptions` to let the plugin create
     * one internally.
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
     * Resolves once the underlying i18next instance is initialized. The
     * middleware awaits this automatically before handling the first update,
     * so you only need to call it yourself if you want to use
     * {@link I18next.t} or {@link I18next.locales} outside of middleware.
     */
    ready(): Promise<void> {
        if (this.instance.isInitialized) return Promise.resolve();
        this.#initialization ??= this.instance.isInitializing
            // Somebody else started initialization; wait for it to finish.
            ? new Promise<void>((resolve) =>
                this.instance.on("initialized", () => resolve())
            )
            : this.instance.init(this.#options.initOptions ?? {}).then(
                () => {},
            );
        return this.#initialization;
    }

    /**
     * The locale used when locale negotiation fails. This is the
     * `defaultLocale` option if set, and the first configured `fallbackLng`
     * of the i18next instance otherwise.
     */
    get defaultLocale(): string {
        return this.#options.defaultLocale ??
            firstFallbackLocale(this.instance.options?.fallbackLng) ??
            // "dev" is what i18next itself falls back to when nothing is set.
            "dev";
    }

    /**
     * The locales that currently have resources registered on the i18next
     * instance. Note that with lazy-loading backends this only reflects the
     * resources loaded so far.
     */
    get locales(): string[] {
        const data = this.instance.services?.resourceStore?.data;
        return data === undefined ? [] : Object.keys(data);
    }

    /**
     * Translates a message key in a specific locale, independently of any
     * update. Useful outside of middleware, e.g. for broadcasts.
     *
     * The i18next instance must be initialized—await {@link ready} first when
     * calling this outside of middleware. With a lazy-loading backend, only
     * locales that are already loaded can be translated here; load others
     * beforehand via `instance.loadLanguages(locale)`.
     *
     * @param locale The locale to translate into.
     * @param key The message key to translate.
     * @param options Interpolation variables and i18next translate options.
     */
    t(locale: string, key: string, options?: TOptions): string {
        if (!this.instance.isInitialized) {
            throw new Error(
                "i18next is not initialized yet. " +
                    "Await `ready()` before translating outside of middleware.",
            );
        }
        const translate = this.instance.getFixedT(
            locale,
            this.#options.ns ?? null,
        );
        return String(translate(key as never, options as never));
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
     * registered locales, because a keyboard may have been rendered in a
     * different locale than the one negotiated for the current update. Pass
     * `{ mode: "current-locale" }` to only match the current locale.
     *
     * @param key The message key whose translations should be matched.
     * @param options Matching mode and interpolation variables.
     */
    hears(
        key: string,
        options?: I18nextHearsOptions,
    ): <FC extends I18nextFlavor<C, Ns>>(
        ctx: FC,
    ) => ctx is HearsContext<FC, string> {
        const mode = options?.mode ?? "all-locales";
        return <FC extends I18nextFlavor<C, Ns>>(
            ctx: FC,
        ): ctx is HearsContext<FC, string> => {
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
            return Context.has.text(texts)(ctx);
        };
    }

    #translateInAllLocales(key: string, variables?: TOptions): string[] {
        const texts = new Set<string>();
        for (const locale of this.locales) {
            texts.add(this.t(locale, key, variables));
        }
        return [...texts];
    }

    #normalizeLocale(locale: string): string {
        const utils = this.instance.services?.languageUtils;
        return typeof utils?.formatLanguageCode === "function"
            ? utils.formatLanguageCode(locale)
            : locale;
    }

    /**
     * Makes sure the resources of a locale are available before a translator
     * is bound to it. This only does work when a lazy-loading backend is
     * attached to the instance—initialization typically loads only the
     * initial and fallback languages, so other negotiated locales must be
     * requested from the backend explicitly. Without a backend (resources
     * passed upfront), this is a no-op.
     */
    async #ensureLanguageLoaded(locale: string): Promise<void> {
        const connector = this.instance.services?.backendConnector;
        if (connector?.backend == null) return;
        const ns = this.#options.ns;
        if (ns !== undefined) {
            // Registers the bound namespaces in `options.ns` (and loads them
            // for the current languages), so that `loadLanguages` below also
            // fetches them for the negotiated locale. Without this, a
            // namespace bound only via the plugin's `ns` option would never
            // be requested from the backend.
            await this.instance.loadNamespaces(ns as string | string[]);
        }
        await this.instance.loadLanguages(locale);
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
     * then locale negotiator, then default locale) and installs `ctx.t` bound
     * to it, as well as the `ctx.i18n` controls.
     */
    middleware(): MiddlewareFn<I18nextFlavor<C, Ns>> {
        const negotiator = this.#options.localeNegotiator ??
            defaultLocaleNegotiator;
        const store = this.#options.localeStore;
        const ns = this.#options.ns ?? null;

        return async (ctx, next) => {
            await this.ready();

            let locale = this.defaultLocale;
            let translate = this.instance.getFixedT(locale, ns);

            const useLocale = async (newLocale: string): Promise<void> => {
                if (typeof newLocale !== "string" || newLocale.length === 0) {
                    throw new Error(
                        "Cannot use an empty locale for translations.",
                    );
                }
                const normalized = this.#normalizeLocale(newLocale);
                await this.#ensureLanguageLoaded(normalized);
                locale = normalized;
                translate = this.instance.getFixedT(locale, ns);
                debug(`Using locale '${locale}'`);
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
            const setLocale = async (newLocale: string): Promise<void> => {
                await useLocale(newLocale);
                await store?.write(ctx, locale);
            };

            Object.defineProperty(ctx, "t", {
                configurable: true,
                enumerable: true,
                // A getter so that `ctx.t` always reflects locale changes
                // made via `useLocale` after the property was installed.
                get: () => translate,
            });
            Object.defineProperty(ctx, "i18n", {
                configurable: true,
                enumerable: true,
                writable: true,
                value: {
                    getLocale: () => locale,
                    useLocale,
                    setLocale,
                    renegotiate,
                    instance: this.instance,
                } satisfies I18nextControls,
            });

            const stored = await store?.read(ctx);
            if (typeof stored === "string" && stored.length > 0) {
                debug(`Restored locale '${stored}' from the locale store`);
                await useLocale(stored);
            } else {
                await renegotiate();
            }

            await next();
        };
    }
}

function firstFallbackLocale(
    fallback: FallbackLng | false | undefined,
): string | undefined {
    if (typeof fallback === "string") return fallback;
    if (Array.isArray(fallback)) return fallback[0];
    if (typeof fallback === "object" && fallback !== null) {
        const record = fallback as Record<string, FallbackLng>;
        return firstFallbackLocale(record.default);
    }
    // Per-code fallback functions have no single default locale.
    return undefined;
}
