# grammY i18next

Internationalization for [grammY](https://grammy.dev), powered by [i18next](https://www.i18next.com).

For every update, this plugin resolves the user's locale and installs a translation function bound to that locale as `ctx.t` (and `ctx.translate`), plus locale controls as `ctx.i18n`. Everything i18next can do works exactly as its own documentation describes, because the plugin wraps i18next instead of reimplementing it: interpolation, plurals via `Intl.PluralRules`, namespaces, fallback languages, formatters, backends, post-processors, typed translation keys.

There is one implementation and one entrypoint per grammY major. All behaviour lives in a version-independent core that needs nothing from a context object but `ctx.from?.language_code` and `ctx.hasText()`. `./v1` and `./v2` add only the `Context`, `MiddlewareObj`, and `HearsContext` types of the major you installed. Neither entrypoint imports grammY at runtime, only as types.

> Status: beta. This package tracks the grammY 2.0 betas (`@grammyjs/grammy@2.0.0-beta.x`) and follows the [plugin migration guidance](https://github.com/grammyjs/grammY/issues/709) for grammY 2 (transformative context flavors, no custom context classes). A stable release will land together with grammY 2.0. Should the grammY organization adopt this plugin, it will be republished under their scope and this package archived with a final version that re-exports the new one.

The root export is the grammY 2 entrypoint (`.` and `./v2` are literally the same module). I kept it that way because the only published version of this package targeted grammY 2, and the package major tracks grammY 2. For grammY 1.x, import from `@heeroml/grammy-i18next/v1`. The plugin, its options, and its behaviour are identical there.

## Documentation

This README covers the core usage and the migration in short. The rest lives in three documents:

- [Advanced usage](https://github.com/HeeroML/grammy_i18next/blob/main/docs/advanced.md): backends and lazy loading, namespaces, loading files from disk, entrypoints and runtimes, typed keys, what the middleware does, concurrency, debug logging, HTML escaping.
- [Fluent compatibility mode](https://github.com/HeeroML/grammy_i18next/blob/main/docs/fluent.md): the full `/fluent` documentation, its options, and how it works.
- [Migrating from `@grammyjs/i18n`](https://github.com/HeeroML/grammy_i18next/blob/main/docs/migration.md): the full migration guide, the API differences, and the differential test guarantees.

## Installation

The package is published on [JSR](https://jsr.io/@heeroml/grammy-i18next).

```sh
deno add jsr:@heeroml/grammy-i18next
pnpm dlx jsr add @heeroml/grammy-i18next
npx jsr add @heeroml/grammy-i18next
```

For npm-compatible package managers, JSR recommends pnpm over npm and Yarn, because those install a separate copy of a JSR package for every dependent.

Bun needs the exact version as long as this package has only prerelease versions:

```sh
bun add @heeroml/grammy-i18next@npm:@jsr/heeroml__grammy-i18next@2.0.0-beta.1
```

i18next itself is runtime-agnostic and dependency-free; it is published on [npm](https://www.npmjs.com/package/i18next) and mirrored on [JSR](https://jsr.io/@i18next/i18next).

## Quick start

### grammY 2

```ts
import { Bot, type Context } from "@grammyjs/grammy";
import { I18next, type I18nextFlavor } from "@heeroml/grammy-i18next";
import { loadLocales } from "@heeroml/grammy-i18next/loader";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next<MyContext>({
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

`@heeroml/grammy-i18next` and `@heeroml/grammy-i18next/v2` are the same module; importing `/v2` explicitly makes it obvious which grammY major a file is written against.

### grammY 1

```ts
import { Bot, type Context } from "grammy";
import { I18next, type I18nextFlavor } from "@heeroml/grammy-i18next/v1";
import { loadLocales } from "@heeroml/grammy-i18next/loader";

type MyContext = I18nextFlavor<Context>;

const i18n = new I18next<MyContext>({
    initOptions: {
        fallbackLng: "en",
        resources: await loadLocales("./locales"),
    },
});

const bot = new Bot<MyContext>("<token>");
bot.use(i18n);

bot.command("start", async (ctx) => {
    await ctx.reply(ctx.t("greeting", { name: ctx.from?.first_name }));
});

bot.start();
```

Both quick starts assume a locales directory like this:

```txt
locales/
├── en/
│   └── translation.json    → { "greeting": "Hello, {{name}}!" }
└── de/
    └── translation.json    → { "greeting": "Hallo, {{name}}!" }
```

Runnable examples: [`example/deno`](https://github.com/HeeroML/grammy_i18next/blob/main/example/deno/bot.ts) (grammY 2, Deno), [`example/node`](https://github.com/HeeroML/grammy_i18next/blob/main/example/node/bot.ts) (grammY 2, Node.js), [`example/grammy-v1`](https://github.com/HeeroML/grammy_i18next/blob/main/example/grammy-v1/bot.ts) (grammY 1 with sessions), [`example/fluent-migration`](https://github.com/HeeroML/grammy_i18next/blob/main/example/fluent-migration/bot.ts) (Fluent compatibility mode).

## Why i18next

Telegram-specific i18n libraries give your bot its own message format, its own loader, and its own locale storage. i18next is the format the rest of your product most likely already speaks: web frontends, React Native apps, backend services, e-mail templates. Using it in the bot means one set of translation files, one translation memory in your TMS, one set of formatters, and one place where a translator works.

The second half of that is the locale itself. The locale of a user is a property of the user, not of the channel they happen to be talking through. The plugin never owns that value. `localeStore` is a two-method interface over whatever storage already holds it.

```ts
const i18n = new I18next<MyContext>({
    initOptions: { fallbackLng: "en", resources },
    localeStore: {
        read: (ctx) => db.getLocale(ctx.from?.id),
        write: (ctx, locale) => db.setLocale(ctx.from?.id, locale),
    },
});
```

The same row that the web app reads for its own i18next instance now drives the bot. A user who switches the language on the website is answered in that language by the bot, and `ctx.i18n.setLocale("de")` in a handler changes the website too, without a synchronization job, because there is only one value. The same picture as a diagram is in [the advanced documentation](https://github.com/HeeroML/grammy_i18next/blob/main/docs/advanced.md#the-locale-lives-with-the-user).

## Providing translations

### Let the plugin own the instance

Pass [`initOptions`](https://www.i18next.com/overview/configuration-options) and the plugin creates an isolated instance via `createInstance()` and initializes it before the first update:

```ts
const i18n = new I18next<MyContext>({
    initOptions: { fallbackLng: "en", resources },
});
```

### Bring your own instance

Configure i18next yourself (any plugins, backends, formatters, post-processors) and hand the instance over:

```ts
import i18next from "i18next";
import ICU from "i18next-icu";

const instance = i18next.createInstance().use(ICU);
await instance.init({ fallbackLng: "en", resources });

const i18n = new I18next<MyContext>({ i18next: instance });
```

The instance does not have to be initialized. If it is not, the plugin initializes it with `initOptions` before the first update; if somebody else already started initializing it, the plugin waits for that to finish. Passing `initOptions` together with an already initialized instance is an error, because a second `init()` would rebuild all i18next services and discard loaded resources. The error surfaces on the first update, or earlier when you `await i18n.ready()`.

At least one of `i18next` and `initOptions` must be given; the constructor throws otherwise.

The advanced documentation covers the rest of the translation setup: [backends and lazy loading](https://github.com/HeeroML/grammy_i18next/blob/main/docs/advanced.md#backends-and-lazy-loading) (including what is preloaded and which failures are fatal), [namespaces](https://github.com/HeeroML/grammy_i18next/blob/main/docs/advanced.md#namespaces) via the `ns` option, [loading translation files from disk](https://github.com/HeeroML/grammy_i18next/blob/main/docs/advanced.md#loading-translation-files-from-disk) with `/loader`, and the [entrypoints and runtimes](https://github.com/HeeroML/grammy_i18next/blob/main/docs/advanced.md#entrypoints-and-runtimes) table.

## Locale resolution

For each update, the first of these that yields a locale wins:

1. The locale store (`localeStore.read`), if configured.
2. The locale negotiator (`localeNegotiator`), which defaults to reading `ctx.from?.language_code`.
3. The default locale: the `defaultLocale` option, else the first configured `fallbackLng`, else `"dev"` (which is what i18next itself falls back to).

Locale codes are normalized before use: `_` becomes `-`, then i18next's own `formatLanguageCode` canonicalizes the result. `pt_BR` and `pt-br` both become `pt-BR`.

### Controls on `ctx.i18n`

| Member                | Type              | Notes                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLocale()`         | `string`          | Synchronous, and reflects the locale in flight for this update, including changes made via `useLocale`.                                                                                                                                                                                                                                                           |
| `useLocale(locale)`   | `Promise<void>`   | Uses the locale for the rest of this update. Rebinds `ctx.t` synchronously when nothing has to be loaded, so preloaded resources work without an `await`. Still, `await` it, because a lazy backend rebinds only after loading. Rejects on an empty locale, but **not** when a backend cannot deliver the locale: it is used anyway, with i18next's own fallback. |
| `setLocale(locale)`   | `Promise<void>`   | `useLocale` plus `localeStore.write`. **If persistence fails, the locale stays in use for this update and the returned promise rejects with the store's error.**                                                                                                                                                                                                  |
| `renegotiate()`       | `Promise<string>` | Runs the negotiator again and returns the locale now in use.                                                                                                                                                                                                                                                                                                      |
| `renegotiateLocale()` | `Promise<string>` | Alias of `renegotiate()`, for `@grammyjs/i18n` compatibility.                                                                                                                                                                                                                                                                                                     |
| `instance`            | `i18n`            | The shared i18next instance. Its global language is not per-update state; inside handlers, always use `ctx.t`.                                                                                                                                                                                                                                                    |

`ctx.translate` is the same function object as `ctx.t` at any moment; `ctx.t === ctx.translate` holds after every locale change.

```ts
bot.command("language", async (ctx) => {
    await ctx.i18n.useLocale("de"); // this update only
    await ctx.i18n.setLocale("de"); // + persist via the locale store
    await ctx.i18n.renegotiate(); // re-run the negotiator
    ctx.i18n.getLocale(); // "de"
});
```

## Persisting the locale

`LocaleStore` is storage-agnostic and receives the full context type of your bot, so it can read sessions, database handles, or anything another plugin installed on the context.

### Sessions

`sessionLocaleStore()` stores the locale in `ctx.session`, under the key `__language_code`. That is the key `@grammyjs/i18n` used, so locales your users already chose carry over. Pass `{ key }` to change it. Lazy sessions are supported: a `ctx.session` that is a promise is awaited.

grammY 1:

```ts
import { Bot, type Context, session, type SessionFlavor } from "grammy";
import {
    I18next,
    type I18nextFlavor,
    sessionLocaleStore,
} from "@heeroml/grammy-i18next/v1";

type SessionData = { __language_code?: string };
type MyContext = I18nextFlavor<Context & SessionFlavor<SessionData>>;

const bot = new Bot<MyContext>("<token>");
bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(
    new I18next<MyContext>({
        initOptions: { fallbackLng: "en", resources },
        localeStore: sessionLocaleStore(),
    }),
);
```

The session middleware must run before the plugin. Otherwise `ctx.session` is not an object yet and the store throws.

grammY 2 has no session plugin yet, neither in core nor on JSR. Until it does, use any other `LocaleStore` (a database, a KV store, a cache). `sessionLocaleStore()` itself is not grammY-1-specific. It only requires a `ctx.session` object, so it also works with a session middleware of your own that runs before the plugin.

## Matching translated text (`hears`)

Localized keyboards send back plain localized text. `i18n.hears` builds a predicate for `bot.filter` that matches a key's translations instead of hard-coded strings:

```ts
bot.filter(i18n.hears("menu.settings"), async (ctx) => {
    // The user pressed the "Settings" button, in whatever language the
    // keyboard was rendered in.
});
```

```ts
i18n.hears(key, {
    mode: "all-locales", // default; or "current-locale"
    variables: { count: 3 }, // interpolated before matching
});
```

- `"all-locales"` matches the translation in every supported locale, because the keyboard may have been rendered before the user switched languages. "Supported" means the `supportedLocales` option if you set it, and otherwise the locales that currently have resources on the instance. With a lazy backend that is only what has been loaded so far, so set `supportedLocales`.
- `"current-locale"` matches only the locale negotiated for the current update.

Matching delegates to the installed grammY major's own `ctx.hasText`, so message texts and media captions both match, and the major's own match bookkeeping applies: `ctx.match` on grammY 1, `ctx.payload` on grammY 2. The predicate narrows the context type exactly like `bot.hears` does.

## Fluent compatibility mode

The `/fluent` entrypoint teaches i18next to format [Project Fluent](https://projectfluent.org) messages. It exists for migration and interop. A bot with a large `.ftl` corpus can move to this plugin without rewriting its translations first, and a project can serve FTL and JSON from two instances while it migrates. Native i18next JSON remains the primary engine of this package.

```ts
import { I18next } from "@heeroml/grammy-i18next";
import { createFluentI18next } from "@heeroml/grammy-i18next/fluent";
import { loadFluentLocales } from "@heeroml/grammy-i18next/loader";

const i18n = new I18next<MyContext>({
    i18next: await createFluentI18next({
        defaultLocale: "en",
        resources: await loadFluentLocales("./locales"),
        compat: true,
    }),
});
```

`createFluentI18next` builds an isolated, initialized i18next instance: `keySeparator` off (Fluent uses `.` to address attributes), `fallbackLng` and the initial language set to `defaultLocale`, and the Fluent format module registered before `init`. `initOptions` passes anything else through: `debug`, `supportedLngs`, `load`, `interpolation.defaultVariables`, …

For a self-managed instance, register the module yourself with `createFluentFormat(options)` and `i18next.use(...)`. That path also works with a backend. FTL text must not travel through i18next's resource store as a raw string (i18next would spread it into a per-character object), so wrap it with `fluentSource(source)`, i.e. deliver `{ ftl: "…" }` per language and namespace.

Two consequences worth knowing:

- Message and term references are bundle-local. With one namespace there is one bundle per locale and everything can reference everything. If you split namespaces, a message in one namespace cannot reference a term in another.
- Fluent handles syntax errors silently. `new FluentResource(source)` never throws; it drops the messages it cannot parse. A typo in an `.ftl` file therefore surfaces as a missing message at runtime, not as a load failure. If you need that to be an error, validate your `.ftl` files in CI with [`@fluent/syntax`](https://www.npmjs.com/package/@fluent/syntax).

The [`options` table](https://github.com/HeeroML/grammy_i18next/blob/main/docs/fluent.md#options) (`bundleOptions`, `allowOverrides`, `onError`, `compat`) and [how the format module works](https://github.com/HeeroML/grammy_i18next/blob/main/docs/fluent.md#how-it-works) are in the [Fluent documentation](https://github.com/HeeroML/grammy_i18next/blob/main/docs/fluent.md).

## Migrating from `@grammyjs/i18n`

Handler code does not change: `ctx.t`, `ctx.translate`, `ctx.i18n.getLocale()`, `ctx.i18n.useLocale()`, `ctx.i18n.setLocale()`, and `ctx.i18n.renegotiateLocale()` all exist with the same names. What changes is the setup and the flavor.

Before (grammY 1, `@grammyjs/i18n` 1.1.2):

```ts
import { Bot, type Context, session, type SessionFlavor } from "grammy";
import { hears, I18n, type I18nFlavor } from "@grammyjs/i18n";

type MyContext = Context & SessionFlavor<{}> & I18nFlavor;

const i18n = new I18n<MyContext>({
    defaultLocale: "en",
    directory: "locales",
    useSession: true,
});

const bot = new Bot<MyContext>("<token>");
bot.use(session({ initial: () => ({}) }));
bot.use(i18n);

bot.filter(hears("menu.settings"), (ctx) => ctx.reply(ctx.t("ok")));
```

After (same bot, same `.ftl` files):

```ts
import { Bot, type Context, session, type SessionFlavor } from "grammy";
import {
    I18n,
    type I18nFlavor,
    sessionLocaleStore,
} from "@heeroml/grammy-i18next/v1";
import { createFluentI18next } from "@heeroml/grammy-i18next/fluent";
import { loadFluentLocales } from "@heeroml/grammy-i18next/loader";

type MyContext = I18nFlavor<Context & SessionFlavor<{}>>;

const i18n = new I18n<MyContext>({
    i18next: await createFluentI18next({
        defaultLocale: "en",
        resources: await loadFluentLocales("locales"),
        compat: true,
    }),
    localeStore: sessionLocaleStore(),
});

const bot = new Bot<MyContext>("<token>");
bot.use(session({ initial: () => ({}) }));
bot.use(i18n);

bot.filter(
    i18n.hears("menu.settings", { mode: "current-locale" }),
    (ctx) => ctx.reply(ctx.t("ok")),
);
```

`I18n` and `I18nFlavor` are aliases of `I18next` and `I18nextFlavor`. The flavor is transformative: `I18nFlavor<Context>` instead of `Context & I18nFlavor`. `hears` moves from a standalone export to a method on the plugin instance, because it needs to know the instance's locales; `{ mode: "current-locale" }` reproduces the old behaviour.

**This is not a drop-in replacement for everything.** The differential tests define the guarantee. Anything outside them needs to be looked at, especially code that relied on `ctx.t` throwing, on `globalTranslationContext`, or on the `Fluent` class itself.

The [migration guide](https://github.com/HeeroML/grammy_i18next/blob/main/docs/migration.md) has the rest: the [surface-by-surface API differences](https://github.com/HeeroML/grammy_i18next/blob/main/docs/migration.md#api-differences) and [what the differential tests guarantee](https://github.com/HeeroML/grammy_i18next/blob/main/docs/migration.md#what-the-differential-tests-guarantee), byte-identical output and intentional differences included.

## Runtime support

Verified in CI on every push:

| Runtime                 | What runs                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Deno 2.x                | format, lint, type check, the full test suite, the smoke suite, the module-graph assertions, `deno publish --dry-run`            |
| Node.js 24 (LTS) and 26 | the smoke suite, running the TypeScript sources directly via type stripping, resolved through the JSR npm-compatibility registry |
| Bun                     | the smoke suite, installed from the same lockfile                                                                                |
| esbuild                 | browser/worker bundle check for `.`, `./v1`, `./v2`, `./fluent`; `./loader` is asserted to _not_ bundle for the browser          |

The grammY versions exercised in CI are 1.46.0 (npm) and 2.0.0-beta.8 (JSR); both are pinned in the lockfile of the Node/Bun harness.

## Limitations

- No session plugin for grammY 2. There is none in core and none on JSR yet, so grammY 2 bots need another `LocaleStore` (or their own session middleware) to persist locales.
- All-locale `hears` needs `supportedLocales` with a lazy backend. The predicate is synchronous; locales it should match must be loaded before the update arrives.
- One instance is either Fluent or JSON. The Fluent format module replaces i18next's resource lookup and interpolator for the whole instance. Mixing the two message formats means running two instances, which is fine, because `createFluentI18next` builds an isolated one.
- `keyPrefix` and `returnObjects` do not apply in Fluent mode. Fluent messages always format to a string, and the key is never split.
- `useLocale` without `await` is only safe for preloaded resources. With a lazy backend, `ctx.t` rebinds when loading finished.
- A lazily loaded locale that failed to load is not fetched again automatically. i18next stops asking the backend for a failed language/namespace pair after its own retries; `instance.reloadResources()` forces a re-read.
- This package is beta, tracking a grammY major that is itself in beta.

## License

MIT
