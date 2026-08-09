import { expect } from "@std/expect";
import { fileURLToPath } from "node:url";
import { I18next, loadLocales } from "../src/mod.ts";
import { applyMiddleware, makeContext } from "./helpers.ts";

function fixture(name: string): string {
    return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

Deno.test("loads locale directories with namespaces", async () => {
    const resources = await loadLocales(fixture("locales"));
    expect(resources).toEqual({
        en: {
            main: { greeting: "Hello" },
            "errors/api": { timeout: "Timed out" },
        },
        de: {
            translation: { greeting: "Hallo" },
        },
    });
});

Deno.test("loaded resources work end-to-end in the plugin", async () => {
    const plugin = new I18next({
        initOptions: {
            fallbackLng: "en",
            defaultNS: "main",
            resources: await loadLocales(fixture("locales")),
        },
    });
    const ctx = await applyMiddleware(plugin, makeContext());
    expect(ctx.t("greeting")).toBe("Hello");
    expect(ctx.t("timeout", { ns: "errors/api" })).toBe("Timed out");
});

Deno.test("throws when the directory contains no locales", async () => {
    await expect(loadLocales(fixture("empty"))).rejects.toThrow(
        "No locales found",
    );
});

Deno.test("does not treat directories without JSON files as locales", async () => {
    // "no-json" contains only en/notes.txt, which must not register an
    // empty "en" locale that would silently translate nothing.
    await expect(loadLocales(fixture("no-json"))).rejects.toThrow(
        "No locales found",
    );
});

Deno.test("throws a descriptive error for invalid JSON", async () => {
    await expect(loadLocales(fixture("invalid"))).rejects.toThrow(
        "Invalid JSON in locale file",
    );
});
