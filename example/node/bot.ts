import { Bot, type Context } from "@grammyjs/grammy";
import {
    I18next,
    type I18nextFlavor,
    loadLocales,
} from "@placeholder/grammy-i18next";
import { fileURLToPath } from "node:url";
import process from "node:process";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next({
    initOptions: {
        fallbackLng: "en",
        defaultNS: "main",
        resources: await loadLocales(
            // The example shares its locales with the Deno example.
            fileURLToPath(new URL("../deno/locales", import.meta.url)),
        ),
    },
});

const bot = new Bot<MyContext>(process.env.BOT_TOKEN ?? "");

bot.use(i18n);

bot.command("start", async (ctx) => {
    await ctx.send(
        ctx.t("greeting", { name: ctx.from?.first_name ?? "stranger" }),
    );
});

bot.on("message:text", async (ctx) => {
    await ctx.send(ctx.t("echo", { text: ctx.message.text }));
});

bot.start();
