/**
 * grammY 2 end-to-end smoke test.
 *
 * Runs a real `Bot` from `@grammyjs/grammy` through `bot.handleUpdate` with a
 * fabricated update. grammY 2 no longer copies `bot.api` transformers onto
 * `ctx.api`, so the outgoing call is intercepted from a first middleware via
 * `ctx.api.transform`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Bot } from "@grammyjs/grammy";
import type { Context } from "@grammyjs/grammy";
import type { Update, UserFromGetMe } from "@grammyjs/grammy/types";
import { I18next } from "../src/v2/mod.ts";
import type { I18nextFlavor } from "../src/v2/mod.ts";
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
    const bot = new Bot<Ctx>(TOKEN, { me: botInfo as UserFromGetMe });
    bot.use((ctx, next) => {
        const record = (
            _prev: unknown,
            data: { method: string; payload: Record<string, unknown> },
        ) => {
            calls.push({ method: data.method, payload: data.payload });
            return Promise.resolve(stubResponse());
        };
        ctx.api.transform(
            record as unknown as Parameters<typeof ctx.api.transform>[0],
        );
        return next();
    });
    return { bot, calls };
}

function makePlugin(): I18next<Ctx> {
    return new I18next<Ctx>({ initOptions: { fallbackLng: "en", resources } });
}

function update(text: string, languageCode?: string): Update {
    return messageUpdate(text, languageCode) as unknown as Update;
}

test("grammY 2: negotiated locale translates the outgoing message", async () => {
    const { bot, calls } = makeBot();
    bot.use(makePlugin().middleware());
    bot.on("message", (ctx) => ctx.sendMessage(ctx.t("greeting")));

    await bot.handleUpdate(update("hi", "de"));
    await bot.handleUpdate(update("hi"));

    assert.deepEqual(calls.map((c) => c.method), [
        "sendMessage",
        "sendMessage",
    ]);
    assert.equal(calls[0].payload.text, "Hallo");
    assert.equal(calls[1].payload.text, "Hello");
});

test("grammY 2: ctx.t and ctx.translate are the same bound function", async () => {
    const { bot } = makeBot();
    bot.use(makePlugin().middleware());
    let seen: { same: boolean; locale: string } | undefined;
    bot.on("message", (ctx) => {
        seen = { same: ctx.t === ctx.translate, locale: ctx.i18n.getLocale() };
    });

    await bot.handleUpdate(update("hi", "de"));

    assert.deepEqual(seen, { same: true, locale: "de" });
});

test("grammY 2: ctx.i18n.useLocale rebinds ctx.t for the rest of the update", async () => {
    const { bot, calls } = makeBot();
    bot.use(makePlugin().middleware());
    bot.on("message", async (ctx) => {
        await ctx.i18n.useLocale("de");
        await ctx.sendMessage(ctx.t("greeting"));
    });

    await bot.handleUpdate(update("hi"));

    assert.equal(calls[0].payload.text, "Hallo");
});

test("grammY 2: hears matches a localized button in every locale", async () => {
    const { bot, calls } = makeBot();
    const plugin = makePlugin();
    bot.use(plugin.middleware());
    // Default mode is "all-locales": the German button text matches even
    // though this update negotiates to the fallback locale.
    bot.filter(plugin.hears("report"), (ctx) => ctx.sendMessage("matched"));

    await bot.handleUpdate(update("Melden"));
    await bot.handleUpdate(update("Report"));
    await bot.handleUpdate(update("something else"));

    assert.equal(calls.length, 2);
});

test("grammY 2: plugin-level t() and locales work without an update", async () => {
    const plugin = makePlugin();
    await plugin.ready();

    assert.equal(plugin.t("de", "greeting"), "Hallo");
    assert.equal(plugin.t("en", "items", { count: 2 }), "2 items");
    assert.deepEqual([...plugin.locales].sort(), ["de", "en"]);
});
