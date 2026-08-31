import { expect } from "@std/expect";
import { inMiddleware, makeContext, makePlugin } from "./helpers.ts";

Deno.test("useLocale rebinds ctx.t synchronously for loaded locales", async () => {
    await inMiddleware(makePlugin(), makeContext("hi", "de"), async (ctx) => {
        expect(ctx.t("greeting")).toBe("Hallo");
        const pending = ctx.i18n.useLocale("en");
        // Deliberately read before awaiting: nothing has to be loaded, so the
        // translator is already rebound.
        expect(ctx.i18n.getLocale()).toBe("en");
        expect(ctx.t("greeting")).toBe("Hello");
        await pending;
        expect(ctx.t("greeting")).toBe("Hello");
    });
});

Deno.test("useLocale rejects empty locales", async () => {
    await inMiddleware(makePlugin(), makeContext(), async (ctx) => {
        await expect(ctx.i18n.useLocale("")).rejects.toThrow(
            "Cannot use an empty locale",
        );
        expect(ctx.i18n.getLocale()).toBe("en");
    });
});

Deno.test("renegotiate and renegotiateLocale re-run the negotiator", async () => {
    let negotiated: string | undefined = "de";
    const plugin = makePlugin({ localeNegotiator: () => negotiated });
    await inMiddleware(plugin, makeContext(), async (ctx) => {
        expect(ctx.t("greeting")).toBe("Hallo");
        negotiated = undefined;
        expect(await ctx.i18n.renegotiate()).toBe("en");
        expect(ctx.t("greeting")).toBe("Hello");
        negotiated = "de";
        expect(await ctx.i18n.renegotiateLocale()).toBe("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
});

Deno.test("renegotiate and renegotiateLocale are the same function", async () => {
    await inMiddleware(makePlugin(), makeContext(), (ctx) => {
        expect(ctx.i18n.renegotiate).toBe(ctx.i18n.renegotiateLocale);
    });
});

Deno.test("ctx.i18n.instance is the shared i18next instance", async () => {
    const plugin = makePlugin();
    await inMiddleware(plugin, makeContext(), (ctx) => {
        expect(ctx.i18n.instance).toBe(plugin.instance);
    });
});

Deno.test("a failing locale store write keeps the locale in flight", async () => {
    const plugin = makePlugin({
        localeStore: {
            read: () => undefined,
            write: () => Promise.reject(new Error("disk is full")),
        },
    });
    await inMiddleware(plugin, makeContext(), async (ctx) => {
        await expect(ctx.i18n.setLocale("de")).rejects.toThrow("disk is full");
        expect(ctx.i18n.getLocale()).toBe("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
});

Deno.test("a failing locale store read rejects the middleware", async () => {
    const plugin = makePlugin({
        localeStore: {
            read: () => Promise.reject(new Error("store is down")),
            write: () => {},
        },
    });
    let reached = false;
    await expect(
        inMiddleware(plugin, makeContext(), () => {
            reached = true;
        }),
    ).rejects.toThrow("store is down");
    expect(reached).toBe(false);
});

Deno.test("a failing negotiator rejects the middleware", async () => {
    const plugin = makePlugin({
        localeNegotiator: () => Promise.reject(new Error("no idea")),
    });
    await expect(inMiddleware(plugin, makeContext(), () => {})).rejects
        .toThrow("no idea");
});

Deno.test("setLocale without a store just switches the locale", async () => {
    await inMiddleware(makePlugin(), makeContext(), async (ctx) => {
        await ctx.i18n.setLocale("de");
        expect(ctx.t("greeting")).toBe("Hallo");
    });
});
