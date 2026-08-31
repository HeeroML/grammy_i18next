/**
 * grammY 1 with session-backed locales.
 *
 * ```sh
 * BOT_TOKEN=... deno run --allow-net --allow-read --allow-env example/grammy-v1/bot.ts
 * ```
 *
 * In your own bot, import from `@heeroml/grammy-i18next/v1` and
 * `@heeroml/grammy-i18next/loader`. Everything except the entrypoint and
 * `ctx.reply` (`ctx.send` on grammY 2) is identical to the grammY 2 example.
 */
import { Bot, type Context, session, type SessionFlavor } from "grammy";
import { fileURLToPath } from "node:url";
import {
    I18next,
    type I18nextFlavor,
    sessionLocaleStore,
} from "../../src/v1/mod.ts";
import { loadLocales } from "../../src/loader/mod.ts";

/** `__language_code` is the key `@grammyjs/i18n` used, and the default here. */
interface SessionData {
    __language_code?: string;
}

type MyContext = I18nextFlavor<Context & SessionFlavor<SessionData>>;

const i18n = new I18next<MyContext>({
    initOptions: {
        fallbackLng: "en",
        defaultNS: "main",
        // This example shares its locales with the grammY 2 one.
        resources: await loadLocales(
            fileURLToPath(new URL("../deno/locales", import.meta.url)),
        ),
    },
    localeStore: sessionLocaleStore(),
});

const bot = new Bot<MyContext>(Deno.env.get("BOT_TOKEN") ?? "");

// The session middleware must run before the plugin, so that the locale store
// finds `ctx.session`.
bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(i18n);

bot.command("start", async (ctx) => {
    await ctx.reply(
        ctx.t("greeting", { name: ctx.from?.first_name ?? "stranger" }),
    );
});

// Persist the language in the session: /language de
bot.command("language", async (ctx) => {
    const locale = ctx.match.trim();
    if (locale === "") {
        await ctx.reply(ctx.t("language.usage"));
        return;
    }
    await ctx.i18n.setLocale(locale);
    await ctx.reply(ctx.t("language.changed"));
});

bot.on("message:text", async (ctx) => {
    await ctx.reply(ctx.t("echo", { text: ctx.message.text }));
});

bot.start();
