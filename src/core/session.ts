import type { ContextLike, LocaleStore } from "./types.ts";

/**
 * The session key `@grammyjs/i18n` uses for the stored locale. Reusing it means
 * bots migrating from that plugin keep the locales their users already chose.
 */
const DEFAULT_SESSION_KEY = "__language_code";

/**
 * Options for {@link sessionLocaleStore}.
 */
export interface SessionLocaleStoreOptions {
    /**
     * The session property to store the locale in. Defaults to
     * `"__language_code"`, the key used by `@grammyjs/i18n`.
     */
    key?: string;
}

/**
 * Creates a locale store that persists the locale in `ctx.session`, so
 * `ctx.i18n.setLocale` survives across updates.
 *
 * Install the session plugin _before_ the i18next plugin:
 *
 * ```ts
 * bot.use(session({ initial: () => ({}) }));
 * bot.use(new I18next({ initOptions, localeStore: sessionLocaleStore() }));
 * ```
 *
 * Lazy sessions are supported as well: a `ctx.session` that is a promise is
 * awaited before the locale is read or written.
 *
 * @param options The session property to use.
 * @returns A locale store backed by the session of the current update.
 */
export function sessionLocaleStore<
    C extends ContextLike & { session: unknown } = ContextLike & {
        session: unknown;
    },
>(options?: SessionLocaleStoreOptions): LocaleStore<C> {
    const key = options?.key ?? DEFAULT_SESSION_KEY;
    return {
        async read(ctx: C): Promise<string | undefined> {
            const session = await resolveSession(ctx);
            const value = session[key];
            return typeof value === "string" ? value : undefined;
        },
        async write(ctx: C, locale: string): Promise<void> {
            const session = await resolveSession(ctx);
            session[key] = locale;
        },
    };
}

async function resolveSession(
    ctx: { session: unknown },
): Promise<Record<string, unknown>> {
    const session: unknown = await ctx.session;
    if (typeof session !== "object" || session === null) {
        throw new Error(
            "Cannot read or write the locale because `ctx.session` is not an " +
                "object. The session middleware must be installed before the " +
                "i18next plugin.",
        );
    }
    return session as Record<string, unknown>;
}
