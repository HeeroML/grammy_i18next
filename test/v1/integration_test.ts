import {
    Bot,
    BotError,
    Composer,
    type Context,
    MemorySessionStorage,
    type MiddlewareObj,
    session,
    type SessionFlavor,
} from "grammy";
import type { Namespace } from "i18next";
import { I18next, type I18nextFlavor } from "../../src/v1/mod.ts";
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
type BaseContext = Context & SessionFlavor<SessionData>;
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
            // grammY 1.x ships a real session plugin, so it is used as-is. The
            // storage merely mirrors into the map the suite inspects.
            const memory = new MemorySessionStorage<SessionData>();
            composer.use(session<SessionData, BaseContext>({
                initial: () => ({}),
                storage: {
                    read: (key) => memory.read(key),
                    write: (key, value) => {
                        memory.write(key, value);
                        storage.set(Number(key), value);
                    },
                    delete: (key) => {
                        memory.delete(key);
                        storage.delete(Number(key));
                    },
                },
            }));
        },
    };
}

runSharedSuite({
    name: "grammY 1.x",
    createBot(): SuiteHarness {
        const calls: {
            method: string;
            payload: Record<string, unknown>;
        }[] = [];
        const bot = new Bot<MyContext>("42:dummy-token", { botInfo });
        // grammY 1.x copies the transformers of `bot.api` onto `ctx.api` when
        // it builds the context, so this intercepts `ctx.reply` as well.
        bot.api.config.use((_prev, method, payload) => {
            calls.push({
                method,
                payload: payload as unknown as Record<string, unknown>,
            });
            return Promise.resolve({ ok: true, result: true } as never);
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
        return asContext(ctx).reply(text);
    },
    matched(ctx) {
        // grammY 1.x reports string matches through `ctx.match`.
        return asContext(ctx).match;
    },
});
