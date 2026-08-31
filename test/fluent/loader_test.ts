import { expect } from "@std/expect";
import { fromFileUrl, relative, resolve } from "@std/path";
import { loadFluentLocales } from "../../src/loader/fluent.ts";
import { createFluentI18next } from "../../src/fluent/mod.ts";

const FSI = "⁨";
const PDI = "⁩";

const LOCALES = fromFileUrl(
    new URL("../fixtures/fluent/locales", import.meta.url),
);
const EMPTY = fromFileUrl(new URL("../fixtures/fluent/empty", import.meta.url));

Deno.test("detects locales from flat files and from directories", async () => {
    const locales = await loadFluentLocales(LOCALES);
    expect(Object.keys(locales).sort()).toEqual(["de", "en"]);
    expect(locales.en).toBe(
        "hello = Hello\ngreeting = Hello, { $name }!\n",
    );
});

Deno.test("concatenates a locale directory in sorted path order", async () => {
    const locales = await loadFluentLocales(LOCALES);
    // "de/extra/more.ftl" sorts before "de/main.ftl".
    expect(locales.de).toBe(
        "greeting = Hallo, { $name }!\n" + "\n" + "hello = Hallo\n",
    );
});

Deno.test("ignores files that are not .ftl", async () => {
    const locales = await loadFluentLocales(LOCALES);
    expect(locales.notes).toBeUndefined();
    expect(locales.de).not.toContain("not a locale file");
    expect(locales.en).not.toContain("not a locale file");
});

Deno.test("throws when the directory holds no Fluent files", async () => {
    await expect(loadFluentLocales(EMPTY)).rejects.toThrow(
        `No Fluent locales found in '${EMPTY}'`,
    );
});

Deno.test("accepts an absolute and a relative path alike", async () => {
    const absolute = await loadFluentLocales(resolve(LOCALES));
    const relativePath = `./${relative(Deno.cwd(), LOCALES)}`;
    const loaded = await loadFluentLocales(relativePath);
    expect(loaded).toEqual(absolute);
});

Deno.test("feeds createFluentI18next end to end", async () => {
    const i18next = await createFluentI18next({
        defaultLocale: "en",
        resources: await loadFluentLocales(LOCALES),
        onError: () => {},
    });
    expect(i18next.getFixedT("en")("hello")).toBe("Hello");
    expect(i18next.getFixedT("de")("hello")).toBe("Hallo");
    expect(i18next.getFixedT("de-DE")("greeting", { name: "Welt" })).toBe(
        `Hallo, ${FSI}Welt${PDI}!`,
    );
});
