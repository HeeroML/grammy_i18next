import { FluentBundle, FluentResource } from "@fluent/bundle";
import type { FluentFunction, FluentVariable, Message } from "@fluent/bundle";
import type { i18n } from "i18next";
import { createDebug } from "@grammyjs/debug";
import { toFluentVariables } from "./variables.ts";

const debug = createDebug("grammy:i18next:fluent");

/**
 * A compiled Fluent pattern. `@fluent/bundle` does not re-export the type from
 * its entry point, so it is recovered from `Message`. Patterns are opaque and
 * must only ever be handed back to `FluentBundle.formatPattern`.
 */
type Pattern = NonNullable<Message["value"]>;

/**
 * The property under which a Fluent source travels inside i18next's resource
 * store when it is delivered by a `BackendModule`.
 *
 * A backend `read()` callback that returns a raw string has it spread into a
 * per-character object by `addResourceBundle`, so the FTL text must be wrapped:
 * `callback(null, { [FLUENT_SOURCE_KEY]: source })`.
 */
export const FLUENT_SOURCE_KEY = "ftl" as const;

/** A Fluent source wrapped for transport through i18next's resource store. */
export interface FluentSourceValue {
    /** The raw, unparsed FTL text. */
    ftl: string;
}

/**
 * Wraps raw FTL text in the object shape that i18next's resource store keeps
 * verbatim, for use in a `BackendModule.read` callback or in
 * `addResourceBundle`.
 *
 * ```ts
 * const backend: BackendModule = {
 *     type: "backend",
 *     init() {},
 *     read(lng, ns, callback) {
 *         callback(null, fluentSource(sources[`${lng}/${ns}`] ?? ""));
 *     },
 * };
 * ```
 *
 * @param source The raw FTL text.
 * @returns The wrapped value.
 */
export function fluentSource(source: string): FluentSourceValue {
    return { ftl: source };
}

/**
 * Options forwarded to the `FluentBundle` constructor of `@fluent/bundle`.
 *
 * Mirrors the option bag of `new FluentBundle(locales, options)`.
 */
export interface FluentBundleOptions {
    /** Additional functions available to translations as builtins. */
    functions?: Record<string, FluentFunction>;
    /**
     * Whether to wrap placeables in Unicode isolation marks (FSI `U+2068` /
     * PDI `U+2069`). Fluent's default — and this plugin's — is `true`.
     */
    useIsolating?: boolean;
    /**
     * A function used to transform the string parts of patterns. Mirrors
     * `TextTransform` of `@fluent/bundle`.
     */
    transform?: (text: string) => string;
}

/** A problem reported by the Fluent format module. */
export interface FluentError {
    /**
     * `"format"` for errors collected by `formatPattern` (unknown variable,
     * unknown term, unknown function, cyclic reference, …) and `"resource"`
     * for problems found while compiling a source into a bundle (duplicate
     * message ids, store content that is not Fluent at all).
     */
    kind: "format" | "resource";
    /** The locale of the bundle that produced the error. */
    locale: string;
    /** The i18next namespace of the bundle that produced the error. */
    namespace: string;
    /** The requested key, for `"format"` errors. */
    key?: string;
    /** The underlying errors, verbatim. */
    errors: Error[];
    /** A human readable one-line summary, used by the default handler. */
    message: string;
}

/** Options shared by {@linkcode createFluentFormat} and `createFluentI18next`. */
export interface FluentFormatOptions {
    /**
     * Options for every `FluentBundle`, either as one static bag or as a
     * factory that is called once per locale.
     */
    bundleOptions?:
        | FluentBundleOptions
        | ((locale: string) => FluentBundleOptions);
    /**
     * Whether a later resource may override a message or term that an earlier
     * one already defined.
     *
     * Defaults to the value of {@linkcode FluentFormatOptions.compat}: Fluent's
     * own default is `false` (the first definition wins and the duplicate is
     * reported as a `"resource"` error), while `@grammyjs/i18n` used `true`
     * (the last definition wins, silently).
     */
    allowOverrides?: boolean;
    /**
     * Called for every problem. The default handler writes
     * `error.message` to `console.warn` — it never throws and is never silent.
     */
    onError?: (error: FluentError) => void;
    /**
     * Reproduces the output conventions of `@grammyjs/i18n` 1.x: a missing
     * message or attribute renders as `{key}` instead of falling through to
     * i18next's own "return the key" behaviour, a message that has attributes
     * but no value renders as `""` for the bare key, and `allowOverrides`
     * defaults to `true`.
     *
     * Defaults to `false`.
     */
    compat?: boolean;
}

/**
 * The marker that {@linkcode FluentFormat.getResource} returns for a hit.
 *
 * i18next passes the *requested* language to `parse`, not the resolved one, so
 * the bundle that produced the pattern has to travel with the lookup result.
 */
class FluentMatch {
    /** The bundle the pattern belongs to. */
    readonly bundle: FluentBundle;
    /** The message value or attribute pattern that was looked up. */
    readonly pattern: Pattern;
    /** The resolved locale. */
    readonly locale: string;
    /** The resolved namespace. */
    readonly namespace: string;

    constructor(
        bundle: FluentBundle,
        pattern: Pattern,
        locale: string,
        namespace: string,
    ) {
        this.bundle = bundle;
        this.pattern = pattern;
        this.locale = locale;
        this.namespace = namespace;
    }
}

/**
 * The subset of i18next's `i18nFormat` contract that is actually invoked by
 * `Translator`.
 *
 * i18next's own `I18nFormatModule` types nothing but the `type` discriminant,
 * so the hooks are declared here instead of being cast to `any`.
 */
export interface I18nFormatHook {
    /** The module discriminant. */
    type: "i18nFormat";
    /** Disables i18next's object/`joinArrays` branches. */
    handleAsObject: false;
    /** Called once with the i18next instance, before the translator exists. */
    init(i18next: i18n): void;
    /** Replaces the resource store lookup entirely. */
    getResource(
        lng: string,
        ns: string,
        key: string,
        options: Record<string, unknown>,
    ): unknown;
    /** Replaces the interpolator. */
    parse(
        res: unknown,
        options: Record<string, unknown>,
        lng: string,
        ns: string,
        key: string,
        info: { resolved?: unknown },
    ): string;
    /** Replaces plural/context key expansion. */
    addLookupKeys(
        finalKeys: string[],
        key: string,
        lng: string,
        ns: string,
        options: Record<string, unknown>,
    ): string[];
}

function bundleKey(lng: string, ns: string): string {
    return `${lng}|${ns}`;
}

function summarize(errors: Error[]): string {
    return errors.map((error) => error.message).join("; ");
}

/**
 * An i18next `i18nFormat` module that formats Project Fluent messages.
 *
 * The raw FTL text stays in i18next's resource store as an opaque value so
 * that `hasResourceBundle`, backend deduplication and `loadLanguages` keep
 * working; the compiled `FluentBundle` for each `locale|namespace` pair lives
 * in a sidecar map and is built exactly once per source.
 *
 * Register it on an isolated i18next instance — {@linkcode createFluentI18next}
 * does that for you:
 *
 * ```ts
 * const i18next = createInstance();
 * await i18next.use(createFluentFormat()).init({
 *     keySeparator: false,
 *     fallbackLng: "en",
 *     resources: { en: { translation: "hello = Hello, { $name }!" } },
 * });
 * ```
 */
export class FluentFormat implements I18nFormatHook {
    /** The i18next module discriminant. */
    readonly type: "i18nFormat" = "i18nFormat";
    /**
     * Tells i18next to skip its object and `joinArrays` handling; Fluent
     * messages are always formatted to a string.
     */
    readonly handleAsObject: false = false;

    readonly #options: FluentFormatOptions;
    readonly #compat: boolean;
    readonly #allowOverrides: boolean;
    readonly #bundles = new Map<string, FluentBundle>();
    readonly #compiled = new Set<string>();
    readonly #reported = new Set<string>();
    #i18next: i18n | undefined;

    /**
     * Creates the format module.
     *
     * @param options Bundle options, error handling and compatibility mode.
     */
    constructor(options: FluentFormatOptions = {}) {
        this.#options = options;
        this.#compat = options.compat ?? false;
        this.#allowOverrides = options.allowOverrides ?? this.#compat;
    }

    /**
     * Called by i18next with the instance this module was registered on.
     *
     * Compiles everything that `init({ resources })` put into the store and
     * subscribes to later store mutations.
     *
     * @param i18next The i18next instance.
     */
    init(i18next: i18n): void {
        this.#i18next = i18next;
        i18next.store.on("added", this.#onAdded);
        i18next.store.on("removed", this.#onRemoved);
        const data = i18next.store.data ?? {};
        for (const lng of Object.keys(data)) {
            for (const ns of Object.keys(data[lng] ?? {})) {
                this.#compile(lng, ns);
            }
        }
    }

    /**
     * Looks a Fluent message (or `message.attribute`) up in the bundle for
     * `lng|ns`.
     *
     * @param lng The resolved language i18next is currently trying.
     * @param ns The namespace i18next is currently trying.
     * @param key The whole key; never pre-split, because `keySeparator` is off.
     * @param _options The full `t()` option bag (unused).
     * @returns A marker for `parse`, `""` for a value-less message in compat
     *     mode, or `undefined` to let i18next continue its fallback chain.
     */
    getResource(
        lng: string,
        ns: string,
        key: string,
        _options?: Record<string, unknown>,
    ): unknown {
        const bundle = this.#bundleFor(lng, ns);
        if (bundle === undefined) return undefined;
        const separator = key.indexOf(".");
        const id = separator === -1 ? key : key.slice(0, separator);
        const attribute = separator === -1 ? "" : key.slice(separator + 1);
        const message = bundle.getMessage(id);
        if (message === undefined) return undefined;
        if (attribute !== "") {
            const pattern = message.attributes[attribute];
            if (pattern === undefined) return undefined;
            return new FluentMatch(bundle, pattern, lng, ns);
        }
        if (message.value === null) return this.#compat ? "" : undefined;
        return new FluentMatch(bundle, message.value, lng, ns);
    }

    /**
     * Formats the lookup result. Runs instead of i18next's interpolator.
     *
     * @param res The marker from {@linkcode FluentFormat.getResource}, or a
     *     plain string when i18next fell back to the key or a `defaultValue`.
     * @param options The option bag, with `interpolation.defaultVariables`
     *     already merged in by i18next.
     * @param _lng The *requested* language — deliberately ignored.
     * @param _ns The namespace.
     * @param key The resolved key.
     * @param _info `{ resolved }`.
     * @returns The formatted message.
     */
    parse(
        res: unknown,
        options: Record<string, unknown>,
        _lng: string,
        _ns: string,
        key: string,
        _info?: { resolved?: unknown },
    ): string {
        if (res instanceof FluentMatch) {
            const errors: Error[] = [];
            const variables: Record<string, FluentVariable> = toFluentVariables(
                options,
                this.#i18next?.options.interpolation?.defaultVariables,
            );
            const formatted = res.bundle.formatPattern(
                res.pattern,
                variables,
                errors,
            );
            if (errors.length > 0) {
                this.#report({
                    kind: "format",
                    locale: res.locale,
                    namespace: res.namespace,
                    key,
                    errors,
                    message: `Fluent could not fully format '${key}' in ` +
                        `'${res.locale}/${res.namespace}': ${
                            summarize(errors)
                        }`,
                });
            }
            return formatted;
        }
        if (res === "") return "";
        if (res === undefined || res === null) {
            return this.#compat ? `{${key}}` : key;
        }
        if (this.#compat && res === key) return `{${key}}`;
        return String(res);
    }

    /**
     * Returns the lookup keys unchanged: Fluent resolves plurals and contexts
     * inside the message, so i18next must not append `_one`/`_other` suffixes.
     *
     * @param finalKeys The keys i18next intends to look up.
     * @returns `finalKeys`, unmodified.
     */
    addLookupKeys(finalKeys: string[]): string[] {
        return finalKeys;
    }

    readonly #onAdded = (lng: string, ns: string): void => {
        debug("resource added: %s/%s", lng, ns);
        this.#compile(lng, ns);
    };

    readonly #onRemoved = (lng: string, ns: string): void => {
        debug("resource removed: %s/%s", lng, ns);
        const key = bundleKey(lng, ns);
        this.#bundles.delete(key);
        this.#compiled.delete(key);
        this.#reported.delete(key);
    };

    #bundleFor(lng: string, ns: string): FluentBundle | undefined {
        const key = bundleKey(lng, ns);
        const cached = this.#bundles.get(key);
        if (cached !== undefined) return cached;
        // A bundle can be missing because nothing was ever compiled for this
        // pair (lazy path: the store was filled without an "added" event) or
        // because the store holds no Fluent source for it. The `#compiled` set
        // separates the two so a permanent miss is not recompiled per lookup.
        if (this.#compiled.has(key)) return undefined;
        this.#compile(lng, ns);
        return this.#bundles.get(key);
    }

    #compile(lng: string, ns: string): void {
        const key = bundleKey(lng, ns);
        this.#compiled.add(key);
        this.#reported.delete(key);
        const source = this.#sourceOf(lng, ns);
        if (source === undefined) {
            this.#bundles.delete(key);
            return;
        }
        const bundle = new FluentBundle(lng, this.#bundleOptionsFor(lng));
        const errors = bundle.addResource(new FluentResource(source), {
            allowOverrides: this.#allowOverrides,
        });
        if (errors.length > 0) {
            this.#report({
                kind: "resource",
                locale: lng,
                namespace: ns,
                errors,
                message: `Fluent resource problems in '${lng}/${ns}': ${
                    summarize(errors)
                }`,
            }, key);
        }
        debug("compiled bundle %s (%d resource errors)", key, errors.length);
        this.#bundles.set(key, bundle);
    }

    #sourceOf(lng: string, ns: string): string | undefined {
        const value = this.#i18next?.store?.data?.[lng]?.[ns];
        if (value === undefined || value === null) return undefined;
        if (typeof value === "string") return value;
        if (typeof value === "object") {
            const wrapped = (value as Record<string, unknown>)[
                FLUENT_SOURCE_KEY
            ];
            if (typeof wrapped === "string") return wrapped;
            // An empty object is what a backend returns for "nothing here";
            // anything else is real content in the wrong format.
            if (Object.keys(value).length === 0) return undefined;
        }
        this.#report({
            kind: "resource",
            locale: lng,
            namespace: ns,
            errors: [
                new TypeError(
                    `Expected raw FTL text or { ${FLUENT_SOURCE_KEY}: string }`,
                ),
            ],
            message: `'${lng}/${ns}' does not hold a Fluent source; ` +
                `expected raw FTL text or { ${FLUENT_SOURCE_KEY}: string }`,
        }, bundleKey(lng, ns));
        return undefined;
    }

    #bundleOptionsFor(locale: string): FluentBundleOptions {
        const options = this.#options.bundleOptions;
        if (typeof options === "function") return options(locale);
        return options ?? {};
    }

    #report(error: FluentError, once?: string): void {
        if (once !== undefined) {
            if (this.#reported.has(once)) return;
            this.#reported.add(once);
        }
        const handler = this.#options.onError;
        if (handler !== undefined) handler(error);
        else console.warn(error.message);
    }
}

/**
 * Creates the i18next `i18nFormat` module that formats Project Fluent
 * messages.
 *
 * @param options Bundle options, error handling and compatibility mode.
 * @returns The module, ready for `i18next.use(...)`.
 */
export function createFluentFormat(
    options: FluentFormatOptions = {},
): FluentFormat {
    return new FluentFormat(options);
}
