import { expect } from "@std/expect";
import { inMiddleware, makeContext, makePlugin } from "./helpers.ts";

Deno.test("hears matches translated text in any locale by default", async () => {
    const plugin = makePlugin();
    // A user without a language presses a button rendered in German.
    await inMiddleware(
        plugin,
        makeContext("Melden"),
        (ctx) => expect(plugin.hears("button.report")(ctx)).toBe(true),
    );
});

Deno.test("hears in current-locale mode only matches the negotiated locale", async () => {
    const plugin = makePlugin();
    const predicate = plugin.hears("button.report", {
        mode: "current-locale",
    });
    await inMiddleware(
        plugin,
        makeContext("Melden"),
        (ctx) => expect(predicate(ctx)).toBe(false),
    );
    await inMiddleware(
        plugin,
        makeContext("Melden", "de"),
        (ctx) => expect(predicate(ctx)).toBe(true),
    );
});

Deno.test("hears does not match unrelated text", async () => {
    const plugin = makePlugin();
    await inMiddleware(
        plugin,
        makeContext("something else"),
        (ctx) => expect(plugin.hears("button.report")(ctx)).toBe(false),
    );
});

Deno.test("hears supports interpolation variables", async () => {
    const plugin = makePlugin();
    await inMiddleware(plugin, makeContext("3 items"), (ctx) => {
        expect(plugin.hears("items", { variables: { count: 3 } })(ctx))
            .toBe(true);
        expect(plugin.hears("items", { variables: { count: 4 } })(ctx))
            .toBe(false);
    });
});

Deno.test("hears deduplicates identical translations", async () => {
    const plugin = makePlugin({
        initOptions: {
            fallbackLng: "en",
            resources: {
                en: { translation: { ok: "OK" } },
                de: { translation: { ok: "OK" } },
            },
        },
    });
    const seen: string[][] = [];
    await inMiddleware(plugin, makeContext("OK"), (ctx) => {
        // "all-locales" mode never reads `ctx.t`, so a spread copy (which
        // loses the non-enumerable properties) is enough to spy on `hasText`.
        const spy = {
            ...ctx,
            hasText: (trigger: string[]) => {
                seen.push(trigger);
                return ctx.hasText(trigger);
            },
        };
        expect(plugin.hears("ok")(spy)).toBe(true);
    });
    expect(seen).toEqual([["OK"]]);
});

Deno.test("hears restricts all-locales mode to supportedLocales", async () => {
    const plugin = makePlugin({ supportedLocales: ["en"] });
    expect(plugin.locales).toEqual(["en"]);
    await inMiddleware(
        plugin,
        makeContext("Melden"),
        (ctx) => expect(plugin.hears("button.report")(ctx)).toBe(false),
    );
});
