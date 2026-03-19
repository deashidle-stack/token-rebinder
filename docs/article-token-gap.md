# The Token Gap: Why Code-to-Canvas Breaks Your Design System (and How to Fix It)

*By Andreas Hidle*

---

You just shipped a polished React component. The design system team wants it reflected back in Figma for documentation. You use one of the code-to-canvas tools — Figma's `generate_figma_design`, `html.to" design`, or a similar capture-based plugin — and the frame appears on your canvas. It looks correct. The pixels are right.

Then someone on your team opens the inspect panel. Every color is a hardcoded hex value. Every spacing value is a raw number. Every text style is detached. Your meticulously maintained variable bindings — the ones that make your design system actually *systematic* — are gone.

Welcome to the token gap.

## The Problem Is Bigger Than It Looks

At first glance, a few missing variable bindings seem like a minor inconvenience. Rebind them manually, move on. But consider the scale of a real design system.

A single detail page in our production portal — drivers, vehicles, parking sessions — contains hundreds of color references, dozens of spacing tokens, typography bindings, border radii, and opacity values. Across a full portal with list views, detail views, edit forms, and modals, you are looking at thousands of token bindings per push.

Manual rebinding is not a workflow. It is a punishment.

And the cost is not just time. Unbound frames become invisible liabilities. They look correct today, but they will not respond when you update a variable. Change your primary brand color from teal to indigo, and every pushed frame stays frozen in the old palette while your hand-built frames update automatically. Your Figma file becomes a minefield of frames that look like part of the system but are not.

## Why This Happens: The Capture Architecture

To understand why every code-to-canvas tool has this problem, you need to understand what "capture" actually means.

These tools do not read your source code. They do not parse your SCSS tokens or your CSS custom properties. They render your page in a browser (or a headless browser), then serialize the computed result — the final pixels — back into Figma nodes.

When the browser resolves `var(--surface-brand-default)` to `#0F3549`, that is what the capture tool sees. The variable name is gone. It was resolved at render time, and the capture operates on the output, not the input.

This is not a bug in any particular tool. It is a fundamental limitation of the architecture. Capture-based tools work at the wrong layer of abstraction. They see computed CSS values, not design tokens. The semantic meaning of "this is the brand surface color" is lost the moment the browser evaluates the stylesheet.

The same applies to spacing. Your `gap: var(--space-4)` becomes `gap: 16px`. Your `font-family: var(--font-heading)` becomes `font-family: 'Chillax', sans-serif`. Every token reference collapses into its computed value.

## Why Existing Solutions Fall Short

There are Figma plugins that attempt to solve variable rebinding. The typical approach: scan your local variable definitions, match hex values or numeric values against the definitions, and rebind where there is a match.

This works — partially. It handles local variables in simple files. But it breaks down in two critical scenarios.

**Library variables.** Most mature design systems publish their variables from a shared library file. When you consume those variables in a downstream file, they are library references, not local definitions. Plugins that only read local variable collections will never find them.

**Ambiguous matches.** A hex value like `#FFFFFF` might map to `surface/base/default`, `text/inverse`, `icon/on-color`, or a dozen other semantic tokens. Without context about *how* a color is used — is it a fill? a stroke? a text color? — matching against definitions alone produces incorrect bindings or requires manual disambiguation for every match.

## The Learning-Based Approach

Token Rebinder takes a different path. Instead of matching against variable definitions, it learns from your existing design.

The workflow has two steps:

**Step 1: Learn.** You select frames in your Figma file that already have correct variable bindings — the ones your designers built by hand, or that were bound before the code push. Token Rebinder reads every `boundVariables` property on every node in those frames. It builds a lookup map: for each combination of value and binding context (fill color, stroke color, width, height, padding, gap, border radius, font family, font size, opacity, visibility, and so on), it records which variable was bound.

This is the key insight. The learning step captures *contextual* bindings, not just value-to-variable mappings. A `#FFFFFF` used as a fill maps to one variable. The same `#FFFFFF` used as a text color maps to another. The context disambiguates.

**Step 2: Apply.** You select the pushed frames — the ones with hardcoded values — and Token Rebinder walks every node, checks each property against the learned map, and rebinds the variable where it finds a match.

Because the learning step reads `boundVariables` through the Figma Plugin API, it resolves library variables transparently. If your source frame uses a variable from a published library, Token Rebinder learns that binding and can apply it to the target frame. No special configuration. No manual library selection.

The plugin covers 50 of the 51 variable binding types that the Figma Plugin API exposes: solid fill colors, stroke colors, all four padding directions, gap, border radius (per corner), min/max width and height, font family, font size, font weight, line height, letter spacing, paragraph spacing, paragraph indent, opacity, visibility, individual effect properties (shadow color, offset, radius, spread), layout grid properties, and component property bindings. The only unsupported type is `textRangeFills` — mixed text colors within a single text node — which requires character-range-level binding that the current API does not support for bulk operations.

## Results

We tested Token Rebinder on a production portal — the My Ayvens Services admin interface, with driver detail pages, vehicle views, parking session breakdowns, and customer management screens.

After pushing code-generated frames back to Figma: **4,354 variable bindings restored in approximately 30 seconds.** Colors, spacing, typography, border radii, effects — all rebound to their correct semantic tokens, including library variables from the shared design system file.

The frames went from "looks right but is dead" to "fully participates in the design system." Change a brand color in the library, and every restored frame updates.

## How to Use It

1. Install Token Rebinder from the Figma Community (free).
2. Open a file that contains both correctly-bound frames (your source of truth) and pushed/captured frames (the ones that lost their bindings).
3. Select the correctly-bound frames. Click **Learn**.
4. Select the pushed frames. Click **Apply**.
5. Inspect a few nodes to verify. The bound variables should appear in the inspect panel, matching the originals.

For best results, learn from frames that cover the full range of your design system — include frames with different surface colors, text styles, spacing patterns, and states. The broader the learning set, the more complete the rebinding.

## What's Next

Token Rebinder solves the rebinding problem after the gap has occurred. But the larger question remains: can the gap be closed upstream?

The real fix would be for capture tools to emit Figma nodes with variable bindings intact — to somehow carry the token semantics through the render-and-capture pipeline. That is a hard problem. It would require the capture layer to have knowledge of the design token system, not just the computed CSS.

Until that happens, the gap is structural. And if your workflow includes any code-to-canvas step — whether for documentation, design QA, or keeping Figma in sync with production — Token Rebinder gives you a way to cross that gap without losing what makes your design system work.

---

*Token Rebinder is a free Figma plugin by [Hidle Everform](https://www.figma.com/community/plugin/token-rebinder). Install it from the Figma Community.*
