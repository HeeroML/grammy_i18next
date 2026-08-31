/**
 * Entrypoint surface smoke test.
 *
 * Guards the five published entrypoints (`.`, `./v2`, `./v1`, `./fluent`,
 * `./loader`) against accidental additions or removals, and pins the promise
 * that the root entrypoint *is* the grammY 2 entrypoint rather than a copy of
 * it. Only runtime exports are visible here; types are erased in every runtime.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as root from "../src/mod.ts";
import * as v2 from "../src/v2/mod.ts";
import * as v1 from "../src/v1/mod.ts";
import * as fluent from "../src/fluent/mod.ts";
import * as loader from "../src/loader/mod.ts";

const VERSION_EXPORTS = [
    "I18n",
    "I18next",
    "defaultLocaleNegotiator",
    "sessionLocaleStore",
];

function names(mod: object): string[] {
    return Object.keys(mod).sort();
}

test("exports: ./v2 has the documented surface", () => {
    assert.deepEqual(names(v2), VERSION_EXPORTS);
});

test("exports: ./v1 has the same surface as ./v2", () => {
    assert.deepEqual(names(v1), VERSION_EXPORTS);
});

test("exports: the root entrypoint is ./v2", () => {
    assert.deepEqual(names(root), VERSION_EXPORTS);
    for (const key of VERSION_EXPORTS) {
        assert.equal(
            (root as Record<string, unknown>)[key],
            (v2 as Record<string, unknown>)[key],
            `root.${key} is not the same object as v2.${key}`,
        );
    }
});

test("exports: I18n is an alias of I18next", () => {
    assert.equal(v2.I18n, v2.I18next);
    assert.equal(v1.I18n, v1.I18next);
    assert.equal(typeof v2.I18next, "function");
});

test("exports: ./fluent has the documented surface", () => {
    assert.deepEqual(names(fluent), [
        "FLUENT_SOURCE_KEY",
        "FluentFormat",
        "createFluentFormat",
        "createFluentI18next",
        "fluentSource",
    ]);
});

test("exports: ./loader has the documented surface", () => {
    assert.deepEqual(names(loader), ["loadFluentLocales", "loadLocales"]);
});
