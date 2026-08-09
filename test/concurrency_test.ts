import { expect } from "@std/expect";
import {
    applyMiddleware,
    makeContext,
    makePlugin,
    messageUpdate,
} from "./helpers.ts";

Deno.test("locales do not bleed across concurrently processed updates", async () => {
    const plugin = makePlugin();
    const german = makeContext(messageUpdate("hi", "de"));
    const english = makeContext(messageUpdate("hi"));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const translations: string[] = [];

    // Handle the German update, but keep its handler suspended...
    const suspended = applyMiddleware(plugin, german, async () => {
        await gate;
        translations.push(german.t("greeting"));
    });

    // ...while a full English update is processed in the meantime.
    await applyMiddleware(plugin, english, () => {
        translations.push(english.t("greeting"));
        return Promise.resolve();
    });

    release();
    await suspended;

    // The English update finished first, but the German update still
    // translates into German afterwards.
    expect(translations).toEqual(["Hello", "Hallo"]);
    expect(german.i18n.getLocale()).toBe("de");
    expect(english.i18n.getLocale()).toBe("en");
});

Deno.test("many interleaved updates each keep their own locale", async () => {
    const plugin = makePlugin();
    const updates = Array.from({ length: 50 }, (_, i) => ({
        locale: i % 2 === 0 ? "de" : "en",
        expected: i % 2 === 0 ? "Hallo" : "Hello",
    }));

    await Promise.all(updates.map(async ({ locale, expected }) => {
        const ctx = makeContext(messageUpdate("hi", locale));
        await applyMiddleware(plugin, ctx, async () => {
            // Yield to the event loop a few times so handlers interleave.
            for (let i = 0; i < 3; i++) await Promise.resolve();
            expect(ctx.t("greeting")).toBe(expected);
        });
    }));
});
