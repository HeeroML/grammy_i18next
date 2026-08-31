/**
 * Browser/worker bundle guard rail.
 *
 * `scripts/assert-graphs.sh` proves the *Deno* graph of the browser-safe
 * entrypoints is free of `node:` builtins, but npm packages are opaque to
 * `deno info` -- it never looks inside `i18next` or `@fluent/bundle`. esbuild
 * does, so this is the second half of the same check: resolve every entrypoint
 * the way a bundler targeting a worker or a browser would, and fail if a Node
 * builtin or the Node-only `./loader` entrypoint shows up in the inputs.
 *
 * It also asserts the inverse for `./loader`: that entrypoint *must* fail to
 * bundle for the browser, because it is documented as Node/Deno/Bun only. A
 * successful build there would mean the documentation is wrong.
 *
 * Run with `npm run test:browser`.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Entrypoints that must bundle cleanly for a browser or worker target. */
const BROWSER_SAFE = [
    "src/mod.ts",
    "src/v2/mod.ts",
    "src/v1/mod.ts",
    "src/fluent/mod.ts",
];

/** Entrypoints that must *not* bundle for a browser target. */
const NODE_ONLY = ["src/loader/mod.ts"];

const OPTIONS = {
    absWorkingDir: root,
    bundle: true,
    platform: "browser",
    format: "esm",
    conditions: ["worker", "browser"],
    write: false,
    metafile: true,
    logLevel: "silent",
};

function formatBytes(bytes) {
    return `${(bytes / 1024).toFixed(1)} kB`;
}

let failed = false;

function fail(message) {
    console.error(`FAIL ${message}`);
    failed = true;
}

const rows = [];

for (const entry of BROWSER_SAFE) {
    let result;
    try {
        result = await build({ ...OPTIONS, entryPoints: [entry] });
    } catch (error) {
        fail(`${entry}: does not bundle for the browser`);
        for (const message of error.errors ?? [{ text: String(error) }]) {
            console.error(`       ${message.text}`);
        }
        continue;
    }

    const inputs = Object.keys(result.metafile.inputs);
    const builtins = inputs.filter((input) => input.startsWith("node:"));
    if (builtins.length > 0) {
        fail(`${entry}: bundles Node builtins: ${builtins.join(", ")}`);
    }
    const loader = inputs.filter((input) => /(^|\/)loader\//.test(input));
    if (loader.length > 0) {
        fail(`${entry}: bundles the Node-only loader: ${loader.join(", ")}`);
    }

    const bytes = result.outputFiles.reduce(
        (sum, file) => sum + file.contents.byteLength,
        0,
    );
    rows.push({ entry, bytes, inputs: inputs.length });
}

for (const entry of NODE_ONLY) {
    let bundled = false;
    try {
        await build({ ...OPTIONS, entryPoints: [entry] });
        bundled = true;
    } catch {
        // Expected: `./loader` imports node: builtins, which a browser target
        // cannot resolve. This is the documented contract, so it counts as a
        // pass.
    }
    if (bundled) {
        fail(
            `${entry}: bundled for the browser, but it is documented as Node-only`,
        );
    } else {
        rows.push({ entry, bytes: null, inputs: null });
    }
}

console.log();
console.log(
    `${"entrypoint".padEnd(20)}${"inputs".padStart(8)}${"bundle".padStart(12)}`,
);
console.log(
    `${"-".repeat(20)}${" -------".padStart(8)}${" -----------".padStart(12)}`,
);
for (const row of rows) {
    const inputs = row.inputs === null ? "n/a" : String(row.inputs);
    const bytes = row.bytes === null ? "browser: no" : formatBytes(row.bytes);
    console.log(
        `${row.entry.padEnd(20)}${inputs.padStart(8)}${bytes.padStart(12)}`,
    );
}
console.log();

if (failed) {
    console.error("browser bundle assertions FAILED");
    process.exit(1);
}
console.log("browser bundle assertions passed");
