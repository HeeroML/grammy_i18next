import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Resource, ResourceKey, ResourceLanguage } from "i18next";

const JSON_EXTENSION = ".json";

/**
 * Loads a directory of JSON translation files into an i18next `Resource`
 * object that can be passed to `initOptions.resources`. This removes the need
 * for a file system backend plugin and works on Deno, Node.js, and Bun alike.
 *
 * Two directory layouts are supported, and can be mixed for different
 * locales:
 *
 * ```txt
 * locales/
 * ├── en/               ← directory per locale,
 * │   ├── main.json     ← file per namespace ("main"),
 * │   └── errors/
 * │       └── api.json  ← nested directories join with "/" ("errors/api")
 * └── de.json           ← flat file per locale (namespace "translation")
 * ```
 *
 * ```ts
 * const i18n = new I18next({
 *     initOptions: {
 *         fallbackLng: "en",
 *         resources: await loadLocales("./locales"),
 *     },
 * });
 * ```
 *
 * @param directory Path to the locales directory.
 * @returns The loaded resources, keyed by locale and namespace.
 */
export async function loadLocales(directory: string): Promise<Resource> {
    const resource: Resource = {};
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            resource[entry.name] = await loadNamespaces(
                join(directory, entry.name),
                "",
            );
        } else if (entry.isFile() && extname(entry.name) === JSON_EXTENSION) {
            const locale = entry.name.slice(0, -JSON_EXTENSION.length);
            resource[locale] = {
                translation: await readJson(join(directory, entry.name)),
            };
        }
    }
    if (Object.keys(resource).length === 0) {
        throw new Error(
            `No locales found in '${directory}'. ` +
                "Expected one directory or one .json file per locale.",
        );
    }
    return resource;
}

async function loadNamespaces(
    directory: string,
    prefix: string,
): Promise<ResourceLanguage> {
    const namespaces: ResourceLanguage = {};
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            Object.assign(
                namespaces,
                await loadNamespaces(
                    join(directory, entry.name),
                    `${prefix}${entry.name}/`,
                ),
            );
        } else if (entry.isFile() && extname(entry.name) === JSON_EXTENSION) {
            const namespace = prefix +
                entry.name.slice(0, -JSON_EXTENSION.length);
            namespaces[namespace] = await readJson(join(directory, entry.name));
        }
    }
    return namespaces;
}

async function readJson(path: string): Promise<ResourceKey> {
    const source = await readFile(path, "utf8");
    try {
        return JSON.parse(source);
    } catch (error) {
        throw new Error(`Invalid JSON in locale file '${path}'`, {
            cause: error,
        });
    }
}
