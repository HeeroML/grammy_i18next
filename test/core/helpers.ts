import type { Namespace } from "i18next";
import { I18nextCore } from "../../src/core/plugin.ts";
import type {
    ContextLike,
    I18nextFlavor,
    I18nextOptions,
} from "../../src/core/types.ts";
import { resources } from "../shared/fixtures.ts";

/**
 * A plain object that satisfies {@link ContextLike}. The core is independent of
 * grammY, so its unit tests do not construct a real `Context`.
 */
export interface TestContext extends ContextLike {
    readonly from?: { id: number; language_code?: string } | undefined;
    readonly text: string;
    hasText(trigger: string[]): boolean;
}

/** A {@link TestContext} that also carries a session, for store tests. */
export interface TestSessionContext extends TestContext {
    session: Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * Creates a context object for the core unit tests.
 *
 * @param text The message text the context reports via `hasText`.
 * @param languageCode The `language_code` of the sender, if any.
 * @param id The id of the sender.
 */
export function makeContext(
    text = "hi",
    languageCode?: string,
    id = 1234,
): I18nextFlavor<TestContext> {
    const ctx: TestContext = {
        from: {
            id,
            ...(languageCode === undefined
                ? {}
                : { language_code: languageCode }),
        },
        text,
        hasText: (trigger) => trigger.includes(text),
    };
    // The middleware installs `t`, `translate`, and `i18n` at runtime.
    return ctx as I18nextFlavor<TestContext>;
}

/**
 * Creates a plugin over the shared test resources.
 *
 * @param options Options that override the defaults.
 */
export function makePlugin(
    options: I18nextOptions<TestContext> = {},
): I18nextCore<TestContext> {
    return new I18nextCore<TestContext>({
        initOptions: { fallbackLng: "en", resources },
        ...options,
    });
}

/**
 * Runs the plugin middleware over a context with the given downstream
 * middleware.
 *
 * @param plugin The plugin whose middleware to run.
 * @param ctx The context object to pass through the middleware.
 * @param next The downstream middleware.
 */
export function applyMiddleware<Ns extends Namespace>(
    plugin: I18nextCore<TestContext, Ns>,
    ctx: I18nextFlavor<TestContext>,
    next: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
    return plugin.middleware()(
        ctx as unknown as I18nextFlavor<TestContext, Ns>,
        next,
    );
}

/**
 * Runs `body` as the downstream middleware of the plugin, i.e. while `ctx.t`,
 * `ctx.translate`, and `ctx.i18n` are installed, and returns its result. The
 * plugin removes those properties again once the middleware returns, so
 * assertions about them have to run here.
 *
 * @param plugin The plugin whose middleware to run.
 * @param ctx The context object to pass through the middleware.
 * @param body The assertions to run downstream of the plugin.
 */
export async function inMiddleware<Ns extends Namespace, T>(
    plugin: I18nextCore<TestContext, Ns>,
    ctx: I18nextFlavor<TestContext>,
    body: (ctx: I18nextFlavor<TestContext>) => T | Promise<T>,
): Promise<T> {
    let result: T | undefined;
    await applyMiddleware(plugin, ctx, async () => {
        result = await body(ctx);
    });
    return result as T;
}
