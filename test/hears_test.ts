import { expect } from "@std/expect";
import {
    applyMiddleware,
    makeContext,
    makePlugin,
    messageUpdate,
} from "./helpers.ts";

Deno.test("hears matches translated text in any locale by default", async () => {
    const plugin = makePlugin();
    // A user without a language presses a button rendered in German.
    const ctx = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("Melden")),
    );
    expect(plugin.hears("button.report")(ctx)).toBe(true);
});

Deno.test("hears in current-locale mode only matches the negotiated locale", async () => {
    const plugin = makePlugin();
    const english = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("Melden")),
    );
    expect(
        plugin.hears("button.report", { mode: "current-locale" })(english),
    ).toBe(false);

    const german = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("Melden", "de")),
    );
    expect(
        plugin.hears("button.report", { mode: "current-locale" })(german),
    ).toBe(true);
});

Deno.test("hears does not match unrelated text", async () => {
    const plugin = makePlugin();
    const ctx = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("something else")),
    );
    expect(plugin.hears("button.report")(ctx)).toBe(false);
});

Deno.test("hears supports interpolation variables", async () => {
    const plugin = makePlugin();
    const ctx = await applyMiddleware(
        plugin,
        makeContext(messageUpdate("3 items")),
    );
    expect(plugin.hears("items", { variables: { count: 3 } })(ctx)).toBe(true);
    expect(plugin.hears("items", { variables: { count: 4 } })(ctx)).toBe(false);
});
