# Token Rebinder — Plugin Publish Checklist

## Prerequisites
- [ ] OAuth app approved by Figma (check developer console)
- [ ] Worker API deployed and responding at `token-rebinder-api.andreas-everform.workers.dev`
- [ ] Landing site deployed at `tokenrebinder.everform.io`
- [ ] Stripe keys: switch from test to live mode when ready for real payments
- [ ] All 3 repos committed with clean git status

## Publish Steps (Figma Desktop)
1. Open Figma Desktop
2. Plugins > Development > Token Rebinder
3. Right-click > "Publish new release"
4. Fill in release notes:

> **v2.0 — Pro Tier + Token Health Score**
>
> - 50/51 variable binding types (colors, spacing, radius, typography, effects, layout grids, component properties, and more)
> - Token Health Score: see how well your file's tokens are bound
> - Pro tier: unlimited files, JSON export, shareable health cards
> - Improved progress reporting and error visibility
> - Anonymous usage telemetry (counts only, no PII)

5. Submit for review

## Post-Publish Verification
- [ ] Plugin installs from Figma Community page
- [ ] Free tier: rebind works, export/share gated, upsell appears
- [ ] Upgrade flow: "Upgrade to Pro" opens browser > Figma OAuth > Stripe Checkout
- [ ] Pro tier: export works, share works, no upsell
- [ ] Telemetry: check D1 for `plugin_open` and `plugin_run` events from real users

## Going Live with Stripe
When ready for real payments:
1. Create live Stripe products/prices (same structure as test)
2. Update Worker secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`
3. Update Stripe webhook endpoint to use live key
4. Remove the 100% discount test coupon
5. Test one real $12 charge with your own card, then refund

## Monitoring
Query telemetry:
```bash
npx wrangler d1 execute token-rebinder-db --remote \
  --command="SELECT event_type, tier, COUNT(*) as count FROM events GROUP BY event_type, tier ORDER BY count DESC"
```

Check subscriptions:
```bash
npx wrangler d1 execute token-rebinder-db --remote \
  --command="SELECT s.tier, s.status, u.figma_name FROM subscriptions s JOIN users u ON s.figma_id = u.figma_id"
```

## Tech Debt (Post-Launch)
1. OAuth state validation (CSRF protection)
2. Server-side license enforcement for gated actions
3. OG social share image (1200x630)
4. Health score formula: switch to binding-opportunity count denominator
5. Telemetry dashboard (pipe D1 to a BI tool or build a simple admin page)
6. Per-page metadata for upgrade/success pages
