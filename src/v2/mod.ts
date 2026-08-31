import type { Context, HearsContext, MiddlewareObj } from "@grammyjs/grammy";
import type { DefaultNamespace, Namespace } from "i18next";
import { I18nextCore } from "../core/plugin.ts";
import type {
    I18nextFlavor as CoreFlavor,
    I18nextHearsOptions,
    I18nextOptions as CoreOptions,
    LocaleNegotiator as CoreLocaleNegotiator,
    LocaleStore as CoreLocaleStore,
} from "../core/types.ts";

export { defaultLocaleNegotiator } from "../core/negotiator.ts";
export { sessionLocaleStore } from "../core/session.ts";
export type { SessionLocaleStoreOptions } from "../core/session.ts";
export type {
    ContextLike,
    I18nextControls,
    I18nextHearsOptions,
    MaybePromise,
} from "../core/types.ts";

/**
 * The i18next plugin for grammY 2.x.
 *
 * For every update it resolves the locale of the user and installs a
 * translation function bound to that locale as `ctx.t` and `ctx.translate`,
 * along with locale controls as `ctx.i18n`:
 *
 * ```ts
 * import { Bot, type Context } from "@grammyjs/grammy";
 * import { I18next, type I18nextFlavor } from "@heeroml/grammy-i18next/v2";
 *
 * type MyContext = I18nextFlavor<Context>;
 *
 * const i18n = new I18next<MyContext>({
 *     initOptions: { fallbackLng: "en", resources },
 * });
 * const bot = new Bot<MyContext>("<token>");
 * bot.use(i18n);
 * bot.command("start", (ctx) => ctx.send(ctx.t("greeting")));
 * ```
 *
 * The plugin never mutates the global language of the i18next instance, so
 * concurrent updates in different locales cannot interfere with each other.
 */
export class I18next<
    C extends Context = Context,
    Ns extends Namespace = DefaultNamespace,
> extends I18nextCore<C, Ns> implements MiddlewareObj<I18nextFlavor<C, Ns>> {
    /**
     * Creates a predicate function that matches updates whose text equals the
     * translation of the given message key, and narrows the context type the
     * same way `bot.hears` does:
     *
     * ```ts
     * bot.filter(i18n.hears("menu.settings"), (ctx) => {
     *     ctx.payload; // string
     * });
     * ```
     *
     * @param key The message key whose translations should be matched.
     * @param options Matching mode and interpolation variables.
     * @returns A type predicate suitable for `bot.filter`.
     */
    override hears(
        key: string,
        options?: I18nextHearsOptions,
    ): <FC extends I18nextFlavor<C, Ns>>(
        ctx: FC,
    ) => ctx is HearsContext<FC, string> {
        const predicate = super.hears(key, options);
        return <FC extends I18nextFlavor<C, Ns>>(
            ctx: FC,
        ): ctx is HearsContext<FC, string> => predicate(ctx);
    }
}

/**
 * Transformative context flavor of the i18next plugin. Apply it to your custom
 * context type to receive `ctx.t`, `ctx.translate`, and `ctx.i18n`:
 *
 * ```ts
 * type MyContext = I18nextFlavor<Context & SessionFlavor<MySession>>;
 * ```
 *
 * If you bind custom namespaces via the `ns` option, pass them as the second
 * type parameter to receive precise key typings on `ctx.t`.
 */
export type I18nextFlavor<
    C extends Context,
    Ns extends Namespace = DefaultNamespace,
> = CoreFlavor<C, Ns>;

/**
 * A function that determines the locale to use for the current update. It
 * receives the full context type of your bot, so it can read sessions, custom
 * properties, and anything else your other plugins installed.
 */
export type LocaleNegotiator<C extends Context = Context> =
    CoreLocaleNegotiator<C>;

/**
 * A storage abstraction for persisting the locale of a user across updates. It
 * receives the full context type of your bot, so it can read sessions, custom
 * properties, and anything else your other plugins installed.
 */
export type LocaleStore<C extends Context = Context> = CoreLocaleStore<C>;

/**
 * Options for the {@link I18next} plugin.
 */
export type I18nextOptions<
    C extends Context = Context,
    Ns extends Namespace = DefaultNamespace,
> = CoreOptions<C, Ns>;

export {
    /**
     * Compatibility alias of {@link I18next} for bots migrating from
     * `@grammyjs/i18n`.
     */
    I18next as I18n,
};
export type {
    /**
     * Compatibility alias of {@link I18nextFlavor} for bots migrating from
     * `@grammyjs/i18n`. Note that this plugin's flavor is transformative, so
     * it is applied as `I18nFlavor<Context>` rather than
     * `Context & I18nFlavor`.
     */
    I18nextFlavor as I18nFlavor,
};
