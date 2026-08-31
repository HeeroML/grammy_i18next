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
 * The structural subset of a grammY context object that the shared plugin core
 * depends on.
 *
 * The core is deliberately independent of any grammY version: it only needs to
 * read the language of the sending user and to run the text matching of
 * {@link https://grammy.dev | grammY}'s own `hasText` helper. Both the grammY
 * 1.x and the grammY 2.x `Context` classes satisfy this interface, which is how
 * a single implementation can back the `@heeroml/grammy-i18next/v1` and
 * `@heeroml/grammy-i18next/v2` entrypoints.
 *
 * You never have to implement this yourself—use the `Context` type of the
 * grammY version you installed.
 */
export interface ContextLike {
    /**
     * The user who sent the current update, if any. Only the language of the
     * user is relevant for locale negotiation.
     */
    readonly from?: { language_code?: string } | undefined;
    /**
     * Returns `true` if the update contains one of the given texts, either as
     * message text or as a media caption. This is grammY's own matching logic,
     * so it also populates `ctx.match` (and `ctx.payload` on grammY 2.x).
     *
     * @param trigger The texts to match the update against.
     */
    hasText(trigger: string[]): boolean;
}

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
export type LocaleNegotiator<C extends ContextLike = ContextLike> = (
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
export interface LocaleStore<C extends ContextLike = ContextLike> {
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
     * Returns the locale currently used for translating via `ctx.t`. Unlike in
     * `@grammyjs/i18n`, this is synchronous and reflects the locale that is in
     * flight for this update, including changes made via {@link useLocale}.
     */
    getLocale(): string;
    /**
     * Uses the given locale for all subsequent `ctx.t` calls of this update.
     * This does not persist the locale—use {@link setLocale} for that.
     *
     * If the resources of the locale are already present, `ctx.t` is rebound
     * synchronously, so `ctx.t` reflects the new locale even before the
     * returned promise settles. If a lazy-loading backend is attached and the
     * locale still has to be fetched, `ctx.t` is rebound once loading finished,
     * so always await this call to be safe.
     *
     * Like i18next's own `changeLanguage`, a locale whose resources cannot be
     * loaded is still used: translations fall back along the language
     * hierarchy, and the failure is reported through the i18next instance's
     * `failedLoading` event rather than by rejecting this promise.
     *
     * @param locale The locale to use for the rest of this update.
     */
    useLocale(locale: string): Promise<void>;
    /**
     * Uses the given locale for all subsequent `ctx.t` calls of this update,
     * and persists it via the configured locale store (if any).
     *
     * If the store fails to persist the locale, the returned promise rejects
     * with the store's error but the locale stays in use for this update.
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
     * Alias of {@link renegotiate}, provided for compatibility with
     * `@grammyjs/i18n`.
     */
    renegotiateLocale(): Promise<string>;
    /**
     * The underlying i18next instance shared by all updates. Note that its
     * global language is not per-update state—always prefer `ctx.t` inside
     * handlers.
     */
    readonly instance: i18n;
}

/**
 * Transformative context flavor of the i18next plugin. Apply it to your custom
 * context type to receive `ctx.t`, `ctx.translate`, and `ctx.i18n`:
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
    C extends ContextLike,
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
     * Alias of {@link t}, provided for compatibility with `@grammyjs/i18n`.
     * Both properties always return the very same function object.
     */
    translate: TFunction<Ns>;
    /**
     * Controls for inspecting and changing the locale of the current update.
     */
    i18n: I18nextControls;
};

/**
 * Options for the i18next plugin.
 *
 * At least one source of translations must be configured: either pass an
 * i18next instance via {@link I18nextOptions.i18next}, or pass
 * {@link I18nextOptions.initOptions} to let the plugin create one internally.
 * Both may be combined to initialize an instance that you configured with
 * i18next plugins yourself.
 */
export interface I18nextOptions<
    C extends ContextLike = ContextLike,
    Ns extends Namespace = DefaultNamespace,
> {
    /**
     * An i18next instance to use for translating. This gives you full control:
     * attach any i18next plugins (backends, formatters, post-processors) and,
     * if you want, initialize the instance yourself.
     *
     * If the instance is not initialized yet, the plugin initializes it with
     * {@link initOptions} before handling the first update. If somebody else
     * already started initializing it, the plugin waits for that to finish.
     */
    i18next?: i18n;
    /**
     * i18next init options used to initialize the i18next instance. Use this
     * for the common case where you only need resources, a fallback language,
     * and standard i18next behavior.
     *
     * Passing init options together with an instance that is already
     * initialized is an error, because i18next would rebuild all of its
     * services and silently discard state. The error surfaces when the plugin
     * becomes ready, i.e. on the first update or when awaiting `ready()`.
     */
    initOptions?: InitOptions;
    /**
     * The locale to use when negotiation fails, i.e. when the locale
     * negotiator returns `undefined`. Defaults to the first configured
     * `fallbackLng` of the i18next instance, and to `"dev"` if there is none.
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
     *
     * With a lazy-loading backend, the bound namespaces are registered and
     * loaded once when the plugin becomes ready, so that they are also fetched
     * for every locale negotiated later on.
     */
    ns?: Ns;
    /**
     * The locales your bot supports. Setting this has two effects: it is the
     * list used by `hears` in `"all-locales"` mode, and—if a lazy-loading
     * backend is attached—these locales are preloaded when the plugin becomes
     * ready. Preloading is required for `hears`, because a synchronous
     * predicate cannot fetch translations on demand.
     *
     * Defaults to the locales that currently have resources in the i18next
     * instance.
     */
    supportedLocales?: string[];
}

/**
 * Options for the `hears` filter predicate.
 */
export interface I18nextHearsOptions {
    /**
     * Which locales to match the translated text against.
     *
     * - `"all-locales"` (default): the update matches if its text equals the
     *   translation of the key in _any_ supported locale. This is what you
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
