# Token Rebinder — Publish Checklist (v2.1 review-flow)

> **Do NOT publish until the in-Figma gate below is green.** The build is verified by tsc,
> a node harness (14/14), browser-DOM QA, and 20 findings fixed across Claude + Codex reviews —
> but it has not yet run in the real Figma sandbox. First impressions on Community are sticky.

## Gate — must all pass (Figma Desktop)

Import the dev build first: **Plugins → Development → Import plugin from manifest…** →
`/Users/andreasbember/Documents/Bember/Token Rebinder/manifest.json`
(Recompile first if needed: `node_modules/.bin/tsc`.)

- [ ] **Freeze test** — run on the ~74k-node Ayvens portal frame. Stepper + learning tally tick; no "not responding". *(The yield now uses an iframe-ack round-trip as PRIMARY — the reliable, documented plugin↔UI mechanism — with a 1.5s setTimeout safety-net so a closed UI can't hang. This test confirms that mechanism on a real large frame; it's no longer gambling on setTimeout-repaint behavior.)*
- [ ] **Safety** — during planning and at "Apply N", the canvas is unchanged. Cancel / close → unchanged.
- [ ] **Proof** — a brand color (e.g. `0F3549`) shows `→ Surface/Brand…` with a `Learned ×N` badge, not a map-marker component token.
- [ ] **Parity** — Apply-all; totals ≈ the pre-v2.1 baseline (some color bindings legitimately differ — that's the majority-vote correctness gain).
- [ ] **Honesty** — edit the frame mid-review, then Apply → banner reports "changed during review".
- [ ] **Codex re-verify** returned clean (the background cross-model pass on the 6 fixes).

## Publish steps (after gate is green)

1. Figma Desktop → **Plugins → Development → Token Rebinder → right-click → Publish new release**.
2. Release notes:

   > **v2.1 — Watch it think, then review before you rebind**
   >
   > Token Rebinder now shows its work — live. As it scans your file, each color resolves in real
   > time onto the token your design actually uses most, vote count climbing (#0f3549 → Text/Primary
   > ×3381). Then review every proposed binding — grouped by Colors / Dimensions / Typography / Effects,
   > each with a provenance badge (`Learned ×N`, `Exact`, `Fuzzy ±2`, `Semantic`, `Fallback`) so you see
   > *why* each token was chosen. Nothing on your canvas changes until you click **Apply**.
   >
   > - Review-by-default: read-only plan → gated Apply → honest applied/skipped receipt
   > - Smarter colors: majority-vote learns how your design actually uses each value, so colliding
   >   hexes resolve to the *most-used* (correct) token instead of a random match
   > - Live progress across all phases — no more "is it frozen?" on large files
   > - Cleaner review list: only proposes width/height where layers can actually accept it
   > - Resizable panel — drag the corner to fit long token names; size is remembered
   > - Token Health Score + JSON export. Free for everyone, every binding type, any plan.

3. Submit.

## Post-publish

- [ ] Install from the Community page on a fresh account; run the freeze + proof tests once more on the live listing.
- [ ] Watch `/events` telemetry for `plugin_run` from real users.
