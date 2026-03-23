# Token Rebinder — Pro Tier Architecture

> Design doc for monetization infrastructure
> Date: 2026-03-20
> Product: Hidle Everform

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| License validation | Periodic check + `clientStorage` cache | Fast UX, no network on every run |
| Identity | Figma OAuth | Seamless upgrade flow, no copy-paste |
| Health Score computation | Client-side (plugin) | Plugin already has the data, ship fast |
| Feature gating | Soft gate — run everything, upsell on outputs | Give value first, monetize second |
| Backend | Cloudflare Worker + D1 | Matches existing stack, zero cold start |

---

## Tier Matrix

| Feature | Free | Pro ($12/mo) | Team ($29/mo) |
|---------|------|-------------|---------------|
| Rebind all 50 binding types | ✅ | ✅ | ✅ |
| Single file | ✅ | ✅ | ✅ |
| Unlimited files | ❌ (1 file) | ✅ | ✅ |
| Batch rebind (multi-page) | ❌ | ✅ | ✅ |
| Token Health Score (view) | ✅ | ✅ | ✅ |
| Token Health Score (share) | ❌ | ✅ | ✅ |
| Export mapping as JSON | ❌ | ✅ | ✅ |
| Version history watermark | "Restored by Token Rebinder" | None | None |
| Team token library sync | ❌ | ❌ | ✅ |
| Token Rulebook | ❌ | ❌ | ✅ |
| Cross-file scoring | ❌ | ❌ | ✅ |
| API access | ❌ | ❌ | ✅ |
| Audit log | ❌ | ❌ | ✅ |

### "Single file" gating logic

Free tier tracks `fileKey` in `clientStorage`. First file used becomes the active file. User can switch files manually (clears the active file), but can only have one at a time. Pro removes this restriction entirely.

---

## System Architecture

```
┌──────────────────┐       ┌──────────────────────────┐
│  Figma Plugin    │       │  tokenrebinder.everform.io│
│  (ui.html +      │       │  Landing page             │
│   code.ts)       │       │  (Next.js static)         │
│                  │       │                            │
│  clientStorage:  │       │  /upgrade → Stripe Checkout│
│  - license cache │       │  /auth/callback            │
│  - active fileKey│       └───────────┬────────────────┘
└────────┬─────────┘                   │
         │                             │
         │  GET /license/:figmaUserId  │
         │  (weekly check)             │
         ▼                             ▼
┌──────────────────────────────────────────────┐
│  Cloudflare Worker: token-rebinder-api       │
│                                              │
│  Routes:                                     │
│    GET  /auth/figma         → Figma OAuth    │
│    GET  /auth/callback      → exchange code  │
│    POST /checkout           → Stripe session │
│    POST /webhooks/stripe    → sub events     │
│    GET  /license/:figmaUid  → return tier    │
│                                              │
│  Storage: D1 (SQLite)                        │
│    users: figmaId, email, name, createdAt    │
│    subscriptions: figmaId, stripeId, tier,   │
│                   status, currentPeriodEnd   │
└──────────────────────────────────────────────┘
```

---

## Database Schema (D1)

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

---

## Auth Flow (Figma OAuth)

```
1. User clicks "Upgrade to Pro" in plugin UI
2. Plugin opens browser: https://tokenrebinder.everform.io/upgrade
3. Landing page redirects to Figma OAuth:
     https://www.figma.com/oauth?
       client_id=FIGMA_CLIENT_ID&
       redirect_uri=https://token-rebinder-api.YOUR.workers.dev/auth/callback&
       scope=file_read&
       state=<random_nonce>&
       response_type=code
4. User authorizes → Figma redirects to /auth/callback?code=XXX
5. Worker exchanges code for access token → calls Figma API /v1/me → gets userId + email
6. Worker upserts user in D1
7. Worker creates Stripe Checkout session with metadata: { figmaId }
8. Redirect user to Stripe Checkout
9. User pays → Stripe fires webhook → Worker updates subscription in D1
10. Landing page shows "You're Pro! Return to Figma."
```

---

## License Check Flow (Plugin)

```typescript
// On plugin open (not on every run):
async function checkLicense(): Promise<'free' | 'pro' | 'team'> {
  const cached = await figma.clientStorage.getAsync('license');
  const now = Date.now();

  // Cache valid for 7 days
  if (cached && cached.checkedAt && (now - cached.checkedAt) < 7 * 24 * 60 * 60 * 1000) {
    return cached.tier;
  }

  const user = figma.currentUser;
  if (!user) return 'free';

  try {
    // networkAccess must allow the API domain
    const resp = await fetch(`https://token-rebinder-api.YOUR.workers.dev/license/${user.id}`);
    if (!resp.ok) return cached?.tier || 'free';

    const data = await resp.json();
    const license = { tier: data.tier, checkedAt: now };
    await figma.clientStorage.setAsync('license', license);
    return data.tier;
  } catch {
    // Offline / error → use cached or default to free
    return cached?.tier || 'free';
  }
}
```

---

## Token Health Score

### What it measures

After every rebind, the plugin computes a health score from the Results object:

```
Score = (total bindings restored) / (total bindable properties scanned) × 100
```

Breakdown by category:
- Colors: fills + strokes rebound vs total paint nodes
- Layout: spacing + radius + dimensions vs total layout nodes
- Typography: text styles + typo vars + fonts vs total text nodes
- Effects: effect fields rebound vs total effect nodes

### Display

After rebind completes, show a Health Score card below the results:

```
┌─────────────────────────────┐
│  Token Health Score    87%  │
│  ████████████████░░░        │
│                             │
│  Colors     ●●●●●○  92%    │
│  Layout     ●●●●○○  85%    │
│  Typography ●●●●●○  90%    │
│  Effects    ●●●○○○  72%    │
│                             │
│  [Share Score Card] 🔒 Pro  │
│  [Export JSON]      🔒 Pro  │
└─────────────────────────────┘
```

Free users see the score. "Share" and "Export" buttons show a lock icon → clicking opens upgrade flow.

### Share card (Pro)

Generates a branded PNG (via plugin UI canvas):
- Dark background with Token Rebinder logo
- Large score number + ring chart
- Category breakdown
- File name and date
- "tokenrebinder.everform.io" watermark

Shareable on Twitter/LinkedIn. This is the viral mechanic.

---

## Soft Gating Implementation

### Free tier file tracking

```typescript
async function checkFileAccess(fileKey: string, tier: string): Promise<boolean> {
  if (tier !== 'free') return true; // Pro/Team = unlimited

  const stored = await figma.clientStorage.getAsync('activeFile');
  if (!stored) {
    // First use — register this file
    await figma.clientStorage.setAsync('activeFile', fileKey);
    return true;
  }
  if (stored === fileKey) return true;

  // Different file — show upsell
  return false;
}
```

### Version history watermark (Free)

After rebind completes on Free tier, the plugin adds a small text node (1px, hidden off-canvas) with "Restored by Token Rebinder" — visible in version history diff but not in the design. Removed for Pro/Team.

Actually — simpler: use `figma.currentPage.setPluginData('rebinder', timestamp)`. Shows in version history metadata without visual pollution.

### Batch mode (Pro)

Free: "Rebind Selected Frame" button only.
Pro: Additional "Rebind All Pages" button appears. Iterates through all pages, applies learn→apply to each.

---

## Implementation Plan

### Phase 1: Backend API (Cloudflare Worker + D1)
1. Create `token-rebinder-api` Worker
2. D1 database with users + subscriptions tables
3. Figma OAuth endpoints (/auth/figma, /auth/callback)
4. Stripe integration (POST /checkout, POST /webhooks/stripe)
5. License endpoint (GET /license/:figmaUserId)
6. Environment secrets: FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

### Phase 2: Plugin license integration
1. Update manifest.json: `networkAccess.allowedDomains` → add API domain
2. Add `checkLicense()` to plugin startup
3. Add file tracking for Free tier
4. Add upgrade button to UI → opens browser to landing page /upgrade
5. Soft-gate Export JSON and Share buttons

### Phase 3: Token Health Score
1. Compute score from Results object after rebind
2. Add Health Score card to UI
3. Add share card generation (canvas-based PNG)
4. Add Export JSON functionality

### Phase 4: Landing page upgrade flow
1. Add /upgrade route to Next.js site
2. Figma OAuth redirect
3. Stripe Checkout integration
4. Post-payment confirmation page

### Phase 5: Stripe webhook handling
1. `checkout.session.completed` → activate subscription
2. `customer.subscription.updated` → tier change
3. `customer.subscription.deleted` → downgrade to free
4. `invoice.payment_failed` → set status past_due

---

## Environment & Secrets

| Secret | Source | Where |
|--------|--------|-------|
| FIGMA_CLIENT_ID | Figma Developer Settings | Worker env |
| FIGMA_CLIENT_SECRET | Figma Developer Settings | Worker env |
| STRIPE_SECRET_KEY | Stripe Dashboard | Worker env |
| STRIPE_WEBHOOK_SECRET | Stripe Dashboard | Worker env |
| STRIPE_PRICE_PRO | Stripe Product/Price ID | Worker env |
| STRIPE_PRICE_TEAM | Stripe Product/Price ID | Worker env |

---

## Open Questions (for later)

- **Team tier seat management**: How does the first Team subscriber add teammates? Probably via a dashboard on the landing site.
- **Figma OAuth scope**: `file_read` is minimum. Do we need more for Team features?
- **Rate limiting**: License endpoint should be rate-limited per figmaUserId to prevent abuse.
- **Analytics**: Should the plugin send anonymous usage metrics (rebind count, categories used) for product decisions?
