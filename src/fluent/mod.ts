/**
 * Optional Project Fluent support for `@heeroml/grammy-i18next`.
 *
 * i18next's `i18nFormat` extension point replaces both the resource lookup and
 * the interpolator, which is exactly the seam a second message format needs.
 * This module plugs `@fluent/bundle` into it: raw `.ftl` text goes into
 * i18next's resource store untouched, one `FluentBundle` per
 * `locale|namespace` is compiled from it exactly once, and `t()` calls end up
 * in `FluentBundle.formatPattern`.
 *
 * ```ts
 * import { I18next } from "@heeroml/grammy-i18next";
 * import { createFluentI18next } from "@heeroml/grammy-i18next/fluent";
 * import { loadFluentLocales } from "@heeroml/grammy-i18next/loader";
 *
 * const i18n = new I18next({
 *     i18next: await createFluentI18next({
 *         defaultLocale: "en",
 *         resources: await loadFluentLocales("./locales"),
 *     }),
 * });
 * ```
 *
 * Nothing in here imports grammY or a Node built-in, so the entry point also
 * works in the browser and in workers.
 *
 * @module
 */

import { createInstance } from "i18next";
import type { i18n, InitOptions, Resource } from "i18next";
import { createFluentFormat, type FluentFormatOptions } from "./format.ts";

export {
    createFluentFormat,
    FLUENT_SOURCE_KEY,
    FluentFormat,
    fluentSource,
} from "./format.ts";
export type {
    FluentBundleOptions,
    FluentError,
    FluentFormatOptions,
    FluentSourceValue,
    I18nFormatHook,
} from "./format.ts";

/**
 * Raw Fluent sources, keyed by locale.
 *
 * A locale maps either to one FTL source (which lands in the default
 * namespace) or to an object of namespace to FTL source.
 *
 * ```ts
 * const resources: FluentSources = {
 *     en: "greeting = Hello, { $name }!",
 *     de: { main: "greeting = Hallo, { $name }!", errors: "boom = Peng" },
 * };
 * ```
 */
export interface FluentSources {
    /** One FTL source for the default namespace, or one per namespace. */
    [locale: string]: string | { [namespace: string]: string };
}

/** Options for {@linkcode createFluentI18next}. */
export interface FluentI18nextOptions extends FluentFormatOptions {
    /**
     * The locale to fall back to. Becomes i18next's `fallbackLng` and, unless
     * `initOptions.lng` says otherwise, the initial language.
     */
    defaultLocale: string;
    /** The raw Fluent sources. */
    resources: FluentSources;
    /** The default namespace. Defaults to `"translation"`. */
    defaultNS?: string;
    /**
     * Extra i18next init options, merged underneath the ones this function
     * controls (`keySeparator`, `fallbackLng`, `resources`, `ns`, `defaultNS`).
     * Everything else — `debug`, `supportedLngs`, `load`, `preload`,
     * `interpolation.defaultVariables`, … — is yours.
     */
    initOptions?: InitOptions;
}

function collectNamespaces(
    resources: FluentSources,
    defaultNS: string,
): { resource: Resource; namespaces: string[] } {
    const resource: Resource = {};
    const namespaces = new Set<string>([defaultNS]);
    for (const locale of Object.keys(resources)) {
        const value = resources[locale];
        if (typeof value === "string") {
            resource[locale] = { [defaultNS]: value };
            continue;
        }
        const perNamespace: Record<string, string> = {};
        for (const namespace of Object.keys(value)) {
            perNamespace[namespace] = value[namespace];
            namespaces.add(namespace);
        }
        resource[locale] = perNamespace;
    }
    return { resource, namespaces: [...namespaces] };
}

/**
 * Builds an isolated, initialized i18next instance that formats Project Fluent
 * messages.
 *
 * The instance is created with `createInstance()`, so it shares nothing with
 * the i18next default export. `keySeparator` is forced off (Fluent keys use
 * `.` to address attributes) and the Fluent format module is registered before
 * `init`, which lets it compile the passed sources immediately.
 *
 * ```ts
 * const i18next = await createFluentI18next({
 *     defaultLocale: "en",
 *     resources: {
 *         en: "greeting = Hello, { $name }!",
 *         de: "greeting = Hallo, { $name }!",
 *     },
 * });
 * i18next.getFixedT("de")("greeting", { name: "Welt" });
 * ```
 *
 * @param options Sources, default locale and Fluent formatting options.
 * @returns The initialized instance, ready for `new I18next({ i18next })`.
 */
export async function createFluentI18next(
    options: FluentI18nextOptions,
): Promise<i18n> {
    const {
        defaultLocale,
        resources,
        defaultNS = "translation",
        initOptions,
        ...formatOptions
    } = options;
    const { resource, namespaces } = collectNamespaces(resources, defaultNS);
    const requested = initOptions?.ns;
    const ns = [
        ...new Set([
            ...namespaces,
            ...(typeof requested === "string" ? [requested] : requested ?? []),
        ]),
    ];
    const instance = createInstance();
    // `FluentFormat` structurally satisfies i18next's `I18nFormatModule`
    // (which types nothing beyond the `type` discriminant), so no cast is
    // needed here.
    instance.use(createFluentFormat(formatOptions));
    await instance.init({
        lng: defaultLocale,
        ...initOptions,
        keySeparator: false,
        fallbackLng: defaultLocale,
        resources: resource,
        ns,
        defaultNS,
    });
    return instance;
}
