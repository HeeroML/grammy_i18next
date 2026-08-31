# Fluent compatibility mode

The full documentation of the `/fluent` entrypoint, including its options and how it plugs into i18next.

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

## Options

| Option           | Default           | Meaning                                                                                                                                                                                                                                                    |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bundleOptions`  | `{}`              | Passed to `new FluentBundle()`, either as one bag or as a factory called once per locale. `functions` adds builtins; `useIsolating` (default `true`) wraps placeables in FSI/PDI marks (`U+2068`/`U+2069`).                                                |
| `allowOverrides` | value of `compat` | Whether a later resource may override an already defined message or term. Fluent's own default is `false` (first wins, duplicate reported); `@grammyjs/i18n` behaved like `true`.                                                                          |
| `onError`        | `console.warn`    | Called for every problem, with `{ kind: "format" \| "resource", locale, namespace, key?, errors, message }`. It never throws by default, and it is never silent by default.                                                                                |
| `compat`         | `false`           | Reproduces `@grammyjs/i18n` output conventions: a missing message or attribute renders as `{key}` instead of i18next's "return the key", a message with attributes but no value renders as `""` for the bare key, and `allowOverrides` defaults to `true`. |

The FSI/PDI marks are invisible in Telegram clients but not in string comparisons: `t("greeting", { name: "World" })` is `"Hello, ⁨World⁩!"` by default. Turn them off with `bundleOptions: { useIsolating: false }` if you compare rendered strings (e.g. in your own tests).

## How it works

Raw `.ftl` text → `FluentResource` → `FluentBundle` → `formatPattern`. i18next's resource store keeps the raw source as an opaque value (so `hasResourceBundle`, backend deduplication, and `loadLanguages` keep working), and one bundle per `locale|namespace` is compiled from it exactly once and cached in a sidecar map. `@fluent/bundle` is only loaded if you import `/fluent`; the other entrypoints never reach it.

Two consequences worth knowing:

- Message and term references are bundle-local. With one namespace there is one bundle per locale and everything can reference everything. If you split namespaces, a message in one namespace cannot reference a term in another.
- Fluent handles syntax errors silently. `new FluentResource(source)` never throws; it drops the messages it cannot parse. A typo in an `.ftl` file therefore surfaces as a missing message at runtime, not as a load failure. If you need that to be an error, validate your `.ftl` files in CI with [`@fluent/syntax`](https://www.npmjs.com/package/@fluent/syntax).

## Related

- [Typed translation keys in Fluent mode](./advanced.md#typed-translation-keys)
- [Migrating from `@grammyjs/i18n`](./migration.md)
