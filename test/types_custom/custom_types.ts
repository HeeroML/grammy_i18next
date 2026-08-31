/**
 * Type-level tests for i18next's `CustomTypeOptions` augmentation. The
 * augmentation is program-wide, so this file lives in its own directory that
 * is type checked separately from the rest of the test suite. It is only type
 * checked, never executed.
 */
import type { Context as ContextV1 } from "grammy";
import type { Context as ContextV2 } from "@grammyjs/grammy";
import type { TFunction } from "i18next";
import { I18next as I18nextV1 } from "../../src/v1/mod.ts";
import type { I18nextFlavor as FlavorV1 } from "../../src/v1/mod.ts";
import { I18next as I18nextV2 } from "../../src/v2/mod.ts";
import type { I18nextFlavor as FlavorV2 } from "../../src/v2/mod.ts";

declare module "i18next" {
    interface CustomTypeOptions {
        defaultNS: "main";
        resources: {
            main: { greeting: string };
            errors: { timeout: string };
        };
    }
}

/** Asserts that `value` is assignable to `T`. */
function expectType<T>(_value: T): void {}

declare const v1: FlavorV1<ContextV1>;
declare const v2: FlavorV2<ContextV2>;

// The default namespace determines the keys of `ctx.t`.
expectType<string>(v1.t("greeting"));
expectType<string>(v2.t("greeting"));
expectType<string>(v1.translate("greeting"));

// @ts-expect-error - "nope" is not a key of the "main" namespace.
export const unknownKeyV1: string = v1.t("nope");
// @ts-expect-error - "nope" is not a key of the "main" namespace.
export const unknownKeyV2: string = v2.t("nope");
// @ts-expect-error - "timeout" lives in the "errors" namespace.
export const wrongNamespace: string = v1.t("timeout");

// Binding a namespace changes the keys of `ctx.t`.
declare const scopedV1: FlavorV1<ContextV1, "errors">;
declare const scopedV2: FlavorV2<ContextV2, "errors">;
expectType<TFunction<"errors">>(scopedV1.t);
expectType<TFunction<"errors">>(scopedV2.t);
expectType<string>(scopedV1.t("timeout"));
expectType<string>(scopedV2.t("timeout"));

// @ts-expect-error - "greeting" lives in the "main" namespace.
export const outOfNamespace: string = scopedV1.t("greeting");

export const scopedPluginV1: I18nextV1<ContextV1, "errors"> = new I18nextV1<
    ContextV1,
    "errors"
>({ initOptions: { fallbackLng: "en" }, ns: "errors" });
export const scopedPluginV2: I18nextV2<ContextV2, "errors"> = new I18nextV2<
    ContextV2,
    "errors"
>({ initOptions: { fallbackLng: "en" }, ns: "errors" });

// The middleware of a namespace-bound plugin produces a namespace-bound
// `ctx.t`.
export const middlewareV1 = scopedPluginV1.middleware();
export const middlewareV2 = scopedPluginV2.middleware();
declare const contextV1: Parameters<typeof middlewareV1>[0];
declare const contextV2: Parameters<typeof middlewareV2>[0];
expectType<TFunction<"errors">>(contextV1.t);
expectType<TFunction<"errors">>(contextV2.t);
