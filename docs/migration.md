# Migrating from `@grammyjs/i18n`

The full migration guide: the setup change, a surface-by-surface API comparison, and what the differential tests against `@grammyjs/i18n@1.1.2` guarantee.

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

## API differences

Surface-by-surface comparison with `@grammyjs/i18n` 1.1.2:

| Surface                        | `@grammyjs/i18n` 1.1.2                                                 | this plugin                                                                      |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Flavor                         | additive `I18nFlavor` (`Context & I18nFlavor`)                         | transformative `I18nextFlavor<C>` (alias `I18nFlavor<C>`)                        |
| `ctx.t` / `ctx.translate`      | same function, sync, Fluent `(key, vars)`                              | same per-update i18next `TFunction`, sync                                        |
| `ctx.i18n.getLocale()`         | async, re-runs negotiation, ignores `useLocale`                        | sync string reflecting the in-flight locale (`await` still works)                |
| `ctx.i18n.useLocale()`         | sync, no validation                                                    | `Promise<void>`; rebinds synchronously when nothing has to be loaded             |
| `ctx.i18n.setLocale()`         | requires `useSession`, writes `session.__language_code`, re-negotiates | writes through `LocaleStore`; storage-agnostic                                   |
| `ctx.i18n.renegotiateLocale()` | `Promise<void>`                                                        | alias of `renegotiate()`, `Promise<string>`                                      |
| `ctx.i18n.fluent`              | the Fluent instance                                                    | `ctx.i18n.instance` (the i18next instance)                                       |
| Negotiation order              | negotiator → session → `from.language_code` → default                  | store → negotiator (default `from.language_code`) → default                      |
| `hears(key)`                   | standalone export, current locale only, no variables                   | `i18n.hears(key, { mode, variables })`, all locales by default                   |
| Missing message                | `{path}` + `console.warn`                                              | native: the key; Fluent compat mode: `{path}`                                    |
| Unknown variable/term/function | throws from `ctx.t`                                                    | Fluent's own `{$name}` fallback, reported via `onError`                          |
| `globalTranslationContext`     | per-call context-derived variables                                     | not provided; use `interpolation.defaultVariables`, or pass variables explicitly |
| `directory`                    | synchronous load in the constructor                                    | `loadFluentLocales()` / `loadLocales()` from `/loader`                           |
| `useSession`                   | built-in session storage                                               | `localeStore: sessionLocaleStore()`                                              |
| `fluentOptions.warningHandler` | Fluent warning callback                                                | `onError` on `createFluentI18next` / `createFluentFormat`                        |
| `useIsolating`                 | Fluent default (`true`)                                                | same default                                                                     |

## What the differential tests guarantee

Fluent mode is tested against the real `@grammyjs/i18n@1.1.2` `Fluent` class, loaded in-process over the same `.ftl` fixtures, in compat mode. Both engines are compared string by string.

### Byte-identical output (12 feature groups)

| Feature                                                           | Example                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Simple, multiline, unicode, escaped messages                      | `Line one\nLine two`                                                                 |
| Variables                                                         | `greeting = Hello, { $name }!`                                                       |
| Message references, terms, term arguments, term attributes        | `{ -brand }`, `{ -thing(article: "indefinite") }`, `{ -titled.gender -> … }`         |
| Select expressions and numeric variants                           | `{ $n -> [0] … *[other] … }`                                                         |
| Plural categories                                                 | `en` one/other, `de` one/other, `ru` one/few/many                                    |
| Message attributes, and the bare key of a message with attributes | `login.tooltip`, `login`                                                             |
| `NUMBER()` and `DATETIME()`, including regional formats           | `NUMBER($amount, minimumFractionDigits: 2)` in `en`/`de`, `DATETIME(...)` in `de-DE` |
| Custom `functions`                                                | `UPPER($word)`                                                                       |
| Bidi isolation on and off                                         | `useIsolating: true` / `false`                                                       |
| Region fallback and default-locale fallback                       | `de-AT → de`, `fr → en`                                                              |
| Missing message, missing attribute, value-less message            | `{nope}`, `{login.nope}`, `""`                                                       |
| Duplicate ids inside one source                                   | last definition wins                                                                 |

### Intentional differences

| Case                                         | `@grammyjs/i18n`                                                        | this plugin                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Unknown variable, message, term, or function | throws `ReferenceError` out of `ctx.t`                                  | renders Fluent's fallback (`{$name}`, `{nowhere}`, `{NOPE()}`, `{-nothing}`) and reports to `onError` |
| Loading the same locale twice                | one bundle per load, the first match wins, the second load is invisible | one bundle per `locale\|namespace`; sources merge, and in compat mode later definitions override      |

Beyond the FTL output, the API differences in the table above are deliberate too: `getLocale()` is synchronous and reflects `useLocale`, negotiation asks the store first, `hears` defaults to all locales, and the `{path}` rendering for missing messages only happens in compat mode.

**This is not a drop-in replacement for everything.** The differential tests define the guarantee. Anything outside them needs to be looked at, especially code that relied on `ctx.t` throwing, on `globalTranslationContext`, or on the `Fluent` class itself.

## Related

- [Fluent compatibility mode](./fluent.md)
- [Advanced usage](./advanced.md)
