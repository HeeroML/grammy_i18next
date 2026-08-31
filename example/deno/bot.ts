/**
 * grammY 2 on Deno.
 *
 * Run it with the plugin's sources straight from this repository:
 *
 * ```sh
 * BOT_TOKEN=... deno run --allow-net --allow-read --allow-env example/deno/bot.ts
 * ```
 *
 * In your own bot, replace the relative imports with
 * `@heeroml/grammy-i18next` and `@heeroml/grammy-i18next/loader`.
 */
import { Bot, type Context } from "@grammyjs/grammy";
import { fileURLToPath } from "node:url";
import { I18next, type I18nextFlavor } from "../../src/mod.ts";
import { loadLocales } from "../../src/loader/mod.ts";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next<MyContext>({
    initOptions: {
        fallbackLng: "en",
        defaultNS: "main",
        // `loadLocales` is the only part of the package that touches the file
        // system, which is why it lives in its own entrypoint.
        resources: await loadLocales(
            fileURLToPath(new URL("./locales", import.meta.url)),
        ),
    },
});

const bot = new Bot<MyContext>(Deno.env.get("BOT_TOKEN") ?? "");

// Install the plugin before anything that uses `ctx.t` or `ctx.i18n`.
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
