# Design notes: grammY ⇄ i18next bridge (2026-08-31)

Internal findings and the architecture derived from them. Written before the
2.0.0-beta.1 rewrite; kept in the repository so reviewers can check decisions
against evidence. Versions verified on 2026-08-31 against the registries:

| Package                   | Version                                                 | Registry                                          |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| grammy (v1)               | 1.46.0                                                  | npm only (deno.land/x lags at 1.45.1; not on JSR) |
| @grammyjs/grammy (v2)     | 2.0.0-beta.8                                            | JSR only (no npm 2.x)                             |
| i18next                   | 26.4.0                                                  | npm (+ JSR mirror `@i18next/i18next`)             |
| @fluent/bundle            | 0.19.1                                                  | npm only (not on JSR)                             |
| @grammyjs/i18n            | 1.1.2 stable; `v2` branch = draft PR #60, unpublished   | npm / deno.land/x                                 |
| i18next-fluent / -backend | 2.0.0 / 1.0.1, pin `@fluent/bundle@^0.13` (7 years old) | npm                                               |

## 1. Findings

### 1.1 grammY v1 vs v2 (what a middleware plugin sees)

- `NextFunction`, `MiddlewareFn`, `MiddlewareObj`, `Middleware`, `run`,
  `BotError` and the `Context` constructor `(update, api, me)` are
  byte-identical in both majors. This is the seam the shared core is built on.
- Instance predicates `ctx.hasText(trigger)`, `ctx.has(filter)` exist in both
  majors (v1 since 1.10.0). They match `message`/`channel_post` text **and**
  caption and set `ctx.match` (v1, string or RegExpMatchArray) or
  `ctx.payload`/`ctx.match` (v2 splits string vs regex results). Using the
  instance method means the plugin needs **no runtime import of grammY at
  all**, only `import type`, which is erased. Verified via `deno info` (type
  edge only) and esbuild output.
- Type differences: `Filter` → `FilterQueryContext`; `HearsContext<C>` →
  `HearsContext<C, T>`; `ctx.reply` → `ctx.sendMessage`/`ctx.send`;
  `GrammyError` → `BotApiError`; `BotConfig.botInfo` → `me`;
  `ContextConstructor` removed (custom context classes impossible in v2, so
  plugins must install properties from middleware).
- v2 no longer copies `bot.api` transformers onto `ctx.api` (still true in
  beta.8; `installedTransformers()` was removed). Tests must intercept via a
  first middleware calling `ctx.api.transform(...)` on v2 and via
  `bot.api.config.use(...)` on v1. A v2 `bot.catch` swallows errors that v1
  would rethrow from `handleUpdate`.
- grammY 2 has **no session plugin anywhere** (not in core, not on JSR).
  "Session before i18n" on v2 is tested with a stub middleware that assigns
  `ctx.session`; on v1 the real `session()` is used.
- `@grammyjs/conversations` never clones/serializes `ctx`; it rebuilds from
  `{update, api, me}` and re-runs declared plugins on replay. Enumerability of
  `ctx.t` is therefore not a serialization problem; the real hazard is writing
  functions onto `ctx.update` (hydrate does this). `@grammyjs/i18n` installs
  `ctx.i18n` non-enumerable (`defineProperty`, writable, non-configurable) so a
  second install inside a conversation does not throw.
- Prerelease ranges: `^2.0.0-beta.0` is valid JSR specifier syntax, matches
  every beta/rc and stable 2.x, excludes 3.x. `^2` / `^2.0.0` resolve to
  nothing while no stable 2.0.0 exists. Compound ranges are unwritable in
  `jsr:` specifiers.
- Issue grammyjs/grammY#709 is a one-paragraph intent note ("use
  transformative flavours"), not a migration guide.

### 1.2 Public API differences vs `@grammyjs/i18n` 1.1.2

| Surface                        | @grammyjs/i18n 1.1.2                                                        | this plugin                                                            |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Flavor                         | additive `interface I18nFlavor` (`Context & I18nFlavor`)                    | transformative `I18nextFlavor<C>` (alias `I18nFlavor<C>`)              |
| `ctx.t` / `ctx.translate`      | same function, sync, Fluent `(key, vars)`                                   | same per-update i18next `TFunction`, sync                              |
| `ctx.i18n.getLocale()`         | **async**, re-runs negotiation, ignores `useLocale`                         | sync string reflecting the in-flight locale (`await` still works)      |
| `ctx.i18n.useLocale()`         | sync, no validation                                                         | `Promise<void>`; rebinds synchronously when no loading is needed       |
| `ctx.i18n.setLocale()`         | requires `useSession`, writes `session.__language_code`, then re-negotiates | uses `LocaleStore.write`; storage-agnostic                             |
| `ctx.i18n.renegotiateLocale()` | `Promise<void>`                                                             | alias of `renegotiate()`, `Promise<string>`                            |
| `ctx.i18n.fluent`              | Fluent instance                                                             | `ctx.i18n.instance` (i18next)                                          |
| Negotiation order              | negotiator → session → `from.language_code` → default                       | store → negotiator (default `from.language_code`) → default            |
| `hears(key)`                   | standalone export, current locale only, no variables                        | `i18n.hears(key, { mode, variables })`, all-locales by default         |
| Missing message                | `{path}` + `console.warn`                                                   | native: key; Fluent compat mode: `{path}`                              |
| Unknown variable/term/function | **throws** from `ctx.t`                                                     | Fluent: returns Fluent's `{$name}` fallback, reports via `onError`     |
| `globalTranslationContext`     | per-call ctx-derived variables                                              | not provided (use `interpolation.defaultVariables` or pass explicitly) |
| `directory` option             | sync load in constructor                                                    | `loadFluentLocales()` / `loadLocales()` from `/loader`                 |
| `useIsolating`                 | Fluent default (`true`, FSI/PDI in output)                                  | same default in Fluent mode                                            |

The v2 branch of `@grammyjs/i18n` drops `ctx.t`, `setLocale`,
`renegotiateLocale`, sessions and `globalTranslationContext`, makes
`getLocale` sync, throws on missing keys and adds a `FormatAdapter`
abstraction. It is unpublished.

### 1.3 How i18next 26.4.0 invokes an `i18nFormat` module

- Registered via `use({ type: "i18nFormat", ... })`; `init(i18next)` is called
  with **one** argument, before the Translator exists (backend connector and
  store already exist; `store.on("added")` is usable).
- `Translator.getResource(code, ns, key, options)` delegates **entirely** to
  `i18nFormat.getResource` when defined; the ResourceStore is bypassed for
  lookups (still used for `hasResourceBundle`/`hasLoadedNamespace`
  bookkeeping). The key arrives whole (never split by `keySeparator`), and
  `options` is the full `t()` options object including variables.
- `resolve` still iterates namespaces × `toResolveHierarchy(lng)` codes ×
  lookup keys, so region fallback (`de-DE → de → fallbackLng`) and
  `fallbackNS` keep working. A hit is anything not `undefined`/`null`
  (`returnEmptyString: true` makes `""` a hit).
- `addLookupKeys(finalKeys, key, code, ns, options)` replaces plural/context
  key expansion; a no-op leaves `[key]`.
- `parse(res, options, lng, ns, key, info)` runs instead of the Interpolator
  (so `escapeValue`/nesting/formatters never run). `info` is `{ resolved }`
  only. **The `lng` argument is the requested language, not the resolved one**,
  a latent bug in i18next-fluent; the bundle must be carried in the marker
  returned by `getResource`. `parse` is also called on misses with `res ===
  key` (or the `defaultValue`), so it must tolerate plain strings.
  `appendNamespaceToMissingKey` is inert once `parse` exists;
  `parseMissingKeyHandler` still runs afterwards.
- `handleAsObject = false` skips the object/`joinArrays` branches (one of which
  crashes with a 4-arg `extendTranslation` call).
- `getFixedT(lng: string, ns)` is a pure closure; the string form gets the
  full hierarchy, the array form (`lngs`) gets **no** hierarchy expansion.
  `keyPrefix` always joins with `"."`.
- `loadLanguages(lng)` short-circuits on an exact-string `options.preload`
  match; concurrent loads for the same `lng|ns` are deduplicated by the
  backend connector. `loadNamespaces(ns)` mutates `options.ns` permanently and
  reloads that namespace for every preloaded language; call it once, not per
  update. Both resolve even on backend errors; errors are only reported via
  the callback argument.
- `init()` resolves even if the backend fails (`failedLoading` event and
  callback `err` are the only signals). `isInitialized` is `undefined` before
  init. A second `init()` silently rebuilds all services (and would discard
  an i18nFormat's compiled bundles). `once(event, fn)` exists (26.0+).
- `formatLanguageCode` canonicalizes hyphenated codes (`pt-br → pt-BR`) but not
  underscores or single-subtag casing; normalize `_ → -` before calling it.
- A backend `read()` callback returning a raw string is spread into a
  per-character object by `addResourceBundle`; raw FTL must travel as an
  object value (e.g. `{ ftl: "…" }`) or be passed directly via
  `init({ resources })`, which stores values verbatim.
- TypeScript: `TFunction<Ns>` is nominally branded on the first namespace when
  `resources` are declared (so the plugin must be generic in `Ns`);
  `I18nFormatModule` types nothing but the discriminant;
  `parseInterpolation: false` (26.2+) disables the type-level `{{var}}`
  extractor (needed for FTL).

### 1.4 Loading raw Fluent without FTL → JS → FTL

`@fluent/bundle` 0.19.1: `new FluentResource(source)` (never throws; junk
messages are silently dropped), `new FluentBundle(locales, { functions,
useIsolating = true, transform })`, `bundle.addResource(res, { allowOverrides
})` (returns `Error[]` only for duplicate ids), `bundle.getMessage(id)` →
`{ id, value: Pattern | null, attributes }`, `bundle.formatPattern(pattern,
args, errors)`, which **throws on the first error unless an `errors` array is
passed**; with the array, unknown variables render as `{$name}`. FSI/PDI
(U+2068/U+2069) wrap every placeable of a pattern that has more than one
element. Message references are bundle-local. No Node built-ins, no
dependencies, ships `.d.ts` that `deno check` accepts, works on Deno via
`npm:` (Deno/Node/Bun output is byte-identical). `NUMBER`/`DATETIME` are not
exported. `FluentVariable` typing is permissive (booleans type-check but throw
at runtime) → coerce variables explicitly.

Pipeline: raw `.ftl` text → `FluentResource` → `FluentBundle` (one per
`locale|namespace`, compiled once, cached in a sidecar `Map`) →
`formatPattern` per call. i18next's ResourceStore only holds the raw text as
an opaque marker so that `hasResourceBundle`, backend deduplication and
`loadLanguages` keep working. `fluent_conv`, `i18next-fluent`,
`i18next-fluent-backend` and `@fluent/langneg` are not used.

### 1.5 Shared vs version-specific

Shared (`src/core`) holds everything with behaviour: i18next lifecycle and
`ready()`, `getFixedT` binding, locale normalization, negotiation, locale
store, lazy loading, namespaces, property installation with descriptor
snapshot/restore, controls, `hears` logic (via `ctx.hasText`), plugin-level
`t`/`locales`, session locale store helper, errors. The core types its context
structurally (`{ from?: { language_code? }, hasText(string[]): boolean }`) and
imports no grammY code or types.

Version-specific (`src/v1`, `src/v2`): only re-exports that bind the real
`Context`, `MiddlewareObj` and `HearsContext` types of that major
(`HearsContext<FC>` vs `HearsContext<FC, string>`), plus compatibility
aliases. They contain no runtime logic and no runtime import of grammY.

## 2. Architecture

```
src/
  mod.ts             root export = v2 (documented; see §2.6)
  core/
    types.ts         MinimalContext, LocaleStore, LocaleNegotiator, controls, options, flavor
    plugin.ts        I18nextCore: lifecycle, middleware, controls, hears logic
    install.ts       descriptor snapshot / install / restore of ctx.t, ctx.translate, ctx.i18n
    locale.ts        normalizeLocale, firstFallbackLocale
    negotiator.ts    defaultLocaleNegotiator
    session.ts       sessionLocaleStore()
  v1/mod.ts          grammY 1.x bindings (import type from "grammy")
  v2/mod.ts          grammY 2.x bindings (import type from "@grammyjs/grammy")
  fluent/
    mod.ts           createFluentI18next, createFluentFormat, FluentFormat, types
    format.ts        i18nFormat implementation + sidecar bundle store
    variables.ts     coercion of t() options into Fluent variables
  loader/
    mod.ts           re-exports json.ts + fluent.ts (Node fs; Node/Deno/Bun only)
    json.ts          loadLocales(directory)  → i18next Resource
    fluent.ts        loadFluentLocales(directory) → Record<locale, ftl source>
```

### 2.1 Package entrypoints

`.` (= `./v2`), `./v2`, `./v1`, `./fluent`, `./loader`. The root stays v2
because the only published version (2.0.0-beta.0) targeted grammY 2 and the
package major tracks grammY 2. The root no longer re-exports `loadLocales`
(it pulled `node:fs` into every consumer); `/loader` is the one entrypoint
allowed to import Node built-ins. `./v1` and `./v2` must have no runtime edge
to the other major (checked by `scripts/assert-graph.sh` in CI) and, together
with `./fluent`, no runtime edge to `node:*` (graph check + esbuild browser
bundle).

### 2.2 Middleware contract

- Same context object; properties `t`, `translate`, `i18n` are defined with
  `Object.defineProperty` as **non-enumerable, configurable** accessors/values.
  `t` and `translate` are getters returning the same bound `TFunction`
  (`ctx.t === ctx.translate` at any moment).
- On entry the previous own descriptors of the three properties are
  snapshotted; on exit (`finally`) they are restored or deleted. Nested or
  duplicate instances therefore behave like onion middleware: the inner
  instance owns its downstream scope, the outer one is intact afterwards.
- `next()` is called exactly once and awaited.
- Locale resolution order: `localeStore.read` → `localeNegotiator` (default
  `ctx.from?.language_code`) → `defaultLocale` (option, else first
  `fallbackLng`, else `"dev"`).
- Errors from the store, the negotiator, downstream middleware and
  initialization propagate (reject the middleware / the control call).
  Backend failures while loading a locale _per update_ are non-fatal, like
  i18next's own `changeLanguage`: the locale is still applied, translations
  fall back along the hierarchy, and the failure surfaces through i18next's
  `failedLoading` event plus the debug log. Nothing is swallowed silently.

### 2.3 Controls

`getLocale(): string`, `useLocale(l): Promise<void>` (rebinds synchronously
when the locale's resources need no loading), `setLocale(l): Promise<void>`
(= `useLocale` then `store.write`; if `write` rejects, the in-flight locale is
**kept** and the promise rejects with the store error; documented and tested),
`renegotiate(): Promise<string>`, `renegotiateLocale()` alias, `instance`.
Locales are normalized (`_ → -`, then i18next `formatLanguageCode`).

### 2.4 Lifecycle

`ready()` caches one promise: awaits an in-progress external `init` via
`once("initialized")`, or calls `init(initOptions, callback)` and rejects on
callback errors; then (backend attached) `loadNamespaces(ns)` once and
`loadLanguages(supportedLocales)` once. A rejected `ready()` stays rejected
(fail fast, no hang, no listener leak). Passing `initOptions` for an already
initialized instance is an error. Per-update language loading is memoized per
normalized locale.

### 2.5 `hears`

`i18n.hears(key, { mode: "all-locales" | "current-locale", variables })`
returns a sync predicate that translates the key and delegates to
`ctx.hasText(texts)` (so text/caption matching and `ctx.match`/`ctx.payload`
follow the installed grammY major). "All locales" = `supportedLocales` option
if given, else the locales currently present in the resource store. With a
lazy backend, `supportedLocales` are loaded at `ready()` because a sync
predicate cannot load on demand. That is the explicit cost of all-locale
matching, and it is documented.

### 2.6 Fluent

`createFluentFormat(options)` returns the i18nFormat module;
`createFluentI18next(options)` builds and initializes an isolated i18next
instance with it (`keySeparator: false`, `fallbackLng: defaultLocale`,
resources from `{ locale: ftl | { ns: ftl } }`). Options: `bundleOptions`
(static or per-locale factory), `onError` (default `console.warn`, never
throws), `allowOverrides` (defaults to `compat`), `compat` (reproduce
`@grammyjs/i18n` conventions: `{path}` for missing messages/attributes, `""`
for value-less messages, last duplicate wins).
Backends deliver FTL as `{ ftl: source }` per (language, namespace).

### 2.7 Versioning

Published: 2.0.0-beta.0 (2026-08-09, grammY 2 only). This rewrite is
2.0.0-beta.1 (breaking for beta.0 users only in the `loadLocales` root export
and the `locales` getter semantics). No stable release while grammY 2 is beta.
