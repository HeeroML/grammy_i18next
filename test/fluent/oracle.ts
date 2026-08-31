/**
 * Loads the differential-test oracle: the `Fluent` class of the published
 * `@grammyjs/i18n@1.1.2` npm build.
 *
 * The class itself needs no permissions — it only parses in-memory sources —
 * but the package is a `dnt` build whose modules pull in `@deno/shim-deno`,
 * and that shim's `which` → `isexe` dependency reads `process.env` while it is
 * being evaluated. Under `deno test -R` that read throws `NotCapable` and
 * takes the whole module graph down.
 *
 * Rather than widening the permissions of the whole test suite to `--allow-env`
 * just for a transitive dependency of a dev-only oracle, `Deno.env` is replaced
 * by an inert stub for the duration of the import and restored immediately
 * afterwards. Reads during that window return `undefined` instead of throwing,
 * so the stub is strictly more permissive than the surrounding sandbox and can
 * never make unrelated code fail.
 *
 * @module
 */

import type { Fluent } from "@grammyjs/i18n";

/** The constructor of the oracle's `Fluent` class. */
export type FluentClass = new (
    options?: { warningHandler?: () => void },
) => Fluent;

const INERT_ENV = {
    get: (): undefined => undefined,
    set: (): void => {},
    delete: (): void => {},
    has: (): boolean => false,
    toObject: (): Record<string, string> => ({}),
} as unknown as typeof Deno.env;

function setEnv(value: typeof Deno.env): void {
    Object.defineProperty(Deno, "env", {
        configurable: true,
        writable: true,
        enumerable: true,
        value,
    });
}

/**
 * Imports the oracle, working around the transitive environment access of its
 * `dnt` shim.
 *
 * @returns The `Fluent` class of `@grammyjs/i18n@1.1.2`.
 */
export async function loadOracle(): Promise<FluentClass> {
    const granted =
        (await Deno.permissions.query({ name: "env" })).state === "granted";
    if (granted) {
        const module = await import("@grammyjs/i18n");
        return module.Fluent as unknown as FluentClass;
    }
    const original = Deno.env;
    setEnv(INERT_ENV);
    try {
        const module = await import("@grammyjs/i18n");
        return module.Fluent as unknown as FluentClass;
    } finally {
        setEnv(original);
    }
}
