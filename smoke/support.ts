/**
 * Runtime-agnostic fixtures shared by the smoke tests.
 *
 * Nothing in `./smoke` may touch `Deno.*` or `Bun.*` globals: the very point
 * of these files is that the same bytes run under `node --test`,
 * `bun test smoke` and `deno test -R ./smoke/`. Paths are therefore resolved
 * from `import.meta.url` via `node:url`, never from a runtime-specific cwd
 * helper.
 */

import { fileURLToPath } from "node:url";

/**
 * A fully populated `getMe` payload.
 *
 * Every boolean documented for `UserFromGetMe` is present (including
 * `supports_guest_queries`, which grammY 1 declares optional and grammY 2
 * declares required) so the same literal satisfies both majors.
 */
export const botInfo = {
    id: 42,
    is_bot: true as const,
    first_name: "Test Bot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_guest_queries: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
};

/** i18next resources used by the grammY 1 and grammY 2 smoke tests. */
export const resources = {
    en: {
        translation: {
            greeting: "Hello",
            items_one: "{{count}} item",
            items_other: "{{count}} items",
            report: "Report",
        },
    },
    de: {
        translation: {
            greeting: "Hallo",
            report: "Melden",
        },
    },
};

let nextId = 0;

/** Builds a private-chat text message update. */
export function messageUpdate(
    text: string,
    languageCode?: string,
): Record<string, unknown> {
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

/** One intercepted Bot API call. */
export interface ApiCall {
    method: string;
    payload: Record<string, unknown>;
}

/**
 * A canned `ApiResponse` for an intercepted call. Enough for grammY to hand
 * a `Message` back to the handler without any network access.
 */
export function stubResponse(): unknown {
    return {
        ok: true,
        result: {
            message_id: 1,
            date: 1_691_500_000,
            chat: { id: 1234, type: "private", first_name: "Test" },
        },
    };
}

/** Absolute path of a file or directory below the repository root. */
export function repoPath(relative: string): string {
    return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}
