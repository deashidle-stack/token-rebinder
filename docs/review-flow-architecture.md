# Token Rebinder — Review-by-Default Architecture (v6)

## What changed and why

Figma shipped native **"Check designs"** (June 2026): it streams `value → token` rows, gates Apply until the scan completes, and mutates nothing until you click. It feels safe. But its suggestions are often **wrong** — it matches a hardcoded value to *any* variable that shares it, so a brand color like `0F3549` maps to a random `Buttons/Map/Markers` token.

Token Rebinder is **more correct** (it learns bindings from how the real design actually uses each value) but previously **proved nothing** (aggregate counts only) and **looked frozen** on large files (synchronous 74k-node scan, static `Phase 1/4`).

v6 makes the correctness **visible, streamed, and safe** — matching Check designs' control model and beating it on proof (`Learned ×N` provenance) and coverage (50 binding types, any plan).

## Architecture: Plan → Commit

The old `applyToNode` decided *and* mutated in one pass. It's now parameterized:

- **Plan (dry-run):** `applyToNode(..., dryRun=true, plan)` walks the target, records a `PlanEntry` at every binding site, and **mutates nothing**. Verified: every setter and array-write is inside a `!dryRun` branch.
- **Commit:** `applyToNode(..., dryRun=false, sink)` runs the original setter code unchanged. Commit **re-walks the target fresh** (re-fetching the selection via `getNodeByIdAsync`), so it reflects current canvas state — immune to edits made during review, with no held-reference/stale-index risk.

The expensive phase (Learn, ~74k nodes) runs once; only the cheap target walk (~hundreds of nodes) repeats at commit.

## Provenance + majority-vote (the correctness proof)

`LearnedBinding`/`TextStyle`/`Effect`/`Grid` carry `origin` (`learned` | `upgraded` | `fallback`) and `seenCount`, stamped at insertion.

Colors use a **vote-map**: `learnFromFile` tallies `hex → {variableId → count}`, and `resolveColorVotes()` picks the **most-seen** variable per hex (semantic tie-break via `isBetter`). This fixes the last-write-wins collision bug — `0F3549` resolves to whatever the design uses *most*, not whatever was scanned last. The winning count becomes the `Learned ×N` badge.

Badges shown per diff row: `Learned ×N` · `Exact` · `Fuzzy ±2` · `Semantic` (upgraded) · `Fallback`.

## Streaming + yield

- `yieldToUI()` = an **iframe-ack round-trip as primary** (post `__yield`, await the UI's `__yield-ack`) with a **1.5s `setTimeout` safety-net** so a closed/unresponsive UI can't hang the walk. The ack reply proves the iframe got CPU time (could repaint) and flushed our queued messages — strictly stronger than `setTimeout(0)` and not dependent on its repaint behavior. Guards: `done` flag (no double-resolve), `pendingYield === settle` check (no orphan/clobber), re-entrancy guard (no concurrent walks).
- Yields fire inside the Learn recursion (every 500 nodes — mid-subtree, so deep trees still yield) and the target walk (every 200 nodes).
- Structured progress: `{phase, label, current, total, tally}` drives the 4-step stepper + live bar + learning tally.

## Message protocol

| Dir | type | payload |
|---|---|---|
| UI→plugin | `run-plan` | `{options, autoApply}` |
| UI→plugin | `commit` | `{}` |
| UI→plugin | `cancel` | `{}` |
| UI→plugin | `export-json` / `share-score` / `open-upgrade` | — |
| plugin→UI | `progress` | `{phase, label, current, total, tally?}` |
| plugin→UI | `plan-batch` | `{rows: PlanRow[]}` (40-row chunks) |
| plugin→UI | `plan-complete` | `{total, byTab, unmatched, learnedRatio, learned}` |
| plugin→UI | `done` | `{results, healthScore, categoryScores, applied, planned, skippedFromPlan}` |
| plugin→UI | `error` / `tier` / `export-data` | — |

## Known limitations (acceptable for v6)

- **Font fixes** are applied on commit but not shown in the reviewable diff (a rename, not a token binding). They appear in the final totals only.
- **Dimension bindings** (`width`/`height`) can be over-counted in the *preview* — the setter may throw at commit for hug/fill nodes. The commit is source-of-truth and the result banner reports the delta honestly ("N of M applied — inapplicable field or frame changed").
- **Auto-apply** toggle deliberately bypasses the review gate (opt-in power-user path); "zero mutation before Apply" applies to the default flow.

## Verification checklist (Figma Desktop — must be run before republish)

> Plugins → Development → Import plugin from manifest → select `manifest.json`. Recompile first: `node_modules/.bin/tsc`.

1. **Smoke:** plugin opens; "Plan rebind" runs; stepper advances; rows stream into tabs; **Apply stays disabled until planning finishes**; canvas unchanged until Apply clicked.
2. **Freeze test (the `setTimeout` validation):** run on the Ayvens portal frame (~74k nodes). Stepper + tally must tick; no "not responding". *If it stalls, report back — the yield primitive needs the iframe-ack fallback.*
3. **Safety:** during planning and at plan-complete, inspect the frame — **no bindings changed**. Click Cancel / close → frame unchanged.
4. **Proof:** `0F3549` shows `→ Surface/Brand…` with a `Learned ×N` badge, not the map-marker token Check designs picked.
5. **Parity:** Apply-all; totals roughly match the pre-v6 baseline (some color bindings may differ — intended majority-vote gain; verify those are *more* correct).
6. **Honesty:** if you edit the frame mid-review then Apply, the banner reports "N of M applied".

## Learnings captured

- **Yield primitive** for the Figma plugin main thread: `setTimeout(0)` assumed available; microtask fallback in place. Confirm via freeze test #2.
- **Plan/Commit via re-walk** (not held nodeIds) is the safest review-before-mutate pattern under `documentAccess: dynamic-page` — fresh reads beat stale references.
- **`seenCount` majority-vote** is what makes a learn-from-peers binder provably more correct than a name/value matcher — and it's the same data that powers the `Learned ×N` proof badge.
