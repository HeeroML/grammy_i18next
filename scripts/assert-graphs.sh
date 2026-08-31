#!/usr/bin/env bash
#
# Module-graph guard rails for the published entrypoints.
#
# The package promises four things that no type checker can enforce:
#
#   a) ./v1 has no runtime edge to grammY 2 (and vice versa) -- both majors are
#      reached through `import type` only, which Deno erases.
#   b) ./v2 and the root have no runtime edge to grammY 1.
#   c) ./, ./v1, ./v2 and ./fluent have no runtime edge to any `node:` builtin
#      and do not drag in ./loader, so they stay usable on workers and in the
#      browser. Type-only `node:` edges (grammY 2 has some) are fine.
#   d) ./, ./v1 and ./v2 do not pull in ./fluent or @fluent/bundle, so native
#      i18next users do not pay for the Fluent bridge.
#
# `deno info --json` is the source of truth. Its `.modules[]` array also lists
# modules that are only reachable through *type* edges, so a flat scan over it
# reports false positives; this script instead walks the transitive closure of
# `dependencies[].code.specifier` (runtime edges) starting at the graph root,
# normalising through `.redirects` on the way.
#
# The JSON is filtered with `deno eval` rather than jq: the check then has
# exactly one dependency (Deno), which every dev machine and the CI job already
# have, and there is only one implementation of the traversal to keep correct.

set -euo pipefail

cd "$(dirname "$0")/.."

# Reads a `deno info --json` document on stdin and prints
#   TOTAL <modules in the graph, including type-only ones>
#   RUNTIME <modules reachable over code edges>
#   <one runtime-reachable specifier per line>
readonly FILTER='
const info = JSON.parse(await new Response(Deno.stdin.readable).text());
const redirects = info.redirects ?? {};
const resolve = (s) => redirects[s] ?? s;
const byId = new Map(info.modules.map((m) => [m.specifier, m]));
const seen = new Set();
const queue = (info.roots ?? []).map(resolve);
while (queue.length > 0) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
        const code = dep.code?.specifier;
        if (code !== undefined) queue.push(resolve(code));
    }
}
const modules = [...seen].sort();
// `deno info --json` reports unresolvable modules in-band and still exits 0.
const broken = modules.filter((m) => byId.get(m)?.error !== undefined);
if (broken.length > 0) {
    for (const m of broken) console.error("unresolved: " + byId.get(m).error);
    Deno.exit(1);
}
console.log("TOTAL " + info.modules.length);
console.log("RUNTIME " + modules.length);
for (const m of modules) console.log(m);
'

fail=0

forbid() {
    # forbid <entry> <modules> <label> <grep-mode> <pattern>
    local entry="$1" modules="$2" label="$3" mode="$4" pattern="$5"
    local hit
    if [ "$mode" = "prefix" ]; then
        hit="$(printf '%s\n' "$modules" | grep -c "^${pattern}" || true)"
    else
        hit="$(printf '%s\n' "$modules" | grep -cF -- "$pattern" || true)"
    fi
    if [ "$hit" != "0" ]; then
        printf 'FAIL %s: runtime graph contains %s (%s match(es) for %s)\n' \
            "$entry" "$label" "$hit" "$pattern" >&2
        printf '%s\n' "$modules" | grep -F -- "$pattern" | sed 's/^/       /' >&2
        fail=1
    fi
}

require() {
    # require <entry> <modules> <pattern> -- positive control
    local entry="$1" modules="$2" pattern="$3"
    if ! printf '%s\n' "$modules" | grep -qF -- "$pattern"; then
        printf 'FAIL %s: runtime graph is missing the expected module %s\n' \
            "$entry" "$pattern" >&2
        fail=1
    fi
}

declare -A TOTALS=()
declare -A RUNTIMES=()
declare -A MODULES=()

for entry in src/mod.ts src/v2/mod.ts src/v1/mod.ts src/fluent/mod.ts src/loader/mod.ts; do
    if ! info_json="$(deno info --json "$entry")"; then
        printf 'FAIL %s: `deno info` could not build the graph\n' "$entry" >&2
        exit 1
    fi
    out="$(printf '%s' "$info_json" | deno eval "$FILTER")"
    TOTALS["$entry"]="${out%%$'\n'*}"
    TOTALS["$entry"]="${TOTALS["$entry"]#TOTAL }"
    rest="${out#*$'\n'}"
    RUNTIMES["$entry"]="${rest%%$'\n'*}"
    RUNTIMES["$entry"]="${RUNTIMES["$entry"]#RUNTIME }"
    MODULES["$entry"]="${rest#*$'\n'}"
    # A vacuous pass would be worse than a violation: every entrypoint must at
    # least reach itself.
    require "$entry" "${MODULES["$entry"]}" "/$entry"
done

# (a) ./v1 must not reach grammY 2 at runtime.
forbid src/v1/mod.ts "${MODULES[src/v1/mod.ts]}" "grammY 2" substr "jsr.io/@grammyjs/grammy"
forbid src/v1/mod.ts "${MODULES[src/v1/mod.ts]}" "grammY 2" substr "npm:/@grammyjs/grammy"
forbid src/v1/mod.ts "${MODULES[src/v1/mod.ts]}" "grammY 2" substr "npm:@grammyjs/grammy"

# (b) ./ and ./v2 must not reach grammY 1 at runtime.
for entry in src/mod.ts src/v2/mod.ts; do
    forbid "$entry" "${MODULES[$entry]}" "grammY 1" substr "npm:/grammy@"
    forbid "$entry" "${MODULES[$entry]}" "grammY 1" substr "npm:grammy@"
done

# (c) No `node:` builtin and no ./loader in the four browser-safe entrypoints.
for entry in src/mod.ts src/v2/mod.ts src/v1/mod.ts src/fluent/mod.ts; do
    forbid "$entry" "${MODULES[$entry]}" "a node: builtin" prefix "node:"
    forbid "$entry" "${MODULES[$entry]}" "./loader" substr "/src/loader/"
done

# (d) Native i18next users must not pay for the Fluent bridge.
for entry in src/mod.ts src/v2/mod.ts src/v1/mod.ts; do
    forbid "$entry" "${MODULES[$entry]}" "./fluent" substr "/src/fluent/"
    forbid "$entry" "${MODULES[$entry]}" "@fluent/bundle" substr "npm:/@fluent/bundle"
done

# Positive controls: the detectors above must be able to see these.
require src/fluent/mod.ts "${MODULES[src/fluent/mod.ts]}" "npm:/@fluent/bundle"
require src/loader/mod.ts "${MODULES[src/loader/mod.ts]}" "node:"

printf '\n%-20s %8s %8s\n' "entrypoint" "modules" "runtime"
printf '%-20s %8s %8s\n' "--------------------" "--------" "--------"
for entry in src/mod.ts src/v2/mod.ts src/v1/mod.ts src/fluent/mod.ts src/loader/mod.ts; do
    printf '%-20s %8s %8s\n' "$entry" "${TOTALS[$entry]}" "${RUNTIMES[$entry]}"
done
printf '\n'

if [ "$fail" != "0" ]; then
    printf 'module graph assertions FAILED\n' >&2
    exit 1
fi
printf 'module graph assertions passed\n'
