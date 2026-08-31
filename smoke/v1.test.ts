/**
 * grammY 1 end-to-end smoke test.
 *
 * Mirrors `v2.test.ts` against the other major: a real `Bot` from `grammy`,
 * configured with `{ botInfo }` instead of `{ me }`, intercepted through
 * `bot.api.config.use` (grammY 1 copies `bot.api` transformers onto
 * `ctx.api`), replying with `ctx.reply` instead of `ctx.sendMessage`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Bot } from "grammy";
import type { Context } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { I18next } from "../src/v1/mod.ts";
import type { I18nextFlavor } from "../src/v1/mod.ts";
import {
    type ApiCall,
    botInfo,
    messageUpdate,
    resources,
    stubResponse,
} from "./support.ts";

type Ctx = I18nextFlavor<Context>;

const TOKEN = "1234:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makeBot(): { bot: Bot<Ctx>; calls: ApiCall[] } {
    const calls: ApiCall[] = [];
    const bot = new Bot<Ctx>(TOKEN, { botInfo: botInfo as UserFromGetMe });
    const record = (
        _prev: unknown,
        method: string,
        payload: Record<string, unknown>,
    ) => {
        calls.push({ method, payload });
        return Promise.resolve(stubResponse());
    };
    bot.api.config.use(
        record as unknown as Parameters<typeof bot.api.config.use>[0],
    );
    return { bot, calls };
}

function makePlugin(): I18next<Ctx> {
    return new I18next<Ctx>({ initOptions: { fallbackLng: "en", resources } });
}

function update(text: string, languageCode?: string): Update {
    return messageUpdate(text, languageCode) as unknown as Update;
}

test("grammY 1: negotiated locale translates the outgoing message", async () => {
    const { bot, calls } = makeBot();
    bot.use(makePlugin().middleware());
    bot.on("message", (ctx) => ctx.reply(ctx.t("greeting")));

    await bot.handleUpdate(update("hi", "de"));
    await bot.handleUpdate(update("hi"));

    assert.deepEqual(calls.map((c) => c.method), [
        "sendMessage",
        "sendMessage",
    ]);
    assert.equal(calls[0].payload.text, "Hallo");
    assert.equal(calls[1].payload.text, "Hello");
});

test("grammY 1: ctx.t and ctx.translate are the same bound function", async () => {
    const { bot } = makeBot();
    bot.use(makePlugin().middleware());
    let seen: { same: boolean; locale: string } | undefined;
    bot.on("message", (ctx) => {
        seen = { same: ctx.t === ctx.translate, locale: ctx.i18n.getLocale() };
    });

    await bot.handleUpdate(update("hi", "de"));

    assert.deepEqual(seen, { same: true, locale: "de" });
});

test("grammY 1: ctx.i18n.useLocale rebinds ctx.t for the rest of the update", async () => {
    const { bot, calls } = makeBot();
    bot.use(makePlugin().middleware());
    bot.on("message", async (ctx) => {
        await ctx.i18n.useLocale("de");
        await ctx.reply(ctx.t("greeting"));
    });

    await bot.handleUpdate(update("hi"));

    assert.equal(calls[0].payload.text, "Hallo");
});

test("grammY 1: hears matches a localized button in every locale", async () => {
    const { bot, calls } = makeBot();
    const plugin = makePlugin();
    bot.use(plugin.middleware());
    bot.filter(plugin.hears("report"), (ctx) => ctx.reply("matched"));

    await bot.handleUpdate(update("Melden"));
    await bot.handleUpdate(update("Report"));
    await bot.handleUpdate(update("something else"));

    assert.equal(calls.length, 2);
});
