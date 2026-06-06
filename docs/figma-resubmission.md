# Token Rebinder — Figma Resubmission Pack

**Context:** Figma rejected the original submission with the message:
> "We are taken to payment page and unable to confirm if the connection to Figma was successful. Either provide pro testing credentials or a video showing the user flow."

The fix is structural, not procedural: the full plugin is now free for everyone. Reviewers no longer hit a paywall during their core review flow. The only paid surface (Team tier — shared rulebooks, audit log, API access) is an org-level feature reachable from a clearly labeled secondary link.

---

## Summary of Changes

### Plugin
- Removed the one-file lock on Free tier (`checkFileAccess`) — Free now supports unlimited files.
- Removed the Pro gate on JSON export — Free now exports.
- Removed the version-history watermark on Free runs.
- Tier bar reads "Free for everyone" with a small "For teams →" secondary link (no $12/mo CTA in the plugin).
- Upsell text and CTA copy reframed from "Upgrade — $12/mo" to "Learn about Team →".
- "Upgrade" link now opens `https://tokenrebinder.everform.io/upgrade` (the Free + Team page) instead of the OAuth flow directly.

### Landing site (`/upgrade`)
- Plan cards restructured: **Free** (primary) and **Team $29/mo** (secondary).
- Removed the $12 Pro tier entirely.
- Headline: "Free for everyone. Team for organizations."
- Free CTA goes to Figma Community install link (no auth flow). Team CTA still flows through Figma OAuth → Stripe.
- Footer copy: "Free for everyone. Team for organizations."

### Worker API
- Default tier on `/auth/figma` is now `team` (no Pro tier sold).
- Existing Pro subscribers still grandfather (license check returns whatever's in D1).
- All other endpoints unchanged.

---

## Email Reply to Figma

> Subject: Re: Token Rebinder review — paywall removed, ready for re-review
>
> Hi Figma team,
>
> Thank you for the review feedback. You were right that the previous submission left reviewers stuck on a Stripe page with no way to verify the post-payment experience.
>
> We've restructured the plugin's pricing model in response. **The full rebinding tool is now free for everyone** — all 50 binding types, unlimited files, JSON export, Token Health Score — with no paywall blocking any core functionality. Reviewers can now verify every feature without ever encountering Stripe.
>
> The only paid surface is an optional **Team** tier ($29/month per editor, 3+ seats) for design-system organizations that want shared rulebooks, cross-file consistency scoring, audit logs, and API access. This is reachable only via a small "For teams →" secondary link in the plugin tier bar, and is clearly labeled on the landing page.
>
> The plugin has been recompiled and a new release submitted from Figma Desktop. Please re-review when convenient. Happy to provide a screen recording of the full free flow if helpful.
>
> Thanks,
> Andreas

---

## Optional: Loom script (90 seconds)

If you want to send a video alongside the email (helps speed up review):

1. **0:00–0:10** — Open Figma Desktop. Show: "Token Rebinder is free for everyone. Watch the full flow — no paywall."
2. **0:10–0:25** — Open a Figma file with existing variable bindings. Run plugin via menu.
3. **0:25–0:35** — Show plugin UI. Point out "Free for everyone" tier bar and the "For teams →" secondary link (don't click it).
4. **0:35–0:55** — Select a frame with hardcoded hex values (e.g., a frame imported from `generate_figma_design`). Click "Rebind Selected Frame". Show all 4 phases run, then show the results panel — fills, strokes, spacing, typography, etc., all rebound.
5. **0:55–1:10** — Click "Export JSON Mapping" — show the file downloads (no paywall). Click "Share Score Card" — show it works.
6. **1:10–1:20** — Click "For teams →" link to show the landing page. Show Free + Team plan cards. Highlight: Free = full plugin, Team = org-level features.
7. **1:20–1:30** — Close. "All core functionality is free. The Team tier is org-only. Ready for review."
