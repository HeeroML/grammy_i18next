/**
 * Loader smoke test.
 *
 * `./loader` is the one entrypoint allowed to use Node built-ins, so this file
 * is what proves the same `node:fs`/`node:path` code path behaves identically
 * on Node, Bun and Deno. Paths come from `import.meta.url`, never from a
 * runtime-specific cwd helper.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { loadFluentLocales, loadLocales } from "../src/loader/mod.ts";
import { repoPath } from "./support.ts";

test("loader: loadLocales reads a JSON locale tree", async () => {
    const resources = await loadLocales(repoPath("test/fixtures/locales"));

    assert.deepEqual(resources, {
        en: {
            main: { greeting: "Hello" },
            "errors/api": { timeout: "Timed out" },
        },
        de: {
            translation: { greeting: "Hallo" },
        },
    });
});

test("loader: loadFluentLocales reads and concatenates raw FTL", async () => {
    const resources = await loadFluentLocales(
        repoPath("test/fixtures/fluent/locales"),
    );

    assert.deepEqual(Object.keys(resources).sort(), ["de", "en"]);
    assert.match(resources.en, /^hello = Hello$/m);
    assert.match(resources.en, /^greeting = Hello, \{ \$name \}!$/m);
    // de/ is a directory: every .ftl below it is concatenated in sorted path
    // order, so extra/more.ftl comes before main.ftl.
    assert.match(resources.de, /^greeting = Hallo, \{ \$name \}!$/m);
    assert.match(resources.de, /^hello = Hallo$/m);
});

test("loader: loaded FTL and JSON round-trip through the plugin", async () => {
    const resources = await loadFluentLocales(
        repoPath("test/fixtures/fluent/locales"),
    );
    const { createFluentI18next } = await import("../src/fluent/mod.ts");
    const { I18next } = await import("../src/v2/mod.ts");
    const i18next = await createFluentI18next({
        defaultLocale: "en",
        resources,
        bundleOptions: { useIsolating: false },
    });
    const plugin = new I18next({ i18next });
    await plugin.ready();

    assert.equal(plugin.t("en", "hello"), "Hello");
    assert.equal(plugin.t("de", "greeting", { name: "Welt" }), "Hallo, Welt!");
});
