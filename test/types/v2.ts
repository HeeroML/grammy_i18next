/**
 * Type-level tests for the grammY 2.x bindings. This file is only type
 * checked, never executed.
 */
import { Bot, type Context } from "@grammyjs/grammy";
import type { i18n, TFunction } from "i18next";
import {
    defaultLocaleNegotiator,
    type I18n,
    I18next,
    type I18nextControls,
    type I18nextFlavor,
    type I18nFlavor,
    type LocaleNegotiator,
    type LocaleStore,
    sessionLocaleStore,
} from "../../src/v2/mod.ts";

/** Asserts that `value` is assignable to `T`. */
function expectType<T>(_value: T): void {}
/** Asserts that its type argument resolves to `true`. */
function expectTrue<_T extends true>(): void {}

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;

interface MySession {
    count: number;
    locale?: string;
}
/** A transformative flavor of some other plugin. */
type OtherFlavor<C> = C & { other: number };

// grammY 2.x ships no session plugin, so the session flavor is spelled out.
interface SessionFlavor<S> {
    session: S;
}
type BaseContext = OtherFlavor<Context & SessionFlavor<MySession>>;
type MyContext = I18nextFlavor<BaseContext>;

declare const ctx: MyContext;

// The flavor adds its own properties...
expectType<TFunction>(ctx.t);
expectType<TFunction>(ctx.translate);
expectType<I18nextControls>(ctx.i18n);
// ...and keeps everything the wrapped context had.
expectType<MySession>(ctx.session);
expectType<number>(ctx.other);
expectType<number>(ctx.update.update_id);

// The controls have exact return types.
expectTrue<Equals<ReturnType<MyContext["i18n"]["getLocale"]>, string>>();
expectTrue<Equals<ReturnType<MyContext["i18n"]["useLocale"]>, Promise<void>>>();
expectTrue<Equals<ReturnType<MyContext["i18n"]["setLocale"]>, Promise<void>>>();
expectTrue<
    Equals<ReturnType<MyContext["i18n"]["renegotiate"]>, Promise<string>>
>();
expectTrue<
    Equals<ReturnType<MyContext["i18n"]["renegotiateLocale"]>, Promise<string>>
>();
expectType<i18n>(ctx.i18n.instance);

// The compatibility aliases are the very same types.
expectTrue<Equals<I18n<BaseContext>, I18next<BaseContext>>>();
expectTrue<Equals<I18nFlavor<BaseContext>, MyContext>>();

// Negotiators and stores receive the full context type.
export const negotiator: LocaleNegotiator<MyContext> = (ctx) => {
    expectType<MySession>(ctx.session);
    expectType<number>(ctx.other);
    return ctx.from?.language_code;
};
export const store: LocaleStore<MyContext> = {
    read: (ctx) => ctx.session.locale,
    write: (ctx, locale) => {
        ctx.session.locale = locale;
    },
};
export const fromSession: LocaleStore<MyContext> = sessionLocaleStore();
export const fallbackNegotiator: LocaleNegotiator<MyContext> =
    defaultLocaleNegotiator;

export const plugin: I18next<MyContext> = new I18next<MyContext>({
    initOptions: { fallbackLng: "en" },
    localeNegotiator: negotiator,
    localeStore: store,
});

const bot = new Bot<MyContext>("42:dummy-token");
bot.use(plugin);
bot.filter(plugin.hears("button.report"), (ctx) => {
    expectType<TFunction>(ctx.t);
    expectType<MySession>(ctx.session);
    // grammY 2.x reports string matches through `ctx.payload`.
    expectType<string>(ctx.payload);
});

declare const plain: Context;
// @ts-expect-error - `t` only exists after applying the flavor.
export const missingT: unknown = plain.t;
// @ts-expect-error - `i18n` only exists after applying the flavor.
export const missingControls: unknown = plain.i18n;
// @ts-expect-error - locales are strings.
export const badLocale: Promise<void> = ctx.i18n.useLocale(1);
export const badStore: LocaleStore<Context> = {
    // @ts-expect-error - the plain context has no session.
    read: (ctx) => ctx.session.locale,
    write: () => {},
};
