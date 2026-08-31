/**
 * grammY 2 on Node.js.
 *
 * ```sh
 * cd example/node
 * npm install   # resolves the JSR packages through https://npm.jsr.io
 * BOT_TOKEN=... npm start
 * ```
 *
 * Node 24 runs the TypeScript source directly via type stripping; on Node 22
 * add `--experimental-strip-types`.
 */
import { Bot, type Context } from "@grammyjs/grammy";
import { I18next, type I18nextFlavor } from "@heeroml/grammy-i18next";
import { loadLocales } from "@heeroml/grammy-i18next/loader";
import { fileURLToPath } from "node:url";
import process from "node:process";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next<MyContext>({
    initOptions: {
        fallbackLng: "en",
        defaultNS: "main",
        resources: await loadLocales(
            // This example shares its locales with the Deno one.
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
