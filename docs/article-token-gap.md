# The Token Gap: Why Code-to-Canvas Breaks Your Design System

*By Andreas Hidle*

---

**TL;DR:** Every code-to-canvas tool strips your Figma variable bindings. The browser resolves tokens to computed values before the capture layer sees them, so your design system connections are lost on every push. [Token Rebinder](https://www.figma.com/community/plugin/1616450671951147919) restores them by learning from your existing bound frames and reapplying the correct variables automatically. 4,354 bindings restored in under 30 seconds on a production portal.

---

You just shipped a polished React component. The design system team wants it in Figma for documentation. You run a code-to-canvas tool — whether an official Figma feature, a community plugin, or an internal pipeline — and the frame appears. Pixel-perfect.

Then someone opens the inspect panel.

Every color is a hardcoded hex. Every spacing value is a raw number. Every text style is detached. The variable bindings that make your design system *a system* are gone.

This is the token gap.

## Why It Matters More Than You Think

The instinct is to shrug. Rebind a few tokens, move on. But consider the scale of a real design system.

A single detail page in a production portal contains hundreds of color references, dozens of spacing tokens, typography bindings, border radii, and opacity values. In my own production work, a typical page breaks down to:

| Category | Bindings per page |
|----------|-------------------|
| Colors (fills + strokes) | ~180 |
| Spacing (padding + gap) | ~90 |
| Typography (font, size, weight, line-height) | ~60 |
| Border radius | ~30 |
| Effects, dimensions, misc | ~25 |

Across a full application with list views, detail views, edit forms, and modals, you are looking at thousands of bindings per push.

Manual rebinding is not a workflow. It is a punishment.

The cost is not just time. Unbound frames become invisible liabilities. They look correct today, but they will not respond when you update a variable. Change your primary brand color from teal to indigo, and every pushed frame stays frozen in the old palette. Your Figma file becomes a minefield of frames that look like part of the system but are not.

## Why Every Capture Tool Has This Problem

These tools do not parse your source code. They do not read your SCSS tokens or CSS custom properties. They render your component in a browser, then serialize the computed result back into Figma nodes.

When the browser resolves `var(--surface-brand-default)` to `#0F3549`, that is what the capture tool sees. The variable name is gone — resolved at compute time. The capture operates on the output, not the input.

This is not a bug in any particular tool. It is a fundamental limitation of capture-based architecture. The tools work at the wrong layer of abstraction: computed CSS values, not design tokens. The semantic meaning — "this is the brand surface color" — is lost the moment the browser evaluates the stylesheet.

The same applies to every token type. `gap: var(--space-4)` becomes `gap: 16px`. `border-radius: var(--radius-lg)` becomes `border-radius: 8px`. Every token reference collapses into its computed value.

## For Developers: Why This Is Your Problem Too

If you work on a product that maintains Figma as a source of truth — or even as documentation — the token gap creates a silent rift between your codebase and the design file.

Your CI pipeline pushes Storybook frames to Figma for visual QA. The QA team inspects them. They see `#0F3549` instead of `Text/Primary`. They file a bug: "wrong color." It is not wrong — it is the correct computed value. But the inspection context is lost because the binding is gone.

Or: the design system team updates a spacing scale. Every hand-built Figma frame updates automatically. Your code-pushed frames do not. Now the design file shows two versions of the same component, and nobody notices until a developer implements the wrong one.

The token gap turns Figma from a single source of truth into a split-brain system.

## Why Simple Matching Falls Short

The obvious approach: scan your variable definitions, match hex values, rebind. This works partially but breaks in two ways.

**Library variables.** Most mature design systems publish variables from a shared library file. When you consume those variables downstream, they are library references, not local definitions. Plugins that only read local variable collections will never find them.

**Ambiguous matches.** `#FFFFFF` might map to `surface/base/default`, `text/inverse`, `icon/on-color`, or a dozen other semantic tokens. Without context about how a value is used, matching against definitions alone produces incorrect bindings. A white fill is not the same token as white text.

## Learning From Context

I built [Token Rebinder](https://www.figma.com/community/plugin/1616450671951147919) to approach this from the opposite direction. Instead of matching against definitions, it learns from your existing design.

Select the frames that lost their bindings, click Rebind. Four phases, fully automatic:

**Phase 1: Learn.** The plugin scans every other frame on your page — the ones that still have correct bindings — and reads the `boundVariables` property on every node. It builds a contextual lookup map: for each combination of value and field type (fill, stroke, padding, gap, font size, opacity, etc.), it records which variable was bound.

This is the key insight. A `#FFFFFF` used as a fill maps to one variable. The same `#FFFFFF` used as a text color maps to another. Field context disambiguates. And because the plugin reads `boundVariables` through the Figma Plugin API, it resolves library variables transparently.

**Phase 2: Upgrade.** Where a raw value matches a primitive (non-aliased) variable, the plugin checks whether an alias chain exists to upgrade it to a semantic token. Your `gray-100` becomes `surface/base/default`.

**Phase 3: Fallback.** For values that exist in your local collections but were never bound in the source frames, the plugin creates direct bindings as a fallback.

**Phase 4: Apply.** The plugin walks every node in your selection, checks each property against the learned map, and restores the variable binding. Fuzzy color matching catches values that shifted slightly during the capture round-trip.

This covers 50 of 51 variable binding types the Figma Plugin API exposes: solid fills, strokes, all padding and gap directions, border radius per corner, min/max dimensions, the full typography stack (family, size, weight, line height, letter spacing, paragraph spacing), individual effect properties, layout grid fields, opacity, visibility, stroke weight, and component property bindings. The only unsupported type is `textRangeFills` — mixed text colors within a single text node — which requires character-range-level binding that the current API does not support for bulk operations.

## Results

I tested Token Rebinder on a production portal — an admin interface with driver detail pages, vehicle views, parking session breakdowns, and customer management screens.

After pushing code-generated frames back to Figma: **4,354 variable bindings restored in under 30 seconds.** Colors, spacing, typography, border radii, effects, layout grids, and component properties — all restored to their correct semantic tokens, including library variables from a shared design system file.

The frames went from "looks right but is dead" to "fully participates in the design system." Change a brand color in the library, and every restored frame updates.

The plugin also generates a Token Health Score after each run — a percentage showing how many available bindings were successfully restored, broken down by category. A quick way to gauge how well a file holds together after a code push.

## The Bigger Question

Token Rebinder solves the rebinding problem after the gap has occurred. The larger question: can the gap be closed upstream?

The real fix would be for capture tools to emit Figma nodes with variable bindings intact — carrying token semantics through the render-and-capture pipeline. That requires the capture layer to understand the token system, not just the pixels. As far as I know, no tool does this today.

Until that happens, the gap is structural. If your workflow includes any code-to-canvas step — for documentation, design QA, or keeping Figma in sync with production — bindings will break on every push.

Token Rebinder closes the gap. In seconds, not hours.

---

*[Token Rebinder](https://www.figma.com/community/plugin/1616450671951147919) is a free Figma plugin. All 50 binding types, unlimited rebinds, single file. [Pro](https://tokenrebinder.everform.io/upgrade) unlocks multi-file, batch processing, JSON export, and shareable health scores for teams.*
