import type { Context } from "@grammyjs/grammy";
import type {
    DefaultNamespace,
    i18n,
    InitOptions,
    Namespace,
    TFunction,
    TOptions,
} from "i18next";

/**
 * A value that may be wrapped in a promise.
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * A function that determines the locale to use for the current update.
 *
 * The negotiator receives the context object and returns a locale code such as
 * `"de"` or `"pt-BR"`, or `undefined` if no locale could be determined. When
 * the negotiator does not return a locale, the plugin falls back to the
 * configured default locale.
 *
 * The default negotiator reads `ctx.from?.language_code` from the incoming
 * update. Pass a custom negotiator to read the locale from other sources, such
 * as a database or the chat instead of the user.
 */
export type LocaleNegotiator<C extends Context = Context> = (
    ctx: C,
) => MaybePromise<string | undefined>;

/**
 * A storage abstraction for persisting the locale of a user across updates.
 *
 * When a locale store is configured, the plugin reads the stored locale before
 * falling back to locale negotiation, and `ctx.i18n.setLocale` persists locale
 * changes through it. This lets you plug in any persistence mechanism—a
 * database, a key-value store, or a session plugin—without changing how the
 * rest of your bot uses translations.
 */
export interface LocaleStore<C extends Context = Context> {
    /**
     * Reads the stored locale for the current update, or returns `undefined`
     * if none is stored. Returning `undefined` makes the plugin negotiate the
     * locale instead.
     *
     * @param ctx The context object of the current update.
     */
    read(ctx: C): MaybePromise<string | undefined>;
    /**
     * Persists the given locale for the current update's user.
     *
     * @param ctx The context object of the current update.
     * @param locale The locale to persist.
     */
    write(ctx: C, locale: string): MaybePromise<void>;
}

/**
 * The control object installed as `ctx.i18n` by the plugin's middleware. It
 * lets handlers inspect and change the locale of the current update.
 */
export interface I18nextControls {
    /**
     * Returns the locale currently used for translating via `ctx.t`.
     */
    getLocale(): string;
    /**
     * Uses the given locale for all subsequent `ctx.t` calls of this update.
     * This does not persist the locale—use {@link setLocale} for that.
     *
     * If a lazy-loading backend is attached to the i18next instance, the
     * locale's resources are loaded from it before `ctx.t` is rebound, so
     * always await this call.
     *
     * @param locale The locale to use for the rest of this update.
     */
    useLocale(locale: string): Promise<void>;
    /**
     * Uses the given locale for all subsequent `ctx.t` calls of this update,
     * and persists it via the configured locale store (if any).
     *
     * @param locale The locale to use and persist.
     */
    setLocale(locale: string): Promise<void>;
    /**
     * Runs the locale negotiator again and uses the resulting locale. Returns
     * the locale that is now in use.
     */
    renegotiate(): Promise<string>;
    /**
     * The underlying i18next instance shared by all updates. Note that its
     * global language is not per-update state—always prefer `ctx.t` inside
     * handlers.
     */
    readonly instance: i18n;
}

/**
 * Transformative context flavor of the i18next plugin. Apply it to your custom
 * context type to receive `ctx.t` and `ctx.i18n`:
 *
 * ```ts
 * type MyContext = I18nextFlavor<Context>;
 * const bot = new Bot<MyContext>("<token>");
 * ```
 *
 * If you bind custom namespaces via the `ns` option, pass them as the second
 * type parameter to receive precise key typings on `ctx.t`.
 */
export type I18nextFlavor<
    C extends Context,
    Ns extends Namespace = DefaultNamespace,
> = C & {
    /**
     * Translates a message key using the locale negotiated for the current
     * update. This is an i18next `TFunction`, so interpolation, plurals,
     * namespaces, and typed keys (via `CustomTypeOptions`) all work exactly
     * like in i18next itself.
     *
     * @param key The message key to translate.
     * @param options Interpolation variables and i18next translate options.
     */
    t: TFunction<Ns>;
    /**
     * Controls for inspecting and changing the locale of the current update.
     */
    i18n: I18nextControls;
};

/**
 * Options for the {@link I18next} plugin.
 *
 * Exactly one source of translations must be configured: either pass a
 * pre-configured i18next instance via {@link i18next}, or let the plugin
 * create and initialize one internally by passing {@link initOptions}.
 */
export interface I18nextOptions<
    C extends Context = Context,
    Ns extends Namespace = DefaultNamespace,
> {
    /**
     * A pre-configured i18next instance to use for translating. This gives
     * you full control: attach any i18next plugins (backends, formatters,
     * post-processors) and initialize the instance yourself. If the instance
     * is not initialized yet, the plugin awaits its initialization before
     * handling the first update.
     */
    i18next?: i18n;
    /**
     * i18next init options used to create and initialize an internal i18next
     * instance. Use this for the common case where you only need resources,
     * a fallback language, and standard i18next behavior.
     *
     * Ignored if {@link i18next} is passed and already initialized.
     */
    initOptions?: InitOptions;
    /**
     * The locale to use when negotiation fails, i.e. when the locale
     * negotiator returns `undefined`. Defaults to the first configured
     * `fallbackLng` of the i18next instance.
     */
    defaultLocale?: string;
    /**
     * A custom locale negotiator determining the locale of each update. The
     * default negotiator reads `ctx.from?.language_code`.
     */
    localeNegotiator?: LocaleNegotiator<C>;
    /**
     * A store for persisting locales across updates. When set, a stored
     * locale takes precedence over locale negotiation, and
     * `ctx.i18n.setLocale` writes through it.
     */
    localeStore?: LocaleStore<C>;
    /**
     * The namespace (or namespaces) to bind into `ctx.t`. Defaults to the
     * default namespace of the i18next instance.
     */
    ns?: Ns;
}

/**
 * Options for the {@link I18next.hears} filter predicate.
 */
export interface I18nextHearsOptions {
    /**
     * Which locales to match the translated text against.
     *
     * - `"all-locales"` (default): the update matches if its text equals the
     *   translation of the key in _any_ registered locale. This is what you
     *   want for matching localized keyboard buttons, because the button was
     *   rendered in whatever locale the user had when the keyboard was sent.
     * - `"current-locale"`: the update only matches the translation in the
     *   locale negotiated for the current update.
     */
    mode?: "all-locales" | "current-locale";
    /**
     * Interpolation variables to use when translating the key before
     * matching.
     */
    variables?: TOptions;
}
