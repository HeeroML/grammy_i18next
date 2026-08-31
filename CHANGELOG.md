# Changelog

Notable changes to `@heeroml/grammy-i18next`. The package major tracks grammY 2; while grammY 2 is in beta, only prereleases are published.

## 2.0.0-beta.1 (unreleased)

A rewrite around a grammY-version-independent core, so that one implementation can serve both grammY majors. Entries that break code written against 2.0.0-beta.0 are marked **breaking**.

### Added

- `./v1` entrypoint: the same plugin bound to the grammY 1.x `Context`, `MiddlewareObj`, and `HearsContext<FC>` types. `.` and `./v2` continue to serve grammY 2 and are the same module.
- `./loader` entrypoint: `loadLocales` (JSON trees) and the new `loadFluentLocales` (FTL files, flat `en.ftl` or `en/**/*.ftl` concatenated in sorted path order).
- `./fluent` entrypoint: Project Fluent support through i18next's `i18nFormat` extension point. It exports `createFluentI18next`, `createFluentFormat`, `FluentFormat`, `fluentSource`, and `FLUENT_SOURCE_KEY`, with the options `bundleOptions`, `allowOverrides`, `onError` (default `console.warn`, never throws), and `compat` (reproduces the output conventions of `@grammyjs/i18n` 1.x). Verified against the real `@grammyjs/i18n@1.1.2` `Fluent` class in differential tests.
- `sessionLocaleStore()`: a `LocaleStore` over `ctx.session`, using the key `__language_code` by default. That is the key `@grammyjs/i18n` used, so locales that users already chose carry over. Lazy sessions (a promise on `ctx.session`) are supported.
- `supportedLocales` option: the locale list used by `hears` in `"all-locales"` mode, and the set of locales preloaded at `ready()` when a lazy-loading backend is attached.
- `ctx.translate` as an alias of `ctx.t` (always the same function object), `ctx.i18n.renegotiateLocale()` as an alias of `renegotiate()`, and `I18n` / `I18nFlavor` as aliases of `I18next` / `I18nextFlavor`, for bots migrating from `@grammyjs/i18n`.
- A second debug namespace, `grammy:i18next:fluent`, for Fluent bundle compilation.
- Repository: a shared integration suite that runs against a real `Bot` on both majors, Node/Bun/Deno smoke suites, module-graph assertions, and an esbuild browser/worker bundle check in CI.

### Changed

- **Breaking:** `ctx.t`, `ctx.translate`, and `ctx.i18n` are installed as non-enumerable properties, and the previous own descriptors are restored when the plugin's scope ends. In 2.0.0-beta.0 they were enumerable and stayed on the context after the plugin returned, so the last installed instance won for the rest of the update. Nested or duplicate instances now behave like ordinary onion middleware: the inner one owns its downstream scope, the outer one is intact afterwards.
- **Breaking:** the `locales` getter, and therefore `hears` in `"all-locales"` mode, honours `supportedLocales` when it is set, instead of always reporting the locales that currently have resources in the store.
- **Breaking:** passing `initOptions` together with an i18next instance that is already initialized is now an error. Previously the options were silently ignored; applying them would rebuild all i18next services and discard loaded resources.
- `ready()` semantics: one memoized promise that awaits an externally started initialization via `once("initialized")`, initializes through i18next's `init` callback, and, when a backend is attached, loads the `ns` namespaces and the `supportedLocales` exactly once. `loadNamespaces` moved out of the per-update path, where it mutated the instance options and reloaded the namespace for every preloaded language on every update.
- `hears` matches through the context's own `ctx.hasText(...)` instead of grammY's static `Context.has.text(...)`. The plugin now has no runtime import of grammY at all (only erased type imports), and text/caption matching as well as `ctx.match` / `ctx.payload` follow the installed major.
- `useLocale` rebinds `ctx.t` synchronously when the locale's resources need no loading, so `useLocale("de")` followed by `ctx.t(...)` works without an `await` for preloaded resources. Per-locale backend loads are memoized, and a failed load is not memoized so a later update can ask again.
- A backend failure while loading a locale for a single update is **not fatal**: the locale is used anyway and translations fall back along i18next's language hierarchy, mirroring i18next's own `changeLanguage` contract. The failure is reported through i18next's native `failedLoading` event and the `grammy:i18next` debug log. Only `ready()` is strict (see below). i18next itself does not ask the backend again for a language/namespace pair that failed after its internal retries; `instance.reloadResources()` forces a re-read.
- Locale normalization also converts underscores: `pt_BR` and `pt-br` both become `pt-BR`. i18next's `formatLanguageCode` only canonicalizes hyphenated tags.
- The `locales` getter reads `instance.store.data` instead of `instance.services.resourceStore.data`.

### Removed

- **Breaking:** `loadLocales` is no longer exported from `.` / `./v2`; import it from `@heeroml/grammy-i18next/loader`. It pulled `node:fs` into every consumer. As a result, `.`, `./v1`, `./v2`, and `./fluent` are free of Node built-ins and bundle for browsers and workers (checked in CI with esbuild); `./loader` is the one entrypoint that needs Node.js, Deno, or Bun.

### Fixed

- Initialization errors are no longer swallowed. i18next's `init()` promise resolves even when a backend failed to load the initial resources; the plugin now goes through the `init` callback, so a failed initialization rejects `ready()` and therefore every update, instead of leaving the bot running with missing translations. That covers backend errors while loading the fallback language, the plugin-bound `ns` namespaces, and `supportedLocales`.
- A failed initialization stays failed instead of being retried on every update, and waiting for an externally started initialization uses `once` instead of leaking a permanent `initialized` listener.
- With a lazy-loading backend, `hears` in `"all-locales"` mode can now match locales that were never negotiated, because `supportedLocales` are preloaded at `ready()`. A synchronous predicate cannot fetch translations on demand, so previously it only matched whatever happened to be loaded.
- `setLocale` has a defined failure mode: if the store write rejects, the locale stays in use for the rest of the update and the returned promise rejects with the store's error. The behaviour is unchanged from 2.0.0-beta.0, but it is now documented and covered by tests on both majors.

## 2.0.0-beta.0 - 2026-08-09

Initial release, grammY 2 only.

- The `I18next` plugin: per-update `ctx.t` bound via `getFixedT` (the global language of the instance is never changed), `ctx.i18n` controls (`getLocale`, `useLocale`, `setLocale`, `renegotiate`, `instance`), and locale resolution from locale store → locale negotiator → default locale.
- The `LocaleStore` and `LocaleNegotiator` interfaces, the transformative `I18nextFlavor<C, Ns>`, the `ns` option, and the `hears` predicate with `"all-locales"` / `"current-locale"` modes.
- Plugin-level `t()`, `locales`, and `ready()` for translating outside of middleware.
- `loadLocales()` for JSON locale directories, exported from the root entrypoint.
- Debug logging under `grammy:i18next`.
