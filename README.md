# grammY i18next

Internationalization for [grammY](https://grammy.dev) **2.0**, powered by [i18next](https://www.i18next.com).

This plugin connects a shared i18next instance to your bot's middleware tree. For every update, it resolves the user's locale and installs a translation function bound to that locale as `ctx.t`, plus locale controls as `ctx.i18n`. Everything i18next can do—interpolation, plurals via `Intl.PluralRules`, namespaces, fallback languages, formatters, backends, typed translation keys—works exactly as documented by i18next, because the plugin wraps i18next instead of reimplementing it.

> **Status:** targets `@grammyjs/grammy@2.0.0-beta.x` and is published as a prerelease (`2.0.0-beta.x`) on [JSR](https://jsr.io/@heeroml/grammy-i18next). grammY 2.0 is not released yet; this plugin follows the [plugin migration guidance](https://github.com/grammyjs/grammY/issues/709) (transformative context flavors, core-aligned tooling), and a stable version will land together with grammY 2.0. Should the grammY organization adopt this plugin, it will be republished under their scope and this package will be archived with a final version that re-exports the new one—migrating will be a one-line import change.

## Quick start

```ts
import { Bot, type Context } from "@grammyjs/grammy";
import {
    I18next,
    type I18nextFlavor,
    loadLocales,
} from "@heeroml/grammy-i18next";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next({
    initOptions: {
        fallbackLng: "en",
        resources: await loadLocales("./locales"),
    },
});

const bot = new Bot<MyContext>("<token>");
bot.use(i18n);

bot.command("start", async (ctx) => {
    await ctx.send(ctx.t("greeting", { name: ctx.from?.first_name }));
});

bot.start();
```

With a locales directory like this:

```txt
locales/
├── en/
│   └── translation.json    → { "greeting": "Hello, {{name}}!" }
└── de/
    └── translation.json    → { "greeting": "Hallo, {{name}}!" }
```

A runnable bot lives in [`example/deno`](./example/deno/bot.ts), and the same code for Node.js in [`example/node`](./example/node/bot.ts).

## Installation

The plugin runs on Deno, Node.js, and Bun. i18next itself is fully runtime-agnostic (it is published on [JSR](https://jsr.io/@i18next/i18next) and [npm](https://www.npmjs.com/package/i18next) with zero dependencies).

```sh
deno add jsr:@heeroml/grammy-i18next
npx  jsr add @heeroml/grammy-i18next
bunx jsr add @heeroml/grammy-i18next
```

## Two ways to provide translations

**Let the plugin create the i18next instance** (shown above): pass [`initOptions`](https://www.i18next.com/overview/configuration-options) and the plugin creates an isolated instance via `createInstance` and initializes it lazily before the first update.

**Bring your own instance**: initialize i18next yourself—with any plugins, backends, formatters, or post-processors—and hand it over:

```ts
import i18next from "i18next";
import ICU from "i18next-icu";

const instance = i18next.createInstance().use(ICU);
await instance.init({ fallbackLng: "en", resources });

const i18n = new I18next({ i18next: instance });
```

If the passed instance is not initialized yet, the plugin awaits its initialization before handling the first update.

## How the locale is resolved

For each update, the first of these that yields a locale wins:

1. **Locale store** (`localeStore` option): a persisted locale for this user, if you configured a store.
2. **Locale negotiator** (`localeNegotiator` option): defaults to reading `ctx.from?.language_code` from the update.
3. **Default locale** (`defaultLocale` option): defaults to the first configured `fallbackLng`.

The resolved locale only affects the current update. The plugin never calls `changeLanguage()` on the shared instance—every update gets its own translation function via `getFixedT`, so concurrently processed updates cannot leak locales into each other.

### Changing the locale from a handler

```ts
bot.command("language", async (ctx) => {
    await ctx.i18n.useLocale("de"); // this update only
    await ctx.i18n.setLocale("de"); // + persist via the locale store
    await ctx.i18n.renegotiate(); // re-run the negotiator
    ctx.i18n.getLocale(); // the locale currently in use
});
```

### Persisting locales

Implement the two-method `LocaleStore` interface with any storage you like:

```ts
const i18n = new I18next({
    initOptions: { fallbackLng: "en", resources },
    localeStore: {
        read: (ctx) => db.getLocale(ctx.from?.id),
        write: (ctx, locale) => db.setLocale(ctx.from?.id, locale),
    },
});
```

## Typed translation keys

Because `ctx.t` is a real i18next `TFunction`, i18next's standard [TypeScript setup](https://www.i18next.com/overview/typescript) gives you fully typed keys and interpolation variables:

```ts
// i18next.d.ts
import type enMain from "./locales/en/main.json";

declare module "i18next" {
    interface CustomTypeOptions {
        defaultNS: "main";
        resources: { main: typeof enMain };
    }
}
```

Now `ctx.t("greetin")` is a compile-time error, and `ctx.t("greeting", { name: ... })` knows its variables. No code generation or plugin-specific tooling required.

## Matching translated text (`hears`)

When you send localized keyboards, the button presses come back as plain localized text. Use the `hears` predicate with `bot.filter` to match a message key instead of hard-coding every translation:

```ts
bot.filter(i18n.hears("menu.settings"), async (ctx) => {
    // The user pressed the "Settings" button—in whatever language
    // the keyboard was rendered in.
});
```

By default this matches the key's translation in **all** registered locales, because the keyboard may have been rendered before the user switched languages. Pass `{ mode: "current-locale" }` to only match the locale of the current update.

## Loading translations from disk

`loadLocales(directory)` reads JSON files into an i18next `resources` object without needing a file-system backend plugin. It works on Deno, Node.js, and Bun (it uses `node:fs`). Both layouts are supported:

```txt
locales/
├── en/               ← directory per locale
│   ├── main.json     ← one file per namespace ("main")
│   └── errors/
│       └── api.json  ← nested directories join with "/" ("errors/api")
└── pt-BR.json        ← or a flat file per locale (namespace "translation")
```

For lazy loading, caching, or remote sources, use any i18next backend plugin with a self-managed instance instead. The plugin detects attached backends and loads the resources of each negotiated locale on demand (via `loadLanguages`) before binding `ctx.t`, so lazily loaded locales work out of the box.

## Translating outside of handlers

For broadcasts and other work without a context object:

```ts
await i18n.ready();
const text = i18n.t("de", "greeting", { name: "Heero" });
```

## A note on HTML escaping

i18next escapes interpolated values by default (`interpolation.escapeValue: true`): `{{name}}` with the value `<b>` becomes `&lt;b&gt;`. This is exactly right when you send messages with `parse_mode: "HTML"`, but surprising when you send plain text. If you never use HTML parse mode, disable it:

```ts
initOptions: {
    interpolation: { escapeValue: false },
}
```

## Debug logging

The plugin logs through [`@grammyjs/debug`](https://jsr.io/@grammyjs/debug) under the `grammy:i18next` namespace:

```sh
DEBUG=grammy:i18next deno run -A bot.ts
```

## Coming from `@grammyjs/i18n` or `telegraf-i18n`?

- Translations are JSON (or anything an i18next backend can load), not Fluent `.ftl` files. Variables are `{{name}}` instead of `{ $name }`; plurals use i18next's `_one`/`_other` key suffixes.
- `ctx.t` works the same way; the locale controls live on `ctx.i18n` (`getLocale`/`useLocale`/`setLocale`/`renegotiate`).
- Session-based locale storage is replaced by the storage-agnostic `LocaleStore` interface (a grammY 2.0 session plugin does not exist yet).
- Typed keys come from i18next's own `CustomTypeOptions` instead of a CLI code generator.

## License

MIT
