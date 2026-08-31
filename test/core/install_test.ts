import { expect } from "@std/expect";
import type { TFunction } from "i18next";
import { installI18nextProperties } from "../../src/core/install.ts";
import type { I18nextControls } from "../../src/core/types.ts";
import {
    applyMiddleware,
    inMiddleware,
    makeContext,
    makePlugin,
} from "./helpers.ts";

const PROPERTIES = ["t", "translate", "i18n"] as const;

Deno.test("installs t, translate, and i18n as hidden properties", async () => {
    await inMiddleware(makePlugin(), makeContext(), (ctx) => {
        expect(Object.keys(ctx)).not.toContain("t");
        expect(Object.keys(ctx)).not.toContain("translate");
        expect(Object.keys(ctx)).not.toContain("i18n");
        expect(JSON.stringify({ ...ctx })).not.toContain("translate");
        for (const property of PROPERTIES) {
            const descriptor = Object.getOwnPropertyDescriptor(ctx, property);
            expect(descriptor?.enumerable).toBe(false);
            expect(descriptor?.configurable).toBe(true);
        }
    });
});

Deno.test("ctx.t and ctx.translate are the same function", async () => {
    await inMiddleware(makePlugin(), makeContext(), async (ctx) => {
        expect(ctx.t).toBe(ctx.translate);
        expect(ctx.translate("greeting")).toBe("Hello");
        await ctx.i18n.useLocale("de");
        // Both still point at the very same, now rebound, translator.
        expect(ctx.t).toBe(ctx.translate);
        expect(ctx.translate("greeting")).toBe("Hallo");
    });
});

Deno.test("deletes the properties again when none existed before", async () => {
    const ctx = makeContext();
    await inMiddleware(makePlugin(), ctx, () => {});
    for (const property of PROPERTIES) {
        expect(Object.hasOwn(ctx, property)).toBe(false);
    }
});

Deno.test("restores properties that existed before", async () => {
    const ctx = makeContext();
    const earlier = (() => "earlier") as unknown as TFunction;
    Object.defineProperty(ctx, "t", {
        configurable: true,
        enumerable: false,
        value: earlier,
        writable: true,
    });
    await inMiddleware(makePlugin(), ctx, (installed) => {
        expect(installed.t("greeting")).toBe("Hello");
    });
    expect(ctx.t).toBe(earlier);
    expect(Object.hasOwn(ctx, "translate")).toBe(false);
    expect(Object.hasOwn(ctx, "i18n")).toBe(false);
});

Deno.test("restores the properties when downstream middleware throws", async () => {
    const ctx = makeContext();
    await expect(
        applyMiddleware(
            makePlugin(),
            ctx,
            () => Promise.reject(new Error("handler exploded")),
        ),
    ).rejects.toThrow("handler exploded");
    for (const property of PROPERTIES) {
        expect(Object.hasOwn(ctx, property)).toBe(false);
    }
});

Deno.test("restores the properties when the negotiator throws", async () => {
    const ctx = makeContext();
    const plugin = makePlugin({
        localeNegotiator: () => Promise.reject(new Error("no idea")),
    });
    await expect(applyMiddleware(plugin, ctx)).rejects.toThrow("no idea");
    for (const property of PROPERTIES) {
        expect(Object.hasOwn(ctx, property)).toBe(false);
    }
});

Deno.test("the low-level installer snapshots and restores descriptors", () => {
    const controls = { getLocale: () => "en" } as unknown as I18nextControls;
    const translate = (() => "hi") as unknown as TFunction;
    const target: Record<string, unknown> = { keep: 1 };

    const restore = installI18nextProperties(target, {
        getTranslate: () => translate,
        controls,
    });
    expect(target.t).toBe(translate);
    expect(target.translate).toBe(translate);
    expect(target.i18n).toBe(controls);
    expect(Object.keys(target)).toEqual(["keep"]);

    restore();
    expect(Object.keys(target)).toEqual(["keep"]);
    expect(Object.hasOwn(target, "t")).toBe(false);
});
