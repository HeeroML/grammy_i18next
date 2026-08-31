import type { Resource } from "i18next";

/**
 * The bot user both majors are told about. Every field of `UserFromGetMe` is
 * set explicitly (including `supports_guest_queries`, which grammY 1.x types as
 * optional and grammY 2.x does not) so that this single fixture satisfies the
 * `UserFromGetMe` type of both majors.
 */
export interface BotInfoFixture {
    id: number;
    is_bot: true;
    first_name: string;
    username: string;
    can_join_groups: boolean;
    can_read_all_group_messages: boolean;
    supports_inline_queries: boolean;
    supports_guest_queries: boolean;
    can_connect_to_business: boolean;
    has_main_web_app: boolean;
    has_topics_enabled: boolean;
    allows_users_to_create_topics: boolean;
    can_manage_bots: boolean;
    supports_join_request_queries: boolean;
}

/** The bot user used by every integration test. */
export const botInfo: BotInfoFixture = {
    id: 42,
    is_bot: true,
    first_name: "Test Bot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    supports_guest_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
};

/** A photo size as it appears in a captioned message. */
export interface PhotoFixture {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
}

/** A message update that is structurally valid for both grammY majors. */
export interface UpdateFixture {
    update_id: number;
    message: {
        message_id: number;
        date: number;
        chat: { id: number; type: "private"; first_name: string };
        from: {
            id: number;
            is_bot: false;
            first_name: string;
            language_code?: string;
        };
        text?: string;
        caption?: string;
        photo?: PhotoFixture[];
    };
}

/** The resources every test bot is initialized with. */
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

/**
 * Builds a private text message update.
 *
 * @param text The message text.
 * @param languageCode The `language_code` of the sender, if any.
 * @param userId The id of the sender, defaults to `1234`.
 */
export function messageUpdate(
    text: string,
    languageCode?: string,
    userId = 1234,
): UpdateFixture {
    const update = baseUpdate(languageCode, userId);
    update.message.text = text;
    return update;
}

/**
 * Builds a private photo message update with a caption. grammY matches
 * captions in `hasText` just like message texts.
 *
 * @param caption The photo caption.
 * @param languageCode The `language_code` of the sender, if any.
 * @param userId The id of the sender, defaults to `1234`.
 */
export function captionUpdate(
    caption: string,
    languageCode?: string,
    userId = 1234,
): UpdateFixture {
    const update = baseUpdate(languageCode, userId);
    update.message.caption = caption;
    update.message.photo = [{
        file_id: "photo-id",
        file_unique_id: "photo-unique-id",
        width: 1,
        height: 1,
    }];
    return update;
}

function baseUpdate(
    languageCode: string | undefined,
    userId: number,
): UpdateFixture {
    nextId++;
    return {
        update_id: nextId,
        message: {
            message_id: nextId,
            date: 1_691_500_000,
            chat: { id: userId, type: "private", first_name: "Test" },
            from: {
                id: userId,
                is_bot: false,
                first_name: "Test",
                ...(languageCode === undefined
                    ? {}
                    : { language_code: languageCode }),
            },
        },
    };
}

/** A minimal i18next backend that serves resources from an in-memory map. */
export interface FakeBackend {
    type: "backend";
    init(): void;
    read(
        language: string,
        namespace: string,
        callback: (error: unknown, resources?: object) => void,
    ): void;
    /** Every `language:namespace` pair the backend was asked for. */
    readonly requested: string[];
}

/**
 * Creates a lazy-loading i18next backend over the given data, so tests can
 * observe which locales and namespaces the plugin actually requests.
 *
 * @param data Resources keyed by locale and namespace.
 * @param failFor Locales for which the backend reports an error.
 */
export function fakeBackend(
    data: Record<string, Record<string, object>>,
    failFor: string[] = [],
): FakeBackend {
    const requested: string[] = [];
    return {
        type: "backend",
        requested,
        init(): void {},
        read(language, namespace, callback): void {
            requested.push(`${language}:${namespace}`);
            if (failFor.includes(language)) {
                callback(new Error(`backend is down for '${language}'`));
                return;
            }
            callback(null, data[language]?.[namespace] ?? {});
        },
    };
}
