# Token Rebinder Pro Tier — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add monetization infrastructure to Token Rebinder — Cloudflare Worker API, Figma OAuth, Stripe subscriptions, license gating in the plugin, and Token Health Score.

**Architecture:** Single Cloudflare Worker (`token-rebinder-api`) with D1 database handles auth, payments, and licensing. Plugin checks license on open (cached 7 days in `clientStorage`), soft-gates Pro features (share, export, batch, multi-file). Landing page handles OAuth redirect and post-payment confirmation. All compute on Cloudflare edge.

**Tech Stack:** Cloudflare Workers (TypeScript), D1 (SQLite), Stripe API, Figma OAuth, Figma Plugin API (`clientStorage`, `networkAccess`), Next.js 16 static export

**Overall Progress:** `0%`

---

## TLDR

Build the paid tier for Token Rebinder: a CF Worker API for auth/payments/licensing, plugin-side license checks with soft gating, Token Health Score with shareable card, and a landing page upgrade flow via Figma OAuth → Stripe Checkout.

## Critical Decisions

- **Periodic license check + clientStorage cache** — no network call on every rebind, 7-day TTL
- **Figma OAuth for identity** — seamless upgrade, no copy-paste activation codes
- **Client-side Health Score** — plugin already has the data, server-side for Team tier later
- **Soft gating** — all features run on Free, outputs (share/export/batch) are locked with upsell
- **Static site** — `next.config.ts` uses `output: "export"`, so /upgrade is a client-side page that redirects to Worker's OAuth endpoint

## Key Paths

| Artifact | Path |
|----------|------|
| Plugin code | `/Users/andreasbember/Documents/Bember/Token Rebinder/code.ts` |
| Plugin UI | `/Users/andreasbember/Documents/Bember/Token Rebinder/ui.html` |
| Plugin manifest | `/Users/andreasbember/Documents/Bember/Token Rebinder/manifest.json` |
| Landing site | `/Users/andreasbember/Documents/Bember/token-rebinder-site/` |
| Worker (to create) | `/Users/andreasbember/Documents/Bember/token-rebinder-api/` |
| Design doc | `/Users/andreasbember/Documents/Bember/Token Rebinder/docs/plans/2026-03-20-pro-tier-design.md` |

---

## Tasks

### Task 1: Scaffold Cloudflare Worker + D1

**Files:**
- Create: `token-rebinder-api/src/index.ts`
- Create: `token-rebinder-api/wrangler.toml`
- Create: `token-rebinder-api/package.json`
- Create: `token-rebinder-api/tsconfig.json`
- Create: `token-rebinder-api/migrations/0001_init.sql`

**Step 1: Create the Worker project**

```bash
cd /Users/andreasbember/Documents/Bember
npx wrangler init token-rebinder-api --type worker --template worker-typescript
```

If the interactive prompt blocks, create manually:

```bash
mkdir -p token-rebinder-api/src token-rebinder-api/migrations
```

**Step 2: Write `wrangler.toml`**

```toml
name = "token-rebinder-api"
main = "src/index.ts"
compatibility_date = "2026-03-20"

[[d1_databases]]
binding = "DB"
database_name = "token-rebinder-db"
database_id = "" # filled after creation

[vars]
FIGMA_REDIRECT_URI = "https://token-rebinder-api.deashidle.workers.dev/auth/callback"
LANDING_URL = "https://tokenrebinder.everform.io"
```

**Step 3: Create D1 database**

```bash
cd token-rebinder-api
npx wrangler d1 create token-rebinder-db
```

Copy the returned `database_id` into `wrangler.toml`.

**Step 4: Write initial migration `migrations/0001_init.sql`**

```sql
CREATE TABLE users (
  figma_id TEXT PRIMARY KEY,
  figma_email TEXT,
  figma_name TEXT,
  stripe_customer_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  figma_id TEXT NOT NULL REFERENCES users(figma_id),
  stripe_subscription_id TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'expired')),
  current_period_end TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sub_figma ON subscriptions(figma_id);
```

**Step 5: Apply migration**

```bash
npx wrangler d1 migrations apply token-rebinder-db --local
```

**Step 6: Write the Worker entry point `src/index.ts`**

Skeleton with router, CORS, env types:

```typescript
export interface Env {
  DB: D1Database;
  FIGMA_CLIENT_ID: string;
  FIGMA_CLIENT_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_PRO: string;
  STRIPE_PRICE_TEAM: string;
  FIGMA_REDIRECT_URI: string;
  LANDING_URL: string;
}

function corsHeaders(origin?: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || undefined;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      if (path === "/auth/figma" && request.method === "GET") {
        return handleAuthFigma(env, url);
      }
      if (path === "/auth/callback" && request.method === "GET") {
        return handleAuthCallback(env, url);
      }
      if (path === "/checkout" && request.method === "POST") {
        return handleCheckout(env, request, origin);
      }
      if (path === "/webhooks/stripe" && request.method === "POST") {
        return handleStripeWebhook(env, request);
      }
      if (path.startsWith("/license/") && request.method === "GET") {
        const figmaId = path.split("/license/")[1];
        return handleLicense(env, figmaId, origin);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
      );
    }
  },
};
```

Leave handler functions as stubs that return `501 Not Implemented`. They'll be filled in subsequent tasks.

**Step 7: Verify it runs locally**

```bash
npx wrangler dev
# Should start on localhost:8787
curl http://localhost:8787/license/test
# Should return 501
```

**Step 8: Commit**

```bash
git add token-rebinder-api/
git commit -m "feat(api): scaffold token-rebinder-api Worker with D1 schema"
```

---

### 🚦 Quality Gate 1: Backend Scaffold

- [ ] Worker starts locally with `wrangler dev`
- [ ] D1 migration applies without errors
- [ ] All 5 routes return 501 stubs
- [ ] CORS preflight works (OPTIONS returns 200)
- [ ] TypeScript compiles without errors

---

### Task 2: License Endpoint

**Files:**
- Modify: `token-rebinder-api/src/index.ts`

**Step 1: Implement `handleLicense()`**

This is the endpoint the plugin calls weekly. It looks up the user's active subscription and returns their tier.

```typescript
async function handleLicense(env: Env, figmaId: string, origin?: string): Promise<Response> {
  if (!figmaId) {
    return new Response(JSON.stringify({ tier: "free" }), {
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const row = await env.DB.prepare(
    `SELECT s.tier, s.status, s.current_period_end
     FROM subscriptions s
     WHERE s.figma_id = ? AND s.status IN ('active', 'past_due')
     ORDER BY s.created_at DESC LIMIT 1`
  ).bind(figmaId).first<{ tier: string; status: string; current_period_end: string }>();

  const tier = row ? row.tier : "free";

  return new Response(JSON.stringify({ tier, status: row?.status || "none" }), {
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
```

**Step 2: Test locally**

```bash
# No subscription → free
curl http://localhost:8787/license/12345
# Expected: {"tier":"free","status":"none"}
```

**Step 3: Commit**

```bash
git add token-rebinder-api/src/index.ts
git commit -m "feat(api): implement license endpoint"
```

---

### Task 3: Figma OAuth Endpoints

**Files:**
- Modify: `token-rebinder-api/src/index.ts`

**Step 1: Implement `handleAuthFigma()`**

Redirects to Figma's OAuth authorization URL.

```typescript
function handleAuthFigma(env: Env, url: URL): Response {
  const state = crypto.randomUUID();
  const tier = url.searchParams.get("tier") || "pro";

  const figmaUrl = new URL("https://www.figma.com/oauth");
  figmaUrl.searchParams.set("client_id", env.FIGMA_CLIENT_ID);
  figmaUrl.searchParams.set("redirect_uri", env.FIGMA_REDIRECT_URI);
  figmaUrl.searchParams.set("scope", "files:read");
  figmaUrl.searchParams.set("state", `${state}:${tier}`);
  figmaUrl.searchParams.set("response_type", "code");

  return Response.redirect(figmaUrl.toString(), 302);
}
```

**Step 2: Implement `handleAuthCallback()`**

Exchanges the OAuth code for a token, fetches user info, upserts in D1, then redirects to Stripe Checkout.

```typescript
async function handleAuthCallback(env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const tier = state.split(":")[1] || "pro";

  if (!code) {
    return Response.redirect(`${env.LANDING_URL}/upgrade?error=no_code`, 302);
  }

  // Exchange code for token
  const tokenResp = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.FIGMA_CLIENT_ID,
      client_secret: env.FIGMA_CLIENT_SECRET,
      redirect_uri: env.FIGMA_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    return Response.redirect(`${env.LANDING_URL}/upgrade?error=token_exchange`, 302);
  }

  const tokenData = await tokenResp.json() as { access_token: string };

  // Fetch user info
  const meResp = await fetch("https://api.figma.com/v1/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const me = await meResp.json() as { id: string; email: string; handle: string };

  // Upsert user
  await env.DB.prepare(
    `INSERT INTO users (figma_id, figma_email, figma_name)
     VALUES (?, ?, ?)
     ON CONFLICT(figma_id) DO UPDATE SET
       figma_email = excluded.figma_email,
       figma_name = excluded.figma_name`
  ).bind(me.id, me.email, me.handle).run();

  // Get or create Stripe customer
  let stripeCustomerId: string;
  const existingUser = await env.DB.prepare(
    "SELECT stripe_customer_id FROM users WHERE figma_id = ?"
  ).bind(me.id).first<{ stripe_customer_id: string | null }>();

  if (existingUser?.stripe_customer_id) {
    stripeCustomerId = existingUser.stripe_customer_id;
  } else {
    const custResp = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: me.email,
        name: me.handle,
        "metadata[figma_id]": me.id,
      }),
    });
    const cust = await custResp.json() as { id: string };
    stripeCustomerId = cust.id;

    await env.DB.prepare(
      "UPDATE users SET stripe_customer_id = ? WHERE figma_id = ?"
    ).bind(stripeCustomerId, me.id).run();
  }

  // Create Stripe Checkout session
  const priceId = tier === "team" ? env.STRIPE_PRICE_TEAM : env.STRIPE_PRICE_PRO;

  const checkoutResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      customer: stripeCustomerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      mode: "subscription",
      success_url: `${env.LANDING_URL}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.LANDING_URL}/upgrade?canceled=true`,
      "metadata[figma_id]": me.id,
      "metadata[tier]": tier,
      "subscription_data[metadata][figma_id]": me.id,
      "subscription_data[metadata][tier]": tier,
    }),
  });
  const session = await checkoutResp.json() as { url: string };

  return Response.redirect(session.url, 302);
}
```

**Step 3: Commit**

```bash
git add token-rebinder-api/src/index.ts
git commit -m "feat(api): add Figma OAuth and Stripe Checkout flow"
```

---

### Task 4: Stripe Webhook Handler

**Files:**
- Modify: `token-rebinder-api/src/index.ts`

**Step 1: Implement `handleStripeWebhook()`**

Handles 4 events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

Note: Stripe webhook signature verification requires the raw body. Use `crypto.subtle` for HMAC verification on Cloudflare Workers (no Node.js `crypto` module).

```typescript
async function verifyStripeSignature(
  body: string, signature: string, secret: string
): Promise<boolean> {
  const parts = signature.split(",");
  let timestamp = "";
  let sig = "";
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = v;
    if (k === "v1") sig = v;
  }

  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expectedHex = Array.from(new Uint8Array(expected))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedHex === sig;
}

async function handleStripeWebhook(env: Env, request: Request): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  const valid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body) as {
    type: string;
    data: { object: Record<string, any> };
  };

  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const figmaId = obj.metadata?.figma_id;
      const tier = obj.metadata?.tier || "pro";
      const subscriptionId = obj.subscription;
      if (figmaId && subscriptionId) {
        await env.DB.prepare(
          `INSERT INTO subscriptions (figma_id, stripe_subscription_id, tier, status)
           VALUES (?, ?, ?, 'active')
           ON CONFLICT(stripe_subscription_id) DO UPDATE SET
             tier = excluded.tier, status = 'active', updated_at = datetime('now')`
        ).bind(figmaId, subscriptionId, tier).run();
      }
      break;
    }

    case "customer.subscription.updated": {
      const subId = obj.id;
      const status = obj.status === "active" ? "active" : obj.status === "past_due" ? "past_due" : "canceled";
      const periodEnd = obj.current_period_end
        ? new Date(obj.current_period_end * 1000).toISOString()
        : null;
      const newTier = obj.metadata?.tier;

      await env.DB.prepare(
        `UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = datetime('now')
         ${newTier ? ", tier = '" + newTier + "'" : ""}
         WHERE stripe_subscription_id = ?`
      ).bind(status, periodEnd, subId).run();
      break;
    }

    case "customer.subscription.deleted": {
      await env.DB.prepare(
        `UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now')
         WHERE stripe_subscription_id = ?`
      ).bind(obj.id).run();
      break;
    }

    case "invoice.payment_failed": {
      const subId = obj.subscription;
      if (subId) {
        await env.DB.prepare(
          `UPDATE subscriptions SET status = 'past_due', updated_at = datetime('now')
           WHERE stripe_subscription_id = ?`
        ).bind(subId).run();
      }
      break;
    }
  }

  return new Response("ok", { status: 200 });
}
```

**Step 2: Commit**

```bash
git add token-rebinder-api/src/index.ts
git commit -m "feat(api): add Stripe webhook handler with signature verification"
```

---

### Task 5: Implement `handleCheckout()` (direct checkout without OAuth)

**Files:**
- Modify: `token-rebinder-api/src/index.ts`

For users who already have an account (re-upgrading, switching tiers), a direct checkout without re-doing OAuth.

```typescript
async function handleCheckout(env: Env, request: Request, origin?: string): Promise<Response> {
  const { figmaId, tier } = await request.json() as { figmaId: string; tier: string };

  const user = await env.DB.prepare(
    "SELECT stripe_customer_id FROM users WHERE figma_id = ?"
  ).bind(figmaId).first<{ stripe_customer_id: string | null }>();

  if (!user?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: "User not found. Use OAuth flow first." }), {
      status: 404,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const priceId = tier === "team" ? env.STRIPE_PRICE_TEAM : env.STRIPE_PRICE_PRO;

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      customer: user.stripe_customer_id,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      mode: "subscription",
      success_url: `${env.LANDING_URL}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.LANDING_URL}/upgrade?canceled=true`,
      "metadata[figma_id]": figmaId,
      "metadata[tier]": tier,
      "subscription_data[metadata][figma_id]": figmaId,
      "subscription_data[metadata][tier]": tier,
    }),
  });

  const session = await resp.json() as { url: string };
  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
```

**Step 3: Deploy Worker to Cloudflare**

```bash
cd /Users/andreasbember/Documents/Bember/token-rebinder-api
npx wrangler d1 migrations apply token-rebinder-db --remote
npx wrangler deploy
```

**Step 4: Commit**

```bash
git add token-rebinder-api/
git commit -m "feat(api): add direct checkout endpoint, deploy Worker"
```

---

### 🚦 Quality Gate 2: Backend Complete

- [ ] Worker deployed to Cloudflare
- [ ] D1 migration applied remotely
- [ ] `GET /license/<id>` returns `{"tier":"free","status":"none"}` from production URL
- [ ] `GET /auth/figma` redirects to Figma OAuth URL (verify redirect, don't complete)
- [ ] TypeScript compiles cleanly
- [ ] All secrets set: `wrangler secret put FIGMA_CLIENT_ID` etc. (manual — requires user to provide values from Figma Developer Settings and Stripe Dashboard)

**⚠️ User action required before proceeding:**
1. Create a Figma app at https://www.figma.com/developers → get `FIGMA_CLIENT_ID` and `FIGMA_CLIENT_SECRET`
2. Set callback URL to `https://token-rebinder-api.deashidle.workers.dev/auth/callback`
3. Create Stripe products/prices for Pro ($12/mo) and Team ($29/mo) → get price IDs
4. Set all 6 secrets via `wrangler secret put <NAME>`

---

### Task 6: Plugin License Integration

**Files:**
- Modify: `Token Rebinder/manifest.json` — add API domain to `networkAccess`
- Modify: `Token Rebinder/code.ts` — add `checkLicense()`, file gating, tier-aware messaging

**Step 1: Update manifest.json**

Change `networkAccess.allowedDomains` from `["none"]` to:
```json
"networkAccess": {
  "allowedDomains": ["https://token-rebinder-api.deashidle.workers.dev"]
}
```

**Step 2: Add license types and `checkLicense()` to `code.ts`**

Add at the top of the file, after the existing type declarations:

```typescript
type Tier = "free" | "pro" | "team";

interface LicenseCache {
  tier: Tier;
  checkedAt: number;
}

const API_BASE = "https://token-rebinder-api.deashidle.workers.dev";
const LICENSE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkLicense(): Promise<Tier> {
  try {
    var cached = await figma.clientStorage.getAsync("license") as LicenseCache | undefined;
    var now = Date.now();

    if (cached && cached.checkedAt && (now - cached.checkedAt) < LICENSE_TTL) {
      return cached.tier;
    }

    var user = figma.currentUser;
    if (!user) return "free";

    var resp = await fetch(API_BASE + "/license/" + user.id);
    if (!resp.ok) return cached ? cached.tier : "free";

    var data = await resp.json() as { tier: Tier };
    var license: LicenseCache = { tier: data.tier, checkedAt: now };
    await figma.clientStorage.setAsync("license", license);
    return data.tier;
  } catch (e) {
    var fallback = await figma.clientStorage.getAsync("license") as LicenseCache | undefined;
    return fallback ? fallback.tier : "free";
  }
}
```

**Step 3: Add file access gating**

```typescript
async function checkFileAccess(tier: Tier): Promise<boolean> {
  if (tier !== "free") return true;

  var fileKey = figma.fileKey;
  if (!fileKey) return true; // Can't determine — allow

  var stored = await figma.clientStorage.getAsync("activeFile") as string | undefined;
  if (!stored) {
    await figma.clientStorage.setAsync("activeFile", fileKey);
    return true;
  }
  return stored === fileKey;
}
```

**Step 4: Wire license check into the main message handler**

In the existing `figma.ui.onmessage` handler, before the learn/apply logic runs, add:

```typescript
// At the start of the 'run' handler:
var tier = await checkLicense();
var hasAccess = await checkFileAccess(tier);
if (!hasAccess) {
  figma.ui.postMessage({
    type: "upsell",
    feature: "multi-file",
    text: "Free tier is limited to one Figma file. Upgrade to Pro for unlimited files.",
  });
  return;
}

// After rebind completes (before postMessage 'done'), add tier to the results:
// figma.ui.postMessage({ type: "done", results: results, tier: tier });
```

**Step 5: Add version history metadata on Free tier**

After rebind completes, if `tier === "free"`:

```typescript
if (tier === "free") {
  figma.currentPage.setPluginData("token-rebinder", "Restored by Token Rebinder — " + new Date().toISOString());
}
```

**Step 6: Commit**

```bash
git add "Token Rebinder/manifest.json" "Token Rebinder/code.ts"
git commit -m "feat(plugin): add license check, file gating, tier-aware messaging"
```

---

### 🚦 Quality Gate 3: Plugin License Integration

- [ ] Plugin compiles (TypeScript check — Figma plugin uses ES2017 target, no optional catch binding, no `??`)
- [ ] Plugin opens without errors in Figma
- [ ] License check returns `free` (no subscription exists yet)
- [ ] Rebind still works exactly as before on the active file
- [ ] `upsell` message fires when opening a second file on free tier
- [ ] Plugin data set on page after free-tier rebind

---

### Task 7: Plugin UI — Upgrade Button, Tier Display, Soft Gating

**Files:**
- Modify: `Token Rebinder/ui.html`

**Step 1: Add tier display and upgrade button at the top of UI**

Above the options checkboxes, add:

```html
<div id="tier-bar" style="display:none; margin-bottom:12px; padding:8px; border-radius:6px; background:var(--figma-color-bg-secondary, #f0f0f0); font-size:11px; display:flex; justify-content:space-between; align-items:center;">
  <span id="tier-label">Free</span>
  <a id="upgrade-link" href="#" style="color:#0d99ff; text-decoration:none; font-weight:600; font-size:11px;">Upgrade to Pro →</a>
</div>
```

**Step 2: Add upsell modal / inline message**

Below the results section:

```html
<div id="upsell-section" style="display:none; margin-top:12px; padding:12px; border-radius:6px; background:linear-gradient(135deg, #0d99ff11, #00d4aa11); border:1px solid #0d99ff33;">
  <div style="font-weight:600; font-size:12px; margin-bottom:4px;" id="upsell-title">Unlock Pro</div>
  <div style="font-size:11px; color:#666; margin-bottom:8px;" id="upsell-text"></div>
  <button id="btn-upgrade" style="background:linear-gradient(135deg, #0d99ff, #00d4aa); width:auto; padding:6px 16px; font-size:11px;">Upgrade — $12/mo</button>
</div>
```

**Step 3: Add soft-gated buttons after the results stats**

Inside the `#results` div, after the unmapped section:

```html
<div id="pro-actions" class="section" style="margin-top:12px;">
  <button id="btn-export" style="background:var(--figma-color-bg-secondary, #eee); color:var(--figma-color-text, #333); font-size:11px; padding:6px;">
    Export Mapping (JSON) <span id="export-lock" style="opacity:0.5;">🔒</span>
  </button>
</div>
```

**Step 4: Wire up JS handlers**

Add to the `<script>` section:

```javascript
var currentTier = 'free';

// Handle tier info from plugin
window.addEventListener('message', function(event) {
  var msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === 'tier') {
    currentTier = msg.tier;
    var tierBar = document.getElementById('tier-bar');
    var tierLabel = document.getElementById('tier-label');
    var upgradeLink = document.getElementById('upgrade-link');
    var exportLock = document.getElementById('export-lock');

    tierBar.style.display = 'flex';
    if (currentTier === 'free') {
      tierLabel.textContent = 'Free';
      upgradeLink.style.display = 'inline';
      exportLock.style.display = 'inline';
    } else {
      tierLabel.textContent = currentTier.charAt(0).toUpperCase() + currentTier.slice(1);
      upgradeLink.style.display = 'none';
      exportLock.style.display = 'none';
    }
  }

  if (msg.type === 'upsell') {
    document.getElementById('upsell-section').style.display = 'block';
    document.getElementById('upsell-text').textContent = msg.text;
  }
});

document.getElementById('upgrade-link').addEventListener('click', function(e) {
  e.preventDefault();
  parent.postMessage({ pluginMessage: { type: 'open-upgrade' } }, '*');
});

document.getElementById('btn-upgrade').addEventListener('click', function() {
  parent.postMessage({ pluginMessage: { type: 'open-upgrade' } }, '*');
});

document.getElementById('btn-export').addEventListener('click', function() {
  if (currentTier === 'free') {
    document.getElementById('upsell-section').style.display = 'block';
    document.getElementById('upsell-text').textContent = 'Export token mappings as JSON is a Pro feature.';
    return;
  }
  parent.postMessage({ pluginMessage: { type: 'export-json' } }, '*');
});
```

**Step 5: Handle `open-upgrade` in `code.ts`**

In the message handler, add:

```typescript
if (msg.type === "open-upgrade") {
  figma.openExternal("https://token-rebinder-api.deashidle.workers.dev/auth/figma?tier=pro");
  return;
}
```

**Step 6: Send tier to UI on startup**

After `checkLicense()` completes, post to UI:

```typescript
figma.ui.postMessage({ type: "tier", tier: tier });
```

**Step 7: Commit**

```bash
git add "Token Rebinder/ui.html" "Token Rebinder/code.ts"
git commit -m "feat(plugin): add upgrade UI, soft gating, export lock"
```

---

### 🚦 Quality Gate 4: Plugin UI Complete

- [ ] Tier bar shows "Free" with "Upgrade to Pro →" link
- [ ] Clicking upgrade opens browser to Figma OAuth URL
- [ ] Export JSON button shows lock icon on Free, fires upsell
- [ ] After rebind, results display as before (no regression)
- [ ] Upsell message appears when attempting second file on Free
- [ ] On Pro tier (mock by setting clientStorage manually), lock icons disappear, upgrade link hides

---

### Task 8: Token Health Score — Computation + UI

**Files:**
- Modify: `Token Rebinder/code.ts` — add score computation, track totals
- Modify: `Token Rebinder/ui.html` — add Health Score card

**Step 1: Add total tracking to Results interface**

Add these fields to the `Results` interface in `code.ts`:

```typescript
// Totals for Health Score
totalPaintNodes: number;
totalLayoutNodes: number;
totalTextNodes: number;
totalEffectNodes: number;
```

**Step 2: Increment totals during `applyToNode()`**

In the `applyToNode` function, as nodes are visited, increment the appropriate total counter based on node type. Each node with fills/strokes increments `totalPaintNodes`, nodes with auto-layout props increment `totalLayoutNodes`, text nodes increment `totalTextNodes`, nodes with effects increment `totalEffectNodes`.

**Step 3: Compute Health Score after rebind**

After the apply loop completes (before `postMessage('done')`):

```typescript
var totalRebound = results.fillsRebound + results.strokesRebound + results.spacingRebound
  + results.radiusRebound + results.dimensionsRebound + results.effectFieldsRebound
  + results.strokeWeightRebound + results.typoVarsRebound + results.textStylesRebound
  + results.fontsFixed + results.layoutGridsRebound + results.opacityRebound
  + results.visibilityRebound + results.gridGapsRebound + results.charactersRebound
  + results.componentPropsRebound;

var totalScanned = results.totalPaintNodes + results.totalLayoutNodes
  + results.totalTextNodes + results.totalEffectNodes;

var healthScore = totalScanned > 0 ? Math.round((totalRebound / totalScanned) * 100) : 0;
healthScore = Math.min(healthScore, 100); // Cap at 100

var categoryScores = {
  colors: results.totalPaintNodes > 0
    ? Math.round(((results.fillsRebound + results.strokesRebound) / results.totalPaintNodes) * 100) : 0,
  layout: results.totalLayoutNodes > 0
    ? Math.round(((results.spacingRebound + results.radiusRebound + results.dimensionsRebound + results.gridGapsRebound) / results.totalLayoutNodes) * 100) : 0,
  typography: results.totalTextNodes > 0
    ? Math.round(((results.typoVarsRebound + results.textStylesRebound + results.fontsFixed) / results.totalTextNodes) * 100) : 0,
  effects: results.totalEffectNodes > 0
    ? Math.round((results.effectFieldsRebound / results.totalEffectNodes) * 100) : 0,
};
```

Include `healthScore` and `categoryScores` in the `done` message.

**Step 4: Add Health Score card to `ui.html`**

After the unmapped-section div:

```html
<div id="health-section" class="section" style="display:none; margin-top:12px; padding:12px; border-radius:8px; background:linear-gradient(135deg, #1a1a2e, #16213e); color:#fff;">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
    <span style="font-weight:600; font-size:12px;">Token Health Score</span>
    <span id="health-score" style="font-size:24px; font-weight:700; font-variant-numeric:tabular-nums;"></span>
  </div>
  <div id="health-bar" style="height:6px; border-radius:3px; background:rgba(255,255,255,0.15); margin-bottom:10px;">
    <div id="health-fill" style="height:100%; border-radius:3px; background:linear-gradient(90deg, #00d4aa, #0d99ff); transition:width 0.6s ease;"></div>
  </div>
  <div id="health-categories" style="font-size:10px;"></div>
  <div style="margin-top:10px; display:flex; gap:6px;">
    <button id="btn-share" style="flex:1; background:rgba(255,255,255,0.15); color:#fff; font-size:10px; padding:6px; margin:0;">
      Share Score Card <span id="share-lock" style="opacity:0.5;">🔒</span>
    </button>
  </div>
</div>
```

**Step 5: Wire up Health Score display in JS**

```javascript
// Inside the 'done' handler:
if (msg.healthScore !== undefined) {
  var hs = document.getElementById('health-section');
  hs.style.display = 'block';
  document.getElementById('health-score').textContent = msg.healthScore + '%';
  document.getElementById('health-fill').style.width = msg.healthScore + '%';

  var cats = msg.categoryScores;
  var catHtml = '';
  var catNames = { colors: 'Colors', layout: 'Layout', typography: 'Typography', effects: 'Effects' };
  for (var key in catNames) {
    var val = cats[key] || 0;
    var dots = '';
    for (var d = 0; d < 5; d++) {
      dots += d < Math.round(val / 20) ? '●' : '○';
    }
    catHtml += '<div style="display:flex;justify-content:space-between;padding:2px 0;">' +
      '<span>' + catNames[key] + ' <span style="opacity:0.5;">' + dots + '</span></span>' +
      '<span style="font-weight:600;">' + val + '%</span></div>';
  }
  document.getElementById('health-categories').innerHTML = catHtml;

  // Lock share button on free
  if (currentTier !== 'free') {
    document.getElementById('share-lock').style.display = 'none';
  }
}
```

**Step 6: Commit**

```bash
git add "Token Rebinder/code.ts" "Token Rebinder/ui.html"
git commit -m "feat(plugin): add Token Health Score computation and UI card"
```

---

### 🚦 Quality Gate 5: Health Score

- [ ] Health Score card appears after rebind with correct overall %
- [ ] Category breakdown shows Colors, Layout, Typography, Effects with dot indicators
- [ ] Progress bar fills to correct width
- [ ] Share button shows lock on Free tier
- [ ] Score is 0% when no bindings restored (edge case: empty frame)
- [ ] Score caps at 100% (never exceeds)

---

### Task 9: Landing Page — Upgrade Flow

**Files:**
- Create: `token-rebinder-site/src/app/upgrade/page.tsx`
- Create: `token-rebinder-site/src/app/upgrade/success/page.tsx`

**Step 1: Create `/upgrade` page**

This is a static page that redirects to the Worker's OAuth endpoint. Since `output: "export"`, this is a client component.

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { ArrowRight, Crown } from "@phosphor-icons/react";

const API_BASE = "https://token-rebinder-api.deashidle.workers.dev";

function UpgradeContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const canceled = params.get("canceled");

  function handleUpgrade(tier: string) {
    window.location.href = `${API_BASE}/auth/figma?tier=${tier}`;
  }

  return (
    <main style={{ /* centered layout, dark theme matching landing page */ }}>
      <h1>Upgrade Token Rebinder</h1>

      {error && <p className="error">Authentication failed. Please try again.</p>}
      {canceled && <p className="info">Checkout was canceled. You can try again anytime.</p>}

      {/* Pro card */}
      <div className="plan-card">
        <h2>Pro — $12/month</h2>
        <ul>
          <li>Unlimited Figma files</li>
          <li>Batch rebind (all pages)</li>
          <li>Share Token Health Score card</li>
          <li>Export mapping as JSON</li>
          <li>No watermark</li>
        </ul>
        <button onClick={() => handleUpgrade("pro")}>
          Upgrade to Pro <ArrowRight />
        </button>
      </div>

      {/* Team card */}
      <div className="plan-card">
        <h2>Team — $29/month per editor</h2>
        <ul>
          <li>Everything in Pro</li>
          <li>Token Rulebook</li>
          <li>Cross-file scoring</li>
          <li>API access</li>
          <li>Audit log</li>
        </ul>
        <button onClick={() => handleUpgrade("team")}>
          Upgrade to Team <ArrowRight />
        </button>
      </div>
    </main>
  );
}

export default function UpgradePage() {
  return (
    <Suspense>
      <UpgradeContent />
    </Suspense>
  );
}
```

**Step 2: Create `/upgrade/success` page**

```tsx
"use client";

import { Suspense } from "react";
import { CheckCircle } from "@phosphor-icons/react";

function SuccessContent() {
  return (
    <main style={{ /* centered, celebration theme */ }}>
      <CheckCircle size={64} color="#00d4aa" weight="fill" />
      <h1>You're Pro!</h1>
      <p>Token Rebinder Pro is now active. Return to Figma and run the plugin — your license will sync automatically within a few seconds.</p>
      <a href="https://www.figma.com" className="btn">Return to Figma →</a>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense>
      <SuccessContent />
    </Suspense>
  );
}
```

**Step 3: Build and deploy**

```bash
cd /Users/andreasbember/Documents/Bember/token-rebinder-site
npm run build
npx wrangler pages deploy out --project-name token-rebinder --branch main
```

**Step 4: Commit**

```bash
git add token-rebinder-site/src/app/upgrade/
git commit -m "feat(site): add upgrade and success pages for Pro tier"
```

---

### Task 10: Export JSON (Pro Feature)

**Files:**
- Modify: `Token Rebinder/code.ts` — handle `export-json` message, collect mapping data
- Modify: `Token Rebinder/ui.html` — receive and download JSON blob

**Step 1: In `code.ts`, after rebind completes, store the learned mapping**

Build a JSON-serializable mapping from the `LearnedStore`:

```typescript
// In the 'export-json' message handler:
if (msg.type === "export-json") {
  // lastStore and lastResults should be stored in module scope after each run
  var mapping = {
    fileKey: figma.fileKey,
    exportedAt: new Date().toISOString(),
    colors: Array.from(lastStore.colors.entries()).map(function(e) {
      return { hex: e[0], variable: e[1].name };
    }),
    floats: Array.from(lastStore.floats.entries()).map(function(e) {
      return { key: e[0], variable: e[1].name };
    }),
    textStyles: Array.from(lastStore.textStyles.entries()).map(function(e) {
      return { key: e[0], styleId: e[1].textStyleId };
    }),
    healthScore: lastHealthScore,
    results: lastResults,
  };
  figma.ui.postMessage({ type: "export-data", json: JSON.stringify(mapping, null, 2) });
}
```

**Step 2: In `ui.html`, handle the download**

```javascript
if (msg.type === 'export-data') {
  var blob = new Blob([msg.json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'token-rebinder-mapping.json';
  a.click();
  URL.revokeObjectURL(url);
}
```

**Step 3: Commit**

```bash
git add "Token Rebinder/code.ts" "Token Rebinder/ui.html"
git commit -m "feat(plugin): add JSON export for Pro tier"
```

---

### 🚦 Quality Gate 6: End-to-End Flow

- [ ] Full upgrade flow: plugin → upgrade page → Figma OAuth → Stripe Checkout (use Stripe test mode)
- [ ] After payment, `/license/<figmaId>` returns `{"tier":"pro"}`
- [ ] Plugin picks up Pro tier on next open (or after clearing clientStorage and re-checking)
- [ ] Export JSON downloads a valid JSON file with color/float mappings
- [ ] Health Score share button unlocked on Pro
- [ ] Free tier: single-file restriction works, upsell shows on second file
- [ ] Free tier: version history metadata set after rebind
- [ ] Webhook handles cancellation → license downgrades to free
- [ ] Landing page deployed with /upgrade and /upgrade/success routes

---

## Overview

### How to test the full flow locally

1. **Worker**: `cd token-rebinder-api && npx wrangler dev` (runs on localhost:8787)
2. **Landing site**: `cd token-rebinder-site && npm run dev` (runs on localhost:3000)
3. **Stripe**: Use test mode keys. Create test products/prices in Stripe Dashboard.
4. **Figma OAuth**: Register a Figma app with callback URL pointing to your Worker (use the deployed URL, not localhost, since Figma requires HTTPS).
5. **Stripe webhooks**: Use `stripe listen --forward-to localhost:8787/webhooks/stripe` for local testing.
6. **Plugin**: Load in Figma from the local dev path. Test license check by manually setting `clientStorage` values.

### Secrets checklist (user must configure)

```bash
cd token-rebinder-api
npx wrangler secret put FIGMA_CLIENT_ID
npx wrangler secret put FIGMA_CLIENT_SECRET
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_PRO
npx wrangler secret put STRIPE_PRICE_TEAM
```

### Architecture recap

```
Plugin (code.ts)
  ├── checkLicense() → GET /license/:id (cached 7 days)
  ├── checkFileAccess() → clientStorage gating
  ├── open-upgrade → figma.openExternal → /auth/figma
  └── export-json → builds JSON from LearnedStore

Worker (token-rebinder-api)
  ├── GET /auth/figma → redirect to Figma OAuth
  ├── GET /auth/callback → exchange code, upsert user, create Stripe Checkout
  ├── POST /checkout → direct checkout for existing users
  ├── POST /webhooks/stripe → subscription lifecycle
  └── GET /license/:id → tier lookup from D1

Landing (token-rebinder-site)
  ├── / → marketing page (existing)
  ├── /upgrade → tier selection, redirects to Worker OAuth
  └── /upgrade/success → post-payment confirmation
```
