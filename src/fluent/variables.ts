import { FluentType } from "@fluent/bundle";
import type { FluentVariable } from "@fluent/bundle";

/**
 * Coerces an i18next `t()` options object into the argument record that
 * `FluentBundle.formatPattern` accepts.
 *
 * `@fluent/bundle` types `FluentVariable` permissively but throws at runtime
 * for anything that is not a string, a number, a `Date`, a Temporal-like
 * object or a `FluentType`. Booleans, `null`, plain objects and functions must
 * therefore be dropped rather than forwarded — i18next's option bag routinely
 * carries all of them (`returnObjects`, `interpolation`, `defaultValue`, …).
 *
 * When `options.replace` is a non-string object it replaces the option bag,
 * mirroring i18next's own interpolation rule—including that
 * `interpolation.defaultVariables` still apply underneath it. Otherwise every
 * own enumerable entry of `options` is considered (i18next has already merged
 * the default variables into it), so i18next's reserved keys pass through
 * whenever they happen to be strings or numbers. That is deliberate for
 * `count`, which is the natural source of Fluent's `$count`.
 *
 * @param options The option bag handed to `i18nFormat.parse`.
 * @param defaultVariables The instance's `interpolation.defaultVariables`,
 *     merged underneath `options.replace` when that is used.
 * @returns Variables safe to pass to `formatPattern`.
 */
export function toFluentVariables(
    options: unknown,
    defaultVariables?: Record<string, unknown>,
): Record<string, FluentVariable> {
    const variables: Record<string, FluentVariable> = {};
    if (typeof options !== "object" || options === null) return variables;
    const replace = (options as { replace?: unknown }).replace;
    const bag = typeof replace === "object" && replace !== null
        ? { ...defaultVariables, ...replace as Record<string, unknown> }
        : options as Record<string, unknown>;
    for (const key of Object.keys(bag)) {
        const value = bag[key];
        if (
            typeof value === "string" || typeof value === "number" ||
            value instanceof Date || value instanceof FluentType
        ) {
            variables[key] = value;
        }
    }
    return variables;
}
