import { Api, Bot, Context } from "@grammyjs/grammy";
import type { Update } from "@grammyjs/grammy/types";
import { expect } from "@std/expect";
import { I18next, type I18nextFlavor } from "../src/mod.ts";
import { botInfo, messageUpdate, resources } from "./helpers.ts";

type MyContext = I18nextFlavor<Context>;

// Note: grammY 2.0 intentionally made `bot.api` and `ctx.api` independent
// (grammY commit 27dadcf5, "BREAKING: installing a plugin on `bot.api` no
// longer affects `ctx.api` calls"), so stubbing `bot.api` cannot intercept
// `ctx.send`. Instead, we run the bot's composed middleware with our own
// context whose `Api` records outgoing calls—this still covers the full
// middleware chain.
function makeRunner(bot: Bot<MyContext>): {
    handle: (update: Update) => Promise<void>;
    sent: Record<string, unknown>[];
} {
    const sent: Record<string, unknown>[] = [];
    return {
        sent,
        handle: async (update) => {
            const api = new Api("42:dummy-token");
            api.transform((_prev, data) => {
                sent.push({ method: data.method, ...data.payload });
                return Promise.resolve({ ok: true, result: true } as never);
            });
            const ctx = new Context(update, api, botInfo) as MyContext;
            await bot.middleware()(ctx, () => Promise.resolve());
        },
    };
}

Deno.test("translated replies flow through ctx.send end-to-end", async () => {
    const bot = new Bot<MyContext>("42:dummy-token", { me: botInfo });
    const i18n = new I18next({
        initOptions: { fallbackLng: "en", resources },
    });

    bot.use(i18n);
    bot.on("message", async (ctx) => {
        await ctx.send(ctx.t("greeting"));
    });

    const { handle, sent } = makeRunner(bot);
    await handle(messageUpdate("hi", "de"));
    await handle(messageUpdate("hi"));

    expect(sent).toEqual([
        { method: "sendMessage", chat_id: 1234, text: "Hallo" },
        { method: "sendMessage", chat_id: 1234, text: "Hello" },
    ]);
});

Deno.test("hears predicate works with bot.filter", async () => {
    const bot = new Bot<MyContext>("42:dummy-token", { me: botInfo });
    const i18n = new I18next({
        initOptions: { fallbackLng: "en", resources },
    });

    bot.use(i18n);
    bot.filter(i18n.hears("button.report"), async (ctx) => {
        await ctx.send(ctx.t("greeting"));
    });

    const { handle, sent } = makeRunner(bot);
    // An English user presses a button that was rendered in German.
    await handle(messageUpdate("Melden"));
    await handle(messageUpdate("unrelated"));

    expect(sent).toEqual([
        { method: "sendMessage", chat_id: 1234, text: "Hello" },
    ]);
});
