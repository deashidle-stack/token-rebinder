# Token Rebinder — Launch Readiness Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all audit findings, add telemetry, fix GTM positioning, and ship a production-ready closed-source Figma plugin with working Pro tier monetization.

**Architecture:** 3 codebases — Figma plugin (TS→JS), Cloudflare Worker API (D1), Next.js landing site (Cloudflare Pages). All deploy independently. Plugin publishes via Figma Desktop after all code fixes land.

**Tech Stack:** TypeScript, Cloudflare Workers/D1/Pages, Next.js 16, Stripe, Figma Plugin API

---

**Overall Progress:** `0%`

## TLDR
Five audits found 50 issues across security, gating, compliance, GTM, and UX. Most critical Worker security and plugin gating bugs are already fixed. This plan addresses remaining issues + adds lightweight telemetry + fixes open-source positioning. Six phases, each with a quality gate.

## Critical Decisions
- **Closed source** — no GitHub repo for source code. Figma Community is the distribution channel.
- **Telemetry from day one (option B)** — anonymous event counts (rebinds, tiers, binding types, health scores) via a new `/events` Worker endpoint. No PII, no file content. Gives product signal for a low-maintenance tool.
- **Client-side license enforcement is acceptable for MVP** — server-side would require proxying every gated action through the Worker. Document the risk but don't block launch.
- **Health score uses node count as denominator** — not perfect (multi-field nodes inflate score) but simple and directional. Clamp at 100%.
- **OAuth state validation deferred** — the current state param includes a UUID but isn't stored/verified. True CSRF requires attacker to trick victim into completing Figma OAuth AND Stripe checkout — low risk for MVP. Track as tech debt.

## Current State (What's Already Fixed)
The Worker API already has: ✅ timing-safe HMAC, ✅ DB write checks on webhooks, ✅ missing metadata returns 400, ✅ timestamp validation, ✅ all v1 signatures checked, ✅ input validation on /checkout, ✅ generic error messages, ✅ CORS allowlist, ✅ figmaId regex validation.

The manifest already has: ✅ numeric ID, ✅ currentuser permission, ✅ documentAccess, ✅ enableProposedApi removed, ✅ tsconfig lib=ES2017.

The plugin UI already has: ✅ export gate sends open-upgrade for free, ✅ share gate sends open-upgrade for free, ✅ upsell dismiss button, ✅ run button disabled during processing, ✅ aria-live on progress, ✅ unmatched colors use DOM API, ✅ "Values learned" / "Tokens upgraded" copy.

The landing site already has: ✅ error allowlist, ✅ success page tier-aware, ✅ CheckCircle uses CSS class not hex.

The plugin code already has: ✅ user.id URL-encoded, ✅ export-json refreshes license before gating.

---

## Tasks

### PHASE 1: Remaining Plugin Code Fixes
*Target: Fix audit findings in code.ts that haven't been addressed yet*

- [ ] 🟥 **Task 1: Fix font handling gate — run under typography option, not colors**

  **Files:**
  - Modify: `Token Rebinder/code.ts:1073`

  **Step 1: Fix the conditional**

  Current code at line 1073:
  ```typescript
  if (opts.typography || opts.colors) {
  ```

  Change to:
  ```typescript
  if (opts.typography) {
  ```

  **Rationale:** Font fixing is a typography operation. Running it under `opts.colors` means disabling colors also disables font normalization, and enabling colors forces font patching even if typography is deselected.

  **Step 2: Verify TypeScript compiles**

  Run: `cd "/Users/andreasbember/Documents/Bember/Token Rebinder" && npx tsc --noEmit`
  Expected: No errors

- [ ] 🟥 **Task 2: Fix progress counter for small files (< 500 nodes)**

  **Files:**
  - Modify: `Token Rebinder/code.ts:598`

  **Step 1: The counter already fires at scanned === 1 (line 598)**

  Current code:
  ```typescript
  if (scanned === 1 || scanned % 500 === 0) {
  ```

  This is already fixed. Verify by reading the line. If it still says `scanned % 500 === 0` without the `=== 1` check, add it.

  **Step 2: Verify**
  Run: `npx tsc --noEmit`

- [ ] 🟥 **Task 3: Add skippedNodes counter to Results for error visibility**

  **Files:**
  - Modify: `Token Rebinder/code.ts` — Results interface (~line 61), applyToNode catch blocks, done message

  **Step 1: Add `skippedNodes: number` to the Results interface**

  After `totalEffectNodes: number;` add:
  ```typescript
  skippedNodes: number;
  ```

  **Step 2: Initialize in results object (~line 1291)**

  After `totalEffectNodes: 0,` add:
  ```typescript
  skippedNodes: 0,
  ```

  **Step 3: Increment in catch blocks inside applyToNode**

  In the major catch blocks inside `applyToNode` (fills, strokes, spacing, effects, typography, etc.), change `catch (_e) { /* skip */ }` to `catch (_e) { results.skippedNodes++; }` for the outer try/catch blocks. Don't change every inner catch — just the main section-level catches.

  **Step 4: Include in done message**

  The `done` message already sends the full `results` object, so `skippedNodes` will be included automatically.

  **Step 5: Verify**
  Run: `npx tsc --noEmit`

- [ ] 🟥 **Task 4: Fix component property isAlreadyBound — check per-property, not entire group**

  **Files:**
  - Modify: `Token Rebinder/code.ts:1149`

  **Step 1: Replace the group-level binding check with per-property check**

  Current code at line 1149:
  ```typescript
  if (cpd.boundVariables && cpd.boundVariables.value) continue;
  ```

  This already checks the individual property definition's `boundVariables.value`, not the node-level `isAlreadyBound`. The audit finding (#5 in code.ts review) was about using `isAlreadyBound(node, "componentProperties")` — but the current code uses `cpd.boundVariables` directly. **This is already correct.** Verify by reading the line.

- [ ] 🟥 **Task 5: Commit Phase 1 plugin fixes**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/Token Rebinder"
  git add code.ts
  git commit -m "fix(plugin): font gate under typography, skippedNodes counter"
  ```

**Quality Gate 1:** `npx tsc --noEmit` passes with zero errors.

---

### PHASE 2: Landing Site GTM Fixes
*Target: Remove open-source positioning, fix dead links, polish copy*

- [ ] 🟥 **Task 6: Fix footer — remove "open source", fix links**

  **Files:**
  - Modify: `token-rebinder-site/src/app/page.tsx:800-826`

  **Step 1: Replace footer content**

  Change lines 800-826 from:
  ```tsx
  <div className="flex flex-col gap-1">
    <span className="text-sm text-text-secondary">
      Built by{" "}
      <span className="text-text-primary font-medium">
        Hidle Everform
      </span>
    </span>
    <span className="text-xs text-text-tertiary">
      Free and open source
    </span>
  </div>

  <div className="flex items-center gap-6">
    <a
      href="#"
      className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
    >
      GitHub
    </a>
    <a
      href="#"
      className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
    >
      Figma Community
    </a>
  </div>
  ```

  To:
  ```tsx
  <div className="flex flex-col gap-1">
    <span className="text-sm text-text-secondary">
      Built by{" "}
      <span className="text-text-primary font-medium">
        Hidle Everform
      </span>
    </span>
    <span className="text-xs text-text-tertiary">
      Free to use. Pro for power users.
    </span>
  </div>

  <div className="flex items-center gap-6">
    <a
      href="https://www.figma.com/community/plugin/1616450671951147919"
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
    >
      Figma Community
    </a>
    <a
      href="https://tokenrebinder.everform.io/upgrade"
      className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
    >
      Pricing
    </a>
  </div>
  ```

- [ ] 🟥 **Task 7: Fix `var` and `function` keywords in TransformationCard**

  **Files:**
  - Modify: `token-rebinder-site/src/app/page.tsx:155, 186`

  **Step 1:** Change line 155 from `var rows = [` to `const rows = [`

  **Step 2:** Change line 186 from `{rows.map(function(row, i) {` to `{rows.map((row, i) => (`
  And corresponding line 188 from `})}` to `))}` (return statement becomes implicit)

  **Step 3: Verify**
  Run: `cd "/Users/andreasbember/Documents/Bember/token-rebinder-site" && npm run build`

- [ ] 🟥 **Task 8: Fix em-dash in layout.tsx title**

  **Files:**
  - Modify: `token-rebinder-site/src/app/layout.tsx:16`

  **Step 1:** Change:
  ```tsx
  title: "Token Rebinder —Restore every Figma variable binding",
  ```
  To (add space after em-dash):
  ```tsx
  title: "Token Rebinder — Restore every Figma variable binding",
  ```

  Also check line 18 for the description — fix any `—` spacing issues.

- [ ] 🟥 **Task 9: Add OG metadata URLs**

  **Files:**
  - Modify: `token-rebinder-site/src/app/layout.tsx:19-30`

  **Step 1:** Add `url` to openGraph:
  ```tsx
  openGraph: {
    title: "Token Rebinder",
    description: "Restore every Figma variable binding after code-to-canvas push. 4,354 bindings restored and counting.",
    type: "website",
    url: "https://tokenrebinder.everform.io",
  },
  ```

  **Note:** OG image requires creating an actual image file (1200x630). Skip for now — add as a follow-up task. The `url` field is the immediate fix.

- [ ] 🟥 **Task 10: Fix documentationUrl in manifest — remove dead GitHub link**

  **Files:**
  - Modify: `Token Rebinder/manifest.json:14`

  **Step 1:** Change:
  ```json
  "documentationUrl": "https://github.com/hidle-everform/token-rebinder"
  ```
  To:
  ```json
  "documentationUrl": "https://tokenrebinder.everform.io"
  ```

- [ ] 🟥 **Task 11: Commit Phase 2 fixes**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-site"
  git add src/app/page.tsx src/app/layout.tsx
  git commit -m "fix(site): remove open-source claim, fix footer links, fix metadata"

  cd "/Users/andreasbember/Documents/Bember/Token Rebinder"
  git add manifest.json
  git commit -m "fix(manifest): point documentationUrl to landing page"
  ```

**Quality Gate 2:** `npm run build` succeeds for the landing site. No dead links in footer.

---

### PHASE 3: Telemetry Endpoint
*Target: Add anonymous event tracking — counts only, no PII, no file content*

- [ ] 🟥 **Task 12: Add events table to D1 schema**

  **Files:**
  - Create: `token-rebinder-api/migrations/0002_events.sql`

  **Step 1: Write the migration**

  ```sql
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_events_type ON events(event_type);
  CREATE INDEX idx_events_created ON events(created_at);
  ```

  **Step 2: Apply the migration**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-api"
  npx wrangler d1 execute token-rebinder-db --remote --file=migrations/0002_events.sql
  ```

- [ ] 🟥 **Task 13: Add POST /events endpoint to Worker**

  **Files:**
  - Modify: `token-rebinder-api/src/index.ts`

  **Step 1: Add the handler function** (after handleCheckout, before the router)

  ```typescript
  // ── Anonymous Telemetry ─────────────────────────────────────────────

  async function handleEvent(env: Env, request: Request, origin?: string): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, origin, 400);
    }

    const { event, tier, payload } = body as { event?: string; tier?: string; payload?: Record<string, unknown> };

    if (!event || typeof event !== "string") {
      return jsonResponse({ error: "event is required" }, origin, 400);
    }

    const ALLOWED_EVENTS = ["plugin_run", "plugin_open", "export_json", "upgrade_click", "health_score"];
    if (!ALLOWED_EVENTS.includes(event)) {
      return jsonResponse({ error: "Unknown event type" }, origin, 400);
    }

    const safeTier = tier === "pro" || tier === "team" ? tier : "free";
    const safePayload = payload ? JSON.stringify(payload).slice(0, 1000) : null;

    await env.DB.prepare(
      "INSERT INTO events (event_type, tier, payload) VALUES (?, ?, ?)"
    ).bind(event, safeTier, safePayload).run();

    return jsonResponse({ ok: true }, origin);
  }
  ```

  **Step 2: Add route** in the router (after `/webhooks/stripe` handler):

  ```typescript
  if (path === "/events" && request.method === "POST") {
    return handleEvent(env, request, origin);
  }
  ```

  **Step 3: Verify locally**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-api"
  npx wrangler deploy --dry-run
  ```

- [ ] 🟥 **Task 14: Add telemetry calls to plugin code.ts**

  **Files:**
  - Modify: `Token Rebinder/code.ts`

  **Step 1: Add a fire-and-forget telemetry function** (after checkFileAccess, ~line 152)

  ```typescript
  function trackEvent(event: string, tier: string, payload?: Record<string, unknown>): void {
    try {
      fetch(API_BASE + "/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: event, tier: tier, payload: payload }),
      });
    } catch (_e) { /* fire and forget */ }
  }
  ```

  **Step 2: Track plugin_open** — after `figma.showUI(...)` at line 1178:

  ```typescript
  checkLicense().then(function(t) {
    currentTier = t;
    figma.ui.postMessage({ type: "tier", tier: t });
    trackEvent("plugin_open", t);
  });
  ```

  **Step 3: Track plugin_run** — inside the `run` handler, after health score computation (~line 1332):

  ```typescript
  trackEvent("plugin_run", currentTier, {
    healthScore: healthScore,
    nodesScanned: results.targetNodesScanned,
    totalRebound: totalRebound,
    bindingTypes: {
      fills: results.fillsRebound,
      strokes: results.strokesRebound,
      spacing: results.spacingRebound,
      radius: results.radiusRebound,
      effects: results.effectFieldsRebound,
      typography: results.typoVarsRebound + results.textStylesRebound,
    },
  });
  ```

  **Step 4: Track export_json** — inside the `export-json` handler, after successful export (~line 1214):

  ```typescript
  trackEvent("export_json", currentTier);
  ```

  **Step 5: Track upgrade_click** — inside the `open-upgrade` handler (~line 1186):

  ```typescript
  trackEvent("upgrade_click", currentTier);
  ```

  **Step 6: Verify**

  Run: `npx tsc --noEmit`

- [ ] 🟥 **Task 15: Update manifest allowedDomains (if not already correct)**

  The manifest already allows `https://token-rebinder-api.andreas-everform.workers.dev` — telemetry goes to the same domain. No change needed. Verify.

- [ ] 🟥 **Task 16: Deploy Worker with events endpoint**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-api"
  npx wrangler deploy
  ```

- [ ] 🟥 **Task 17: Test telemetry endpoint**

  ```bash
  curl -X POST https://token-rebinder-api.andreas-everform.workers.dev/events \
    -H "Content-Type: application/json" \
    -d '{"event":"plugin_open","tier":"free"}'
  ```

  Expected: `{"ok":true}`

  Verify data landed:
  ```bash
  npx wrangler d1 execute token-rebinder-db --remote --command="SELECT * FROM events ORDER BY id DESC LIMIT 5"
  ```

- [ ] 🟥 **Task 18: Commit Phase 3**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-api"
  git add migrations/0002_events.sql src/index.ts
  git commit -m "feat(api): add anonymous telemetry endpoint"

  cd "/Users/andreasbember/Documents/Bember/Token Rebinder"
  git add code.ts
  git commit -m "feat(plugin): add anonymous usage telemetry"
  ```

**Quality Gate 3:** `curl` to `/events` returns `{"ok":true}`. Event row visible in D1. Plugin compiles.

---

### PHASE 4: Landing Site Deploy
*Target: Deploy all site changes, verify in production*

- [ ] 🟥 **Task 19: Build and deploy landing site**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-site"
  npm run build && npx wrangler pages deploy out --project-name token-rebinder --branch main
  ```

- [ ] 🟥 **Task 20: Verify deployed site**

  Check:
  - [ ] Footer says "Free to use. Pro for power users." (not "Free and open source")
  - [ ] Footer links go to Figma Community and Pricing (not dead `#` links)
  - [ ] Title in browser tab has proper em-dash spacing
  - [ ] `/upgrade` page works, error params show allowlisted messages
  - [ ] `/upgrade/success?tier=pro` shows "You're on Pro!"
  - [ ] `/upgrade/success?tier=team` shows "You're on Team!"

**Quality Gate 4:** All 6 checks pass on the live site.

---

### PHASE 5: Plugin Build & Verification
*Target: Compile plugin, verify it runs in Figma Desktop*

- [ ] 🟥 **Task 21: Compile plugin**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/Token Rebinder"
  npx tsc
  ```

  This produces `code.js` from `code.ts`.

- [ ] 🟥 **Task 22: Manual Figma Desktop test**

  Open Figma Desktop → Plugins → Development → Token Rebinder

  Verify:
  - [ ] Plugin opens without errors
  - [ ] Tier bar shows "Free" with "Upgrade to Pro →" link
  - [ ] Select a frame → click "Rebind Selected Frame" → runs all 4 phases
  - [ ] Progress messages appear during run
  - [ ] Results show all stat categories
  - [ ] Health Score card renders with category dots
  - [ ] Export button shows lock icon and opens upgrade (not a download) on Free
  - [ ] Share button shows lock icon and opens upgrade on Free
  - [ ] Upsell section has dismiss (×) button that works
  - [ ] "Upgrade to Pro →" link opens browser to the OAuth flow

- [ ] 🟥 **Task 23: Verify telemetry fires**

  After running the plugin once in Figma:
  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-api"
  npx wrangler d1 execute token-rebinder-db --remote --command="SELECT * FROM events ORDER BY id DESC LIMIT 10"
  ```

  Expected: `plugin_open` and `plugin_run` events visible.

**Quality Gate 5:** Plugin runs without errors. Telemetry events land in D1. All UI gates enforce correctly.

---

### PHASE 6: Final Commit & Publish Prep
*Target: Clean commits across all 3 repos, write publish instructions*

- [ ] 🟥 **Task 24: Final git status check across all repos**

  ```bash
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-api" && git status
  cd "/Users/andreasbember/Documents/Bember/token-rebinder-site" && git status
  cd "/Users/andreasbember/Documents/Bember/Token Rebinder" && git status
  ```

  Ensure all changes are committed. No stray files.

- [ ] 🟥 **Task 25: Write Figma plugin publish checklist**

  Create: `Token Rebinder/docs/publish-checklist.md`

  Contents:
  ```markdown
  # Plugin Publish Checklist

  ## Prerequisites
  - [ ] OAuth app approved by Figma (check developer console)
  - [ ] Worker API deployed and responding
  - [ ] Landing site deployed at tokenrebinder.everform.io
  - [ ] Stripe in live mode (switch from test when ready)

  ## Publish Steps (Figma Desktop)
  1. Open Figma Desktop
  2. Plugins → Development → Token Rebinder
  3. Right-click → Publish new release
  4. Fill in release notes:
     > v2.0 — Pro tier with 50/51 variable binding coverage. Token Health Score, JSON export, batch rebinding, Figma OAuth upgrade flow.
  5. Submit for review

  ## Post-Publish
  - [ ] Verify plugin installs from Community page
  - [ ] Test upgrade flow with a fresh Figma account
  - [ ] Switch Stripe to live mode when ready for real payments
  - [ ] Monitor /events telemetry for first real users
  ```

**Quality Gate 6:** All repos clean. Publish checklist written. Ready to publish when OAuth app is approved.

---

## Tech Debt (Post-Launch)
These are documented but not blocking launch:

1. **OAuth state validation** — store state in signed cookie, verify on callback
2. **Server-side license enforcement** — proxy gated actions through Worker
3. **OG image** — create 1200×630 social share image
4. **Health score formula** — switch denominator from node count to binding-opportunity count
5. **Telemetry dashboard** — D1 query dashboard or pipe to a BI tool
6. **Stripe live mode** — switch keys, update webhook endpoint
7. **Per-page metadata** — export metadata from upgrade/success pages (requires server component wrapper)
