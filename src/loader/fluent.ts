import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const FLUENT_EXTENSION = ".ftl";

/**
 * Loads a directory of Fluent (`.ftl`) translation files into the
 * `Record<locale, source>` shape that `createFluentI18next` takes as its
 * `resources` option. This removes the need for a file system backend plugin
 * and works on Deno, Node.js, and Bun alike.
 *
 * Two directory layouts are supported and can be mixed for different locales:
 *
 * ```txt
 * locales/
 * ├── en.ftl            ← flat file per locale
 * └── de/               ← directory per locale …
 *     ├── main.ftl      ← … whose .ftl files are concatenated,
 *     └── extra/
 *         └── more.ftl  ← recursively, in sorted path order
 * ```
 *
 * All files of one locale are joined with a newline into a single source, which
 * is the layout convention of `@grammyjs/i18n`, so an existing locales
 * directory keeps working unchanged. Files that are not `.ftl` are ignored.
 *
 * ```ts
 * const i18next = await createFluentI18next({
 *     defaultLocale: "en",
 *     resources: await loadFluentLocales("./locales"),
 * });
 * ```
 *
 * @param directory Path to the locales directory, relative or absolute.
 * @returns The raw Fluent sources, keyed by locale.
 */
export async function loadFluentLocales(
    directory: string,
): Promise<Record<string, string>> {
    const locales: Record<string, string> = {};
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const paths = await collect(join(directory, entry.name));
            // A directory without any .ftl file is not a locale. Skipping it
            // (instead of registering an empty locale) keeps the "no locales
            // found" error below meaningful.
            if (paths.length === 0) continue;
            locales[entry.name] = await concatenate(paths);
        } else if (
            entry.isFile() && extname(entry.name) === FLUENT_EXTENSION
        ) {
            const locale = entry.name.slice(0, -FLUENT_EXTENSION.length);
            locales[locale] = await readFile(
                join(directory, entry.name),
                "utf8",
            );
        }
    }
    if (Object.keys(locales).length === 0) {
        throw new Error(`No Fluent locales found in '${directory}'`);
    }
    return locales;
}

async function collect(directory: string): Promise<string[]> {
    const paths: string[] = [];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) paths.push(...await collect(path));
        else if (entry.isFile() && extname(entry.name) === FLUENT_EXTENSION) {
            paths.push(path);
        }
    }
    // `readdir` makes no ordering promise, but the concatenation order decides
    // which duplicate message id wins, so it must be deterministic.
    return paths.sort();
}

async function concatenate(paths: string[]): Promise<string> {
    const sources: string[] = [];
    for (const path of paths) sources.push(await readFile(path, "utf8"));
    return sources.join("\n");
}
