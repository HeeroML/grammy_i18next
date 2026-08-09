import { Api, Context } from "@grammyjs/grammy";
import type { Update, UserFromGetMe } from "@grammyjs/grammy/types";
import type { Resource } from "i18next";
import { I18next } from "../src/mod.ts";
import type { I18nextFlavor, I18nextOptions } from "../src/mod.ts";

export const botInfo: UserFromGetMe = {
    id: 42,
    is_bot: true,
    first_name: "Test Bot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    supports_guest_queries: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
};

export const resources: Resource = {
    en: {
        translation: {
            greeting: "Hello",
            items_one: "{{count}} item",
            items_other: "{{count}} items",
            button: { report: "Report" },
        },
    },
    de: {
        translation: {
            greeting: "Hallo",
            button: { report: "Melden" },
        },
    },
};

let nextId = 0;

export function messageUpdate(text: string, languageCode?: string): Update {
    nextId++;
    return {
        update_id: nextId,
        message: {
            message_id: nextId,
            date: 1_691_500_000,
            chat: { id: 1234, type: "private", first_name: "Test" },
            from: {
                id: 1234,
                is_bot: false,
                first_name: "Test",
                ...(languageCode === undefined
                    ? {}
                    : { language_code: languageCode }),
            },
            text,
        },
    };
}

export function makeContext(
    update: Update = messageUpdate("hi"),
): I18nextFlavor<Context> {
    const ctx = new Context(update, new Api("dummy-token"), botInfo);
    // The middleware of the plugin installs `t` and `i18n` at runtime.
    return ctx as I18nextFlavor<Context>;
}

export function makePlugin(
    options: Partial<I18nextOptions> = {},
): I18next {
    return new I18next({
        initOptions: { fallbackLng: "en", resources },
        ...options,
    });
}

export async function applyMiddleware(
    plugin: I18next,
    ctx: I18nextFlavor<Context>,
    next: () => Promise<void> = () => Promise.resolve(),
): Promise<I18nextFlavor<Context>> {
    await plugin.middleware()(ctx, next);
    return ctx;
}
