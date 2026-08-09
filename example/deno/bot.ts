import { Bot, type Context } from "@grammyjs/grammy";
import { fileURLToPath } from "node:url";
import { I18next, type I18nextFlavor, loadLocales } from "../../src/mod.ts";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next({
    initOptions: {
        fallbackLng: "en",
        defaultNS: "main",
        resources: await loadLocales(
            fileURLToPath(new URL("./locales", import.meta.url)),
        ),
    },
});

const bot = new Bot<MyContext>(Deno.env.get("BOT_TOKEN") ?? "");

bot.use(i18n);

bot.command("start", async (ctx) => {
    await ctx.send(
        ctx.t("greeting", { name: ctx.from?.first_name ?? "stranger" }),
    );
});

// Switch the language for the rest of this update: /language de
bot.command("language", async (ctx) => {
    const locale = ctx.args?.trim();
    if (locale === undefined || locale === "") {
        await ctx.send(ctx.t("language.usage"));
        return;
    }
    // With a configured `localeStore`, use `ctx.i18n.setLocale(locale)`
    // instead to persist the choice across updates.
    await ctx.i18n.useLocale(locale);
    await ctx.send(ctx.t("language.changed"));
});

bot.on("message:text", async (ctx) => {
    await ctx.send(ctx.t("echo", { text: ctx.message.text }));
});

bot.start();
