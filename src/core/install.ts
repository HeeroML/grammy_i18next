import type { Namespace, TFunction } from "i18next";
import type { I18nextControls } from "./types.ts";

/** The context properties the plugin installs and removes again. */
const PROPERTIES = ["t", "translate", "i18n"] as const;

/**
 * What to install on the context object.
 */
export interface InstallOptions<Ns extends Namespace> {
    /**
     * Returns the translation function that `ctx.t` and `ctx.translate` should
     * currently resolve to. It is called on every property access so that
     * locale changes made via `ctx.i18n.useLocale` are picked up immediately.
     */
    getTranslate(): TFunction<Ns>;
    /** The controls to install as `ctx.i18n`. */
    controls: I18nextControls;
}

/**
 * Installs `ctx.t`, `ctx.translate`, and `ctx.i18n` on the given context
 * object and returns a function that undoes the installation.
 *
 * The context object is never cloned or replaced—grammY plugins such as
 * `@grammyjs/conversations` rely on object identity. The properties are
 * defined as non-enumerable and configurable, so they do not show up in
 * `Object.keys(ctx)`, spreads, or `JSON.stringify`, and can be replaced by a
 * nested plugin instance.
 *
 * Own descriptors that existed before are snapshotted and restored by the
 * returned function; properties that did not exist before are deleted again.
 * That makes nested and duplicate plugin installations behave like ordinary
 * onion middleware.
 *
 * @param ctx The context object to install the properties on.
 * @param options The translator accessor and the controls to install.
 * @returns A function that restores the previous state of the context object.
 */
export function installI18nextProperties<Ns extends Namespace>(
    ctx: object,
    options: InstallOptions<Ns>,
): () => void {
    const previous = PROPERTIES.map((property) =>
        [property, Object.getOwnPropertyDescriptor(ctx, property)] as const
    );

    const translator = {
        configurable: true,
        enumerable: false,
        get: () => options.getTranslate(),
    };
    Object.defineProperty(ctx, "t", translator);
    Object.defineProperty(ctx, "translate", translator);
    Object.defineProperty(ctx, "i18n", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: options.controls,
    });

    return () => {
        for (const [property, descriptor] of previous) {
            if (descriptor === undefined) {
                Reflect.deleteProperty(ctx, property);
            } else {
                Object.defineProperty(ctx, property, descriptor);
            }
        }
    };
}
