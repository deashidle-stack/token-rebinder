# Token Rebinder

**Restore every design token after code-to-canvas pushes. One click.**

When you push code to Figma via `generate_figma_design`, html-to-design, or any capture-based tool, every variable binding is stripped. Colors become hardcoded hex. Spacing loses its tokens. Text styles detach. Typography variables vanish.

Token Rebinder fixes all of it by learning from your existing designs and applying the correct bindings to pushed frames.

## What it does

| Category | Bindings restored |
|----------|------------------|
| **Colors** | Fill colors, stroke colors, fuzzy hex matching (+-2/channel) |
| **Spacing** | Padding (all sides), item spacing, counter-axis spacing |
| **Border radius** | All four corners |
| **Dimensions** | Width, height, min/max constraints |
| **Effects** | Shadow color, radius, spread, offset X/Y |
| **Typography** | Text styles, font size, line height, letter spacing, font family |
| **Layout** | Grid section size, count, offset, gutter |
| **Misc** | Stroke weight, opacity, visibility, characters, component properties |

**50 of 51** Figma variable binding types supported. The only gap is gradient color stops (Figma API limitation — no public setter).

## How it works

**Learn → Upgrade → Fallback → Apply**

1. **Learn**: Scans all existing design frames on the current page. Reads `boundVariables` from every node to build a map of values → variables. This captures semantic tokens from published libraries — not just local primitives.

2. **Upgrade**: Checks if any learned primitives have semantic aliases (e.g., `color/azure/17` → `Text/Primary`). Replaces primitive bindings with semantic ones.

3. **Fallback**: Scans local variable definitions for any remaining unmapped values. Uses `variable.scopes` to match float variables to the correct fields.

4. **Apply**: Walks the pushed frame, matches each property value against the learned maps, and calls the appropriate Figma API setter (`setBoundVariable`, `setBoundVariableForPaint`, `setBoundVariableForEffect`, `setBoundVariableForLayoutGrid`).

Also fixes font name truncation from capture scripts (e.g., `Chillax:Semi` → `Chillax Semibold`).

## Installation

### From Figma Community
Search "Token Rebinder" in Figma → Plugins → Browse.

### Development mode
1. Clone this repo
2. `npm install`
3. `npm run build`
4. In Figma: ☰ → Plugins → Development → Import plugin from manifest → select `manifest.json`

## Usage

1. Push your code to Figma (via generate_figma_design, html-to-design, etc.)
2. Select the pushed frame on the canvas
3. Run Token Rebinder: ☰ → Plugins → Token Rebinder
4. Check the categories you want to rebind (all enabled by default)
5. Click **Rebind Selected Frame**
6. Review the results — every category shows how many bindings were restored

## Results you can expect

On a typical portal page (658 target nodes, 60K source nodes):

- **4,354 total bindings** restored in one click
- **231 fill colors** → semantic tokens (Text/Primary, Surface/Base/Widgets, etc.)
- **2,510 spacing values** → padding and gap tokens
- **650 stroke weights** → border width tokens
- **166 text styles** → typography system bindings
- **~30 seconds** total processing time

## Requirements

- Figma desktop app or browser
- Existing design frames with variable bindings on the same page (the plugin learns from these)
- A pushed frame to rebind (selected before running)

## Privacy

Token Rebinder runs entirely within Figma's plugin sandbox. No data leaves your file. No network requests. No analytics. No account required.

## License

MIT — free to use, modify, and distribute.

## Built by

[Hidle Everform](https://github.com/hidle-everform) — Design system tooling for AI-powered workflows.
