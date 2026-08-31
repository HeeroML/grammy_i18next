import { expect } from "@std/expect";
import { defaultLocaleNegotiator } from "../../src/core/negotiator.ts";
import { makeContext } from "./helpers.ts";

Deno.test("the default negotiator reads from.language_code", () => {
    expect(defaultLocaleNegotiator(makeContext("hi", "de"))).toBe("de");
});

Deno.test("the default negotiator returns undefined without a language", () => {
    expect(defaultLocaleNegotiator(makeContext("hi"))).toBeUndefined();
});

Deno.test("the default negotiator tolerates updates without a sender", () => {
    expect(defaultLocaleNegotiator({ hasText: () => false })).toBeUndefined();
});
