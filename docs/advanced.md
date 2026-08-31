# Advanced usage

Everything beyond the core setup in the [README](../README.md): backends, namespaces, file loading, entrypoints, typed keys, and the details of what the middleware does at runtime.

## The locale lives with the user

The picture behind the `localeStore` interface described in the README:

```
User DB / profile
       |
   locale = de
    /       \
Web app    grammY bot
 i18next     i18next
```

## Backends and lazy loading

Any [i18next backend](https://www.i18next.com/overview/plugins-and-utils#backends) works. The plugin detects an attached backend and then:

- loads the resources of a negotiated locale on demand (via `loadLanguages`) before binding `ctx.t`, deduplicated per locale, so lazily loaded locales work without further setup;
- loads the namespaces bound via the `ns` option once when the plugin becomes ready, so that every locale negotiated later fetches them too;
- preloads `supportedLocales` when the plugin becomes ready.

That last point is the price of all-locale `hears` matching. The predicate handed to `bot.filter` is synchronous and cannot fetch translations on demand, so the locales it should match must be in memory before the first update arrives. Without a backend nothing is preloaded, because everything is already there.

`await i18n.ready()` gives you that moment explicitly; the middleware awaits it on the first update anyway.

Start-up is strict, per-update loading is not. Initialization errors reject `ready()` and therefore every update, and they keep rejecting instead of hanging or silently retrying. That covers backend errors while loading the fallback language, the plugin-bound `ns` namespaces, or `supportedLocales`. A backend failure while loading a locale for a single update is **not fatal**: the locale is applied anyway and translations fall back along i18next's language hierarchy (`de-AT` → `de` → `fallbackLng`), which mirrors i18next's own `changeLanguage` contract. One unreachable file does not take the bot down for every user of that locale. Such failures are observable through i18next's native `failedLoading` event on `i18n.instance` and in the `grammy:i18next` debug log.

i18next does not ask the backend again for a language/namespace pair that failed after its own internal retries. Call `i18n.instance.reloadResources()` to force a re-read.

## Namespaces

`ns` binds one or more namespaces into `ctx.t`, exactly like `getFixedT(lng, ns)`:

```ts
const i18n = new I18next<MyContext, "menu">({
    initOptions: { fallbackLng: "en", resources },
    ns: "menu",
});
```

Without the option, the default namespace of the instance is used, and single calls can still select another one: `ctx.t("key", { ns: "errors" })`.

## Loading translation files from disk

The `/loader` entrypoint reads translation trees into memory without a file-system backend plugin.

`loadLocales(directory)` returns an i18next `Resource` for `initOptions.resources`. Two layouts are supported and can be mixed per locale:

```txt
locales/
├── en/               ← directory per locale
│   ├── main.json     ← one file per namespace ("main")
│   └── errors/
│       └── api.json  ← nested directories join with "/" ("errors/api")
└── pt-BR.json        ← or a flat file per locale (namespace "translation")
```

`loadFluentLocales(directory)` does the same for Fluent sources and returns `Record<locale, ftlSource>` for `createFluentI18next({ resources })`:

```txt
locales/
├── en.ftl            ← flat file per locale
└── de/               ← or a directory per locale, whose .ftl files are
    ├── main.ftl      ←   concatenated recursively, in sorted path order
    └── extra/
        └── more.ftl
```

That is the layout convention of `@grammyjs/i18n`, so an existing locales directory keeps working unchanged.

## Entrypoints and runtimes

| Entrypoint   | Contents                           | Node built-ins         |
| ------------ | ---------------------------------- | ---------------------- |
| `.` / `./v2` | plugin bound to grammY 2 types     | no                     |
| `./v1`       | plugin bound to grammY 1 types     | no                     |
| `./fluent`   | Project Fluent format module       | no                     |
| `./loader`   | `loadLocales`, `loadFluentLocales` | `node:fs`, `node:path` |

`/loader` is the only entrypoint that touches Node built-ins, so it needs Node.js, Deno, or Bun. The other four bundle cleanly for a browser or worker target. CI verifies this with esbuild (`platform: "browser"`, conditions `worker`/`browser`) and fails if a `node:` builtin or the loader shows up in the bundle inputs. CI also asserts that `./v1` has no runtime edge to grammY 2 (and vice versa) and that the non-Fluent entrypoints never pull in `@fluent/bundle`. That is a bundling guarantee, not a claim that the plugin has been deployed to any specific edge platform.

## Typed translation keys

Because `ctx.t` is a real i18next `TFunction`, i18next's standard [TypeScript setup](https://www.i18next.com/overview/typescript) gives fully typed keys and interpolation variables:

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

Now `ctx.t("greetin")` is a compile-time error, and `ctx.t("greeting", { name: ... })` knows its variables. No code generation, no plugin-specific tooling.

If you bind a namespace with the `ns` option, pass it as the second type parameter (`I18next<MyContext, "menu">`) so that `ctx.t` is typed for that namespace.

In Fluent mode, add `parseInterpolation: false` (i18next 26.2+) to `CustomTypeOptions`. It disables the type-level `{{var}}` extractor, which does not understand FTL placeables.

## What the middleware does

- It works on the same context object. Nothing is cloned or replaced. `ctx.t`, `ctx.translate`, and `ctx.i18n` are installed with `Object.defineProperty` as non-enumerable and configurable, so they do not appear in `Object.keys(ctx)`, spreads, or `JSON.stringify(ctx)`.
- Own descriptors that existed before are snapshotted and restored when the plugin's scope ends; properties that did not exist before are deleted again. Nested or duplicate plugin instances therefore behave like ordinary onion middleware: the inner instance owns its downstream scope, the outer one is intact afterwards.
- `next()` is called exactly once and awaited.
- Errors from the locale store, the locale negotiator, and downstream middleware propagate and reject the middleware; initialization errors reject every update. The one deliberate exception is a per-update backend load failure, which is logged and does not stop the update (see [Backends and lazy loading](#backends-and-lazy-loading)).
- It composes with session middleware, nested `Composer`s, and custom context flavors; the integration suite runs all of that through a real `Bot` on both grammY majors.
- `@grammyjs/conversations` never clones or serializes the context. It rebuilds the context from `{ update, api, me }` and re-runs the plugins you declared. Install this plugin as a conversation plugin the same way you install it on the bot. (This repository has no test for conversations; the statement describes how conversations rebuild contexts, not a verified integration.)

## Concurrency

The plugin never calls `changeLanguage()`. Every update gets its own translation function via `getFixedT(locale, ns)`, so concurrently or interleaved processed updates cannot leak locales into each other, and the global language of the instance never moves. Both majors are tested with interleaved updates in different locales.

## Debug logging

The plugin logs through [`@grammyjs/debug`](https://jsr.io/@grammyjs/debug):

```sh
DEBUG=grammy:i18next deno run -A bot.ts        # locale resolution, loading
DEBUG=grammy:i18next:fluent deno run -A bot.ts # Fluent bundle compilation
DEBUG=grammy:i18next* deno run -A bot.ts       # both
```

## HTML escaping

i18next escapes interpolated values by default (`interpolation.escapeValue: true`): `{{name}}` with the value `<b>` becomes `&lt;b&gt;`. That is exactly right when you send messages with `parse_mode: "HTML"`, and surprising when you send plain text. If you never use HTML parse mode, turn it off:

```ts
initOptions: {
    interpolation: { escapeValue: false },
}
```
