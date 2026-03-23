# Token Rebinder — Variable Binding Coverage Audit

## Current State: 50 of 51 bindable field types handled (98%)

> Last updated: 2026-03-20 (v5)

### Coverage Summary

| Category | Fields | Status |
|----------|--------|--------|
| Fill colors (solid paints) | fills | ✅ |
| Stroke colors (solid paints) | strokes | ✅ |
| Spacing (auto-layout) | paddingTop/Right/Bottom/Left, itemSpacing, counterAxisSpacing | ✅ |
| Corner radius | topLeft/Right/BottomLeft/RightRadius | ✅ |
| Stroke weight | strokeWeight, strokeTopWeight/RightWeight/BottomWeight/LeftWeight | ✅ |
| Dimensions | width, height, minWidth, maxWidth, minHeight, maxHeight | ✅ |
| Opacity | opacity | ✅ |
| Visibility | visible | ✅ |
| Effects | color, radius, spread, offsetX, offsetY per effect | ✅ |
| Layout grids | sectionSize, count, offset, gutterSize | ✅ |
| Typography variables | fontSize, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent | ✅ |
| Text styles | textStyleId binding | ✅ |
| Text range fills | textRangeFills color bindings | ✅ |
| Font fixing | fontName correction (e.g. restore Chillax) | ✅ |
| Component properties | BOOLEAN and TEXT property variable bindings | ✅ |
| Grid gaps | gridRowGap, gridColumnGap | ✅ |
| **Gradient color stops** | **ColorStop.boundVariables** | **❌ API limitation** |

### The One We Can't Cover

**Gradient color stops** (1/51): The Figma Plugin API exposes `ColorStop.boundVariables` for reading, but provides no public setter method (`setBoundVariableForColorStop` doesn't exist). This is a Figma API limitation, not a plugin limitation. If Figma adds the setter, we can support it immediately — the learn-side already captures gradient stop bindings.

### Architecture (v5)

```
Learn → Upgrade → Fallback → Apply

1. LEARN: Scan existing design nodes for boundVariables on ALL field types
2. UPGRADE: Replace primitive variable references with semantic aliases
3. FALLBACK: Use local variable definitions (scope-aware) for unmatched values
4. APPLY: Rebind pushed frame using learned mappings + fuzzy color matching (±2 RGB)
```

**Learned Store** (typed maps):
- `colors`: `Map<hex, Variable>` — COLOR variables (fuzzy ±2 per channel)
- `floats`: `Map<field:value, Variable>` — FLOAT variables (spacing, radius, dimensions, stroke, opacity)
- `strings`: `Map<field:value, Variable>` — STRING variables (font family, style)
- `bools`: `Map<field:value, Variable>` — BOOLEAN variables (visibility, component props)
- `effects`: `Map<signature, bindings[]>` — effect field bindings by type+value signature
- `layoutGrids`: `Map<signature, bindings[]>` — layout grid field bindings
- `typoVars`: `Map<field:value, Variable>` — typography-specific float variables
- `textStyles`: `Map<styleKey, TextStyle>` — full text style references

**Semantic preference**: `isBetter()` function prefers tokens with semantic prefixes (Text/, Surface/, Border/, Icon/) over primitives (Color/, color/).

### Field Dispatch Tables

| Table | Fields |
|-------|--------|
| SPACING_FIELDS | paddingTop, paddingRight, paddingBottom, paddingLeft, itemSpacing, counterAxisSpacing |
| RADIUS_FIELDS | topLeftRadius, topRightRadius, bottomLeftRadius, bottomRightRadius |
| DIMENSION_FIELDS | width, height, minWidth, maxWidth, minHeight, maxHeight |
| STROKE_WEIGHT_FIELDS | strokeWeight, strokeTopWeight, strokeRightWeight, strokeBottomWeight, strokeLeftWeight |
| TYPO_VAR_FIELDS | fontSize, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent |
| EFFECT_FIELDS | color, radius, spread, offsetX, offsetY |
| GRID_FIELDS | sectionSize, count, offset, gutterSize |

### Real-World Results (MAS-Portal test, v5)

| Metric | Count |
|--------|-------|
| Source nodes scanned | ~800 |
| Variables learned | 45+ |
| Fills rebound | 478 |
| Strokes rebound | 89 |
| Spacing rebound | 2,510 |
| Radius rebound | 385 |
| Stroke weight rebound | 650 |
| Dimensions rebound | 104 |
| Effects rebound | 27 |
| Typography vars rebound | 53 |
| Text styles rebound | 8 |
| Fonts fixed | 42 |
| **Total bindings restored** | **~4,354** |
| Unmatched colors | 3 (#73d2d2, #f33c0a, #80949f) |
