import type { ContextLike } from "./types.ts";

/**
 * The locale negotiator used when no custom negotiator is configured. It reads
 * the {@link https://en.wikipedia.org/wiki/IETF_language_tag | IETF language tag}
 * of the user from the incoming update (`ctx.from?.language_code`), which may
 * be `undefined` for updates without a user or when the user's client did not
 * send a language.
 *
 * @param ctx The context object of the current update.
 * @returns The user's language code, or `undefined` if unknown.
 */
export function defaultLocaleNegotiator(ctx: ContextLike): string | undefined {
    return ctx.from?.language_code;
}
