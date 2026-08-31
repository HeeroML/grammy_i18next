export { I18nextCore } from "./plugin.ts";
export { installI18nextProperties } from "./install.ts";
export type { InstallOptions } from "./install.ts";
export { firstFallbackLocale, normalizeLocale } from "./locale.ts";
export { defaultLocaleNegotiator } from "./negotiator.ts";
export { sessionLocaleStore } from "./session.ts";
export type { SessionLocaleStoreOptions } from "./session.ts";
export type {
    ContextLike,
    I18nextControls,
    I18nextFlavor,
    I18nextHearsOptions,
    I18nextOptions,
    LocaleNegotiator,
    LocaleStore,
    MaybePromise,
} from "./types.ts";
