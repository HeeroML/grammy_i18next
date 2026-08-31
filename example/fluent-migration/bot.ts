/**
 * Fluent compatibility mode: a bot that keeps its `.ftl` files.
 *
 * ```sh
 * BOT_TOKEN=... deno run --allow-net --allow-read --allow-env example/fluent-migration/bot.ts
 * ```
 *
 * This is what a `@grammyjs/i18n` bot looks like after the move: the same
 * locales directory, the same `ctx.t` / `ctx.i18n` calls, and `compat: true`
 * so that missing messages still render as `{key}`. In your own bot, import
 * from `@heeroml/grammy-i18next`, `@heeroml/grammy-i18next/fluent`, and
 * `@heeroml/grammy-i18next/loader`.
 */
import { Bot, type Context, Keyboard } from "@grammyjs/grammy";
import { fileURLToPath } from "node:url";
import { I18n, type I18nFlavor, type LocaleStore } from "../../src/v2/mod.ts";
import { createFluentI18next } from "../../src/fluent/mod.ts";
import { loadFluentLocales } from "../../src/loader/mod.ts";

type MyContext = I18nFlavor<Context>;

/**
 * grammY 2 has no session plugin yet, so this stands in for one. Any storage
 * works—the point of `LocaleStore` is that the locale can live wherever your
 * product already keeps it.
 */
const locales = new Map<number, string>();
const localeStore: LocaleStore<MyContext> = {
    read: (ctx) => locales.get(ctx.from?.id ?? 0),
    write: (ctx, locale) => {
        locales.set(ctx.from?.id ?? 0, locale);
    },
};

const i18n = new I18n<MyContext>({
    i18next: await createFluentI18next({
        defaultLocale: "en",
        resources: await loadFluentLocales(
            fileURLToPath(new URL("./locales", import.meta.url)),
        ),
        // Reproduces the output conventions of @grammyjs/i18n 1.x.
        compat: true,
        // FSI/PDI isolation marks are invisible in Telegram, but they show up
        // in string comparisons. Fluent's default (and this plugin's) is true.
        bundleOptions: { useIsolating: true },
    }),
    localeStore,
    supportedLocales: ["en", "de"],
});

const bot = new Bot<MyContext>(Deno.env.get("BOT_TOKEN") ?? "");

bot.use(i18n);

bot.command("start", async (ctx) => {
    await ctx.send({
        text: ctx.t("greeting", { name: ctx.from?.first_name ?? "stranger" }),
        reply_markup: new Keyboard()
            .text(ctx.t("settings-button"))
            .resized(),
    });
});

// Persist the language: /language de
bot.command("language", async (ctx) => {
    const locale = ctx.args.trim();
    if (locale === "") {
        await ctx.send(ctx.t("language-usage"));
        return;
    }
    await ctx.i18n.setLocale(locale);
    await ctx.send(ctx.t("language-changed"));
});

// The keyboard above may have been rendered before the user switched
// languages, so the default "all-locales" mode matches the button in every
// supported locale. `{ mode: "current-locale" }` is the behaviour of the
// standalone `hears` of @grammyjs/i18n.
bot.filter(i18n.hears("settings-button"), async (ctx) => {
    await ctx.send(ctx.t("settings-opened"));
});

bot.on("message:text", async (ctx) => {
    await ctx.send(ctx.t("emails", { count: ctx.message.text.length }));
});

bot.start();
