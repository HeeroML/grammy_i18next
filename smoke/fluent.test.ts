/**
 * Fluent bridge smoke test.
 *
 * Drives `createFluentI18next` and hands the resulting i18next instance to the
 * grammY 2 plugin, so the FTL path is exercised through the same public API a
 * user would use. `useIsolating` is turned off for most assertions to keep the
 * expected strings readable; one test asserts the default FSI/PDI behaviour.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createFluentI18next } from "../src/fluent/mod.ts";
import { I18next } from "../src/v2/mod.ts";

const en = `
greeting = Hello, { $name }!
items =
    { $count ->
        [one] { $count } item
       *[other] { $count } items
    }
report = Report
    .tooltip = Report this message
`;

const de = `
greeting = Hallo, { $name }!
items =
    { $count ->
        [one] { $count } Eintrag
       *[other] { $count } Einträge
    }
report = Melden
    .tooltip = Diese Nachricht melden
`;

function createInstance(useIsolating: boolean) {
    return createFluentI18next({
        defaultLocale: "en",
        resources: { en, de },
        bundleOptions: { useIsolating },
    });
}

test("fluent: interpolates variables per locale", async () => {
    const i18next = await createInstance(false);
    const plugin = new I18next({ i18next });
    await plugin.ready();

    assert.equal(
        plugin.t("en", "greeting", { name: "World" }),
        "Hello, World!",
    );
    assert.equal(plugin.t("de", "greeting", { name: "Welt" }), "Hallo, Welt!");
});

test("fluent: selects a plural variant from count", async () => {
    const i18next = await createInstance(false);
    const plugin = new I18next({ i18next });
    await plugin.ready();

    assert.equal(plugin.t("en", "items", { count: 1 }), "1 item");
    assert.equal(plugin.t("en", "items", { count: 5 }), "5 items");
    assert.equal(plugin.t("de", "items", { count: 1 }), "1 Eintrag");
    assert.equal(plugin.t("de", "items", { count: 5 }), "5 Einträge");
});

test("fluent: resolves message attributes", async () => {
    const i18next = await createInstance(false);
    const plugin = new I18next({ i18next });
    await plugin.ready();

    assert.equal(plugin.t("en", "report"), "Report");
    assert.equal(plugin.t("en", "report.tooltip"), "Report this message");
    assert.equal(plugin.t("de", "report.tooltip"), "Diese Nachricht melden");
});

test("fluent: bidi isolation is on by default", async () => {
    const i18next = await createInstance(true);
    const plugin = new I18next({ i18next });
    await plugin.ready();

    assert.equal(
        plugin.t("en", "greeting", { name: "World" }),
        "Hello, ⁨World⁩!",
    );
});
