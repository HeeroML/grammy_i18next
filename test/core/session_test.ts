import { expect } from "@std/expect";
import { sessionLocaleStore } from "../../src/core/session.ts";
import { inMiddleware, makeContext, makePlugin } from "./helpers.ts";

interface SessionCarrier {
    hasText(trigger: string[]): boolean;
    session: unknown;
}

function carrier(session: unknown): SessionCarrier {
    return { hasText: () => false, session };
}

Deno.test("reads and writes the @grammyjs/i18n session key by default", async () => {
    const store = sessionLocaleStore();
    const ctx = carrier({ __language_code: "de" });

    expect(await store.read(ctx)).toBe("de");
    await store.write(ctx, "fr");
    expect(ctx.session).toEqual({ __language_code: "fr" });
});

Deno.test("returns undefined when nothing is stored", async () => {
    const store = sessionLocaleStore();
    expect(await store.read(carrier({}))).toBeUndefined();
    expect(await store.read(carrier({ __language_code: 42 }))).toBeUndefined();
});

Deno.test("supports a custom session key", async () => {
    const store = sessionLocaleStore({ key: "lang" });
    const ctx = carrier({ lang: "de", __language_code: "en" });

    expect(await store.read(ctx)).toBe("de");
    await store.write(ctx, "fr");
    expect(ctx.session).toEqual({ lang: "fr", __language_code: "en" });
});

Deno.test("awaits lazy sessions", async () => {
    const data: Record<string, unknown> = { __language_code: "de" };
    const store = sessionLocaleStore();
    const ctx = carrier(Promise.resolve(data));

    expect(await store.read(ctx)).toBe("de");
    await store.write(ctx, "fr");
    expect(data).toEqual({ __language_code: "fr" });
});

Deno.test("explains that the session middleware is missing", async () => {
    const store = sessionLocaleStore();
    await expect(store.read(carrier(undefined))).rejects.toThrow(
        "session middleware must be installed before the i18next plugin",
    );
    await expect(store.write(carrier("nope"), "de")).rejects.toThrow(
        "session middleware must be installed before the i18next plugin",
    );
});

Deno.test("drives the plugin through the session store", async () => {
    const session: Record<string, unknown> = {};
    const store = sessionLocaleStore();
    const plugin = makePlugin({
        localeStore: {
            read: (ctx) => store.read({ ...ctx, session }),
            write: (ctx, locale) => store.write({ ...ctx, session }, locale),
        },
    });

    await inMiddleware(plugin, makeContext(), async (ctx) => {
        await ctx.i18n.setLocale("de");
    });
    expect(session).toEqual({ __language_code: "de" });

    await inMiddleware(plugin, makeContext("hi", "en"), (ctx) => {
        expect(ctx.t("greeting")).toBe("Hallo");
    });
});
