import {
    Bot,
    BotError,
    Composer,
    type Context,
    type MiddlewareObj,
} from "@grammyjs/grammy";
import type { Namespace } from "i18next";
import { I18next, type I18nextFlavor } from "../../src/v2/mod.ts";
import type { I18nextOptions } from "../../src/core/types.ts";
import { botInfo } from "../shared/fixtures.ts";
import {
    runSharedSuite,
    type SuiteChain,
    type SuiteContext,
    type SuiteHarness,
    type SuitePlugin,
} from "../shared/suite.ts";

type SessionData = Record<string, unknown>;
type BaseContext = Context & { session: SessionData };
type MyContext = I18nextFlavor<BaseContext> & { extra?: string };

// The shared suite is written against its own structural `SuiteContext`. The
// real grammY context provides everything it needs, but the two types are not
// related nominally, so the boundary is crossed with a cast in one place per
// direction.
function asSuite(ctx: MyContext): SuiteContext {
    return ctx as unknown as SuiteContext;
}
function asContext(ctx: SuiteContext): MyContext {
    return ctx as unknown as MyContext;
}

function chainOf(composer: Composer<MyContext>): SuiteChain {
    return {
        use(...middleware) {
            for (const mw of middleware) {
                composer.use((ctx, next) => mw(asSuite(ctx), next));
            }
        },
        plugin(plugin) {
            // `plugin` is the real `I18next` instance created below.
            composer.use(plugin as unknown as MiddlewareObj<MyContext>);
        },
        filter(predicate, ...middleware) {
            const branch = composer.filter((ctx) => predicate(asSuite(ctx)));
            for (const mw of middleware) {
                branch.use((ctx, next) => mw(asSuite(ctx), next));
            }
        },
        composer() {
            const nested = new Composer<MyContext>();
            composer.use(nested);
            return chainOf(nested);
        },
        session(storage) {
            // grammY 2.x ships no session plugin (neither in core nor on JSR),
            // so a stub middleware provides `ctx.session`. Mutating the stored
            // object is enough to persist across updates.
            composer.use((ctx, next) => {
                const key = ctx.from?.id ?? 0;
                const data = storage.get(key) ?? {};
                storage.set(key, data);
                ctx.session = data;
                return next();
            });
        },
    };
}

runSharedSuite({
    name: "grammY 2.x",
    createBot(): SuiteHarness {
        const calls: {
            method: string;
            payload: Record<string, unknown>;
        }[] = [];
        const bot = new Bot<MyContext>("42:dummy-token", { me: botInfo });
        // grammY 2.x no longer copies the transformers of `bot.api` onto
        // `ctx.api`, so interception has to happen per update in the very
        // first middleware.
        bot.use((ctx, next) => {
            ctx.api.transform((_prev, data) => {
                calls.push({
                    method: data.method,
                    payload: data.payload as unknown as Record<string, unknown>,
                });
                return Promise.resolve({ ok: true, result: true } as never);
            });
            return next();
        });
        return {
            calls,
            chain: chainOf(bot),
            handle: async (update) => {
                try {
                    await bot.handleUpdate(update);
                } catch (error) {
                    throw error instanceof BotError ? error.error : error;
                }
            },
        };
    },
    createPlugin<Ns extends Namespace>(
        options: I18nextOptions<SuiteContext, Ns>,
    ): SuitePlugin {
        return new I18next<BaseContext, Ns>(
            options as unknown as I18nextOptions<BaseContext, Ns>,
        ) as unknown as SuitePlugin;
    },
    reply(ctx, text) {
        return asContext(ctx).send(text);
    },
    matched(ctx) {
        // grammY 2.x reports string matches through `ctx.payload`.
        return asContext(ctx).payload;
    },
});
