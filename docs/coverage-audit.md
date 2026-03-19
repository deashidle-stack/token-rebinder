# Token Rebinder — Variable Binding Coverage Audit

## Current State: 4 of 51 bindable field types handled (8%)

### What We Handle Now
- Fill colors (solid paints) ✅
- Stroke colors (solid paints) ✅
- Text styles (textStyleId) ✅
- Font name fixing ✅

### Full Figma Variable Binding Inventory

#### Tier 1 — Must-have (highest ROI, most common in design systems)

| # | Field(s) | Type | API Method | Status |
|---|----------|------|------------|--------|
| 1 | paddingTop/Right/Bottom/Left | FLOAT | setBoundVariable | ❌ |
| 2 | itemSpacing (auto-layout gap) | FLOAT | setBoundVariable | ❌ |
| 3 | counterAxisSpacing | FLOAT | setBoundVariable | ❌ |
| 4 | topLeft/Right/BottomLeft/RightRadius | FLOAT | setBoundVariable | ❌ |
| 5 | Effect: color, radius, spread, offsetX, offsetY | FLOAT/COLOR | setBoundVariableForEffect | ❌ |
| 6 | strokeWeight | FLOAT | setBoundVariable | ❌ |
| 7 | opacity | FLOAT | setBoundVariable | ❌ |
| 8 | visible | BOOLEAN | setBoundVariable | ❌ |
| 9 | width, height | FLOAT | setBoundVariable | ❌ |
| 10 | fills (solid) | COLOR | setBoundVariableForPaint | ✅ |
| 11 | strokes (solid) | COLOR | setBoundVariableForPaint | ✅ |

#### Tier 2 — Must-have for "100% coverage" claim

| # | Field(s) | Type | API Method | Status |
|---|----------|------|------------|--------|
| 12 | fontSize, lineHeight, fontFamily, fontStyle, fontWeight, letterSpacing, paragraphSpacing | FLOAT/STRING | setBoundVariable / setRangeBoundVariable | ❌ |
| 13 | Gradient color stops | COLOR | Direct ColorStop.boundVariables | ❌ |
| 14 | textRangeFills | COLOR | Array in boundVariables | ❌ |
| 15 | Component properties (BOOLEAN, TEXT) | BOOLEAN/STRING | componentProperties.boundVariables | ❌ |
| 16 | minWidth, maxWidth, minHeight, maxHeight | FLOAT | setBoundVariable | ❌ |

#### Tier 3 — Nice-to-have (completionist)

| # | Field(s) | Type | API Method | Status |
|---|----------|------|------------|--------|
| 17 | Layout grid: sectionSize, count, offset, gutterSize | FLOAT | setBoundVariableForLayoutGrid | ❌ |
| 18 | Individual stroke weights (top/right/bottom/left) | FLOAT | setBoundVariable | ❌ |
| 19 | gridRowGap, gridColumnGap | FLOAT | setBoundVariable | ❌ |
| 20 | characters (string content variable) | STRING | setBoundVariable | ❌ |
| 21 | paragraphIndent | FLOAT | setBoundVariable | ❌ |

### Implementation Architecture

Generalize `colorMap` into typed maps:
- `colorMap: Map<string, LearnedBinding>` — hex → COLOR variable (existing)
- `floatMap: Map<string, LearnedBinding>` — "field:value" → FLOAT variable (new)
- `stringMap: Map<string, LearnedBinding>` — "field:value" → STRING variable (new)
- `boolMap: Map<string, LearnedBinding>` — "field:value" → BOOLEAN variable (new)
- `effectMap` — effect signature → effect variable bindings (new)

Learn phase: Read `node.boundVariables[field]` for all fields, store value→variable mappings.
Apply phase: Read raw values from pushed nodes, look up in maps, call appropriate setter.
