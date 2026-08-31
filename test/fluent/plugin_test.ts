import { expect } from "@std/expect";
import { Bot } from "@grammyjs/grammy";
import type { Context } from "@grammyjs/grammy";
import type { Update, UserFromGetMe } from "@grammyjs/grammy/types";
import { I18next } from "../../src/v2/mod.ts";
import type { I18nextFlavor } from "../../src/v2/mod.ts";
import { createFluentI18next } from "../../src/fluent/mod.ts";

const FSI = "⁨";
const PDI = "⁩";

const EN = `
greeting = Hello, { $name }!
menu-btn = Menu
emails = { $count ->
    [one] one email
   *[other] { $count } emails
  }
`;

const DE = `
greeting = Hallo, { $name }!
menu-btn = Menü
emails = { $count ->
    [one] eine E-Mail
   *[other] { $count } E-Mails
  }
`;

const botInfo: UserFromGetMe = {
    id: 42,
    is_bot: true,
    first_name: "Test Bot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    supports_guest_queries: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
};

let nextId = 0;

function messageUpdate(text: string, languageCode?: string): Update {
    nextId++;
    return {
        update_id: nextId,
        message: {
            message_id: nextId,
            date: 1_691_500_000,
            chat: { id: 1234, type: "private", first_name: "Test" },
            from: {
                id: 1234,
                is_bot: false,
                first_name: "Test",
                ...(languageCode === undefined
                    ? {}
                    : { language_code: languageCode }),
            },
            text,
        },
    };
}

type FluentContext = I18nextFlavor<Context>;

/**
 * Builds a bot whose outgoing `sendMessage` texts are captured instead of
 * being sent. grammY 2 no longer copies `bot.api` transformers onto
 * `ctx.api`, so the transformer is installed from a first middleware.
 */
async function makeBot(
    plugin: I18next<Context>,
): Promise<{ bot: Bot<FluentContext>; sent: string[] }> {
    const sent: string[] = [];
    const bot = new Bot<FluentContext>("42:dummy-token", { me: botInfo });
    const intercepted = new WeakSet<object>();
    bot.use((ctx, next) => {
        // grammY 2 no longer copies `bot.api` transformers onto `ctx.api`, so
        // the interceptor is installed from the first middleware. `ctx.api`
        // may be the shared bot API, hence the once-per-instance guard.
        if (!intercepted.has(ctx.api)) {
            intercepted.add(ctx.api);
            ctx.api.transform((_prev, data) => {
                if (data.method === "sendMessage") {
                    sent.push((data.payload as { text: string }).text);
                }
                return Promise.resolve({ ok: true, result: true } as never);
            });
        }
        return next();
    });
    bot.use(plugin);
    await bot.init();
    return { bot, sent };
}

async function makePlugin(): Promise<I18next<Context>> {
    return new I18next<Context>({
        i18next: await createFluentI18next({
            defaultLocale: "en",
            resources: { en: EN, de: DE },
            onError: () => {},
        }),
    });
}

Deno.test("ctx.t formats Fluent messages for the user's locale", async () => {
    const plugin = await makePlugin();
    const { bot, sent } = await makeBot(plugin);
    bot.on("message", (ctx) =>
        ctx.send(ctx.t("greeting", {
            name: "Jane",
        })));
    await bot.handleUpdate(messageUpdate("hi", "de"));
    await bot.handleUpdate(messageUpdate("hi", "en"));
    expect(sent).toEqual([
        `Hallo, ${FSI}Jane${PDI}!`,
        `Hello, ${FSI}Jane${PDI}!`,
    ]);
});

Deno.test("ctx.translate is the same bound function as ctx.t", async () => {
    const plugin = await makePlugin();
    const { bot, sent } = await makeBot(plugin);
    bot.on("message", (ctx) => {
        expect(ctx.t).toBe(ctx.translate);
        return ctx.send(ctx.translate("greeting", { name: "Ada" }));
    });
    await bot.handleUpdate(messageUpdate("hi", "de-DE"));
    expect(sent).toEqual([`Hallo, ${FSI}Ada${PDI}!`]);
});

Deno.test("ctx.i18n.useLocale rebinds the translator", async () => {
    const plugin = await makePlugin();
    const { bot, sent } = await makeBot(plugin);
    bot.on("message", async (ctx) => {
        expect(ctx.i18n.getLocale()).toBe("en");
        await ctx.i18n.useLocale("de");
        expect(ctx.i18n.getLocale()).toBe("de");
        await ctx.send(ctx.t("greeting", { name: "Bob" }));
    });
    await bot.handleUpdate(messageUpdate("hi", "en"));
    expect(sent).toEqual([`Hallo, ${FSI}Bob${PDI}!`]);
});

Deno.test("i18n.hears matches all locales by default", async () => {
    const plugin = await makePlugin();
    const { bot, sent } = await makeBot(plugin);
    bot.filter(plugin.hears("menu-btn"), (ctx) => ctx.send("matched"));
    bot.on("message", (ctx) => ctx.send("no match"));
    await plugin.ready();
    await bot.handleUpdate(messageUpdate("Menu", "de"));
    await bot.handleUpdate(messageUpdate("Menü", "en"));
    await bot.handleUpdate(messageUpdate("nope", "en"));
    expect(sent).toEqual(["matched", "matched", "no match"]);
});

Deno.test("plural selection runs through Fluent's own count variable", async () => {
    const plugin = await makePlugin();
    const { bot, sent } = await makeBot(plugin);
    bot.on(
        "message",
        (ctx) => ctx.send(ctx.t("emails", { count: Number(ctx.message.text) })),
    );
    await bot.handleUpdate(messageUpdate("1", "en"));
    await bot.handleUpdate(messageUpdate("4", "en"));
    await bot.handleUpdate(messageUpdate("1", "de"));
    await bot.handleUpdate(messageUpdate("4", "de"));
    expect(sent).toEqual([
        "one email",
        `${FSI}4${PDI} emails`,
        "eine E-Mail",
        `${FSI}4${PDI} E-Mails`,
    ]);
});
