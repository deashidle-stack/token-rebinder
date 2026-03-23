/**
 * Token Rebinder — Figma Plugin (v5)
 * © Hidle Everform
 *
 * Restores ALL design system variable bindings after code→canvas pushes.
 * Covers 50/51 Figma variable binding types (gradient stop = API limitation).
 *
 * Architecture: Learn → Upgrade → Fallback → Apply
 *   1. LEARN from existing design nodes (boundVariables on every field type)
 *   2. UPGRADE primitives to semantic aliases
 *   3. FALLBACK to local variable definitions
 *   4. APPLY learned bindings + fuzzy matching to pushed frame
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface RunOptions {
  colors: boolean;
  spacing: boolean;
  radius: boolean;
  effects: boolean;
  dimensions: boolean;
  typography: boolean;
  layout: boolean;
  misc: boolean;
}

interface Results {
  sourceNodesScanned: number;
  targetNodesScanned: number;
  colorsLearned: number;
  floatsLearned: number;
  textStylesLearned: number;
  effectsLearned: number;
  fillsRebound: number;
  strokesRebound: number;
  spacingRebound: number;
  radiusRebound: number;
  dimensionsRebound: number;
  effectFieldsRebound: number;
  strokeWeightRebound: number;
  opacityRebound: number;
  visibilityRebound: number;
  typoVarsRebound: number;
  textStylesRebound: number;
  fontsFixed: number;
  layoutGridsRebound: number;
  componentPropsRebound: number;
  gridGapsRebound: number;
  charactersRebound: number;
  fuzzyMatches: number;
  localFallbacksAdded: number;
  primitivesUpgraded: number;
  unmatchedColors: Array<{ hex: string; count: number }>;
  totalPaintNodes: number;
  totalLayoutNodes: number;
  totalTextNodes: number;
  totalEffectNodes: number;
}

interface LearnedBinding {
  variable: Variable;
  name: string;
}

interface LearnedTextStyle {
  textStyleId: string;
}

interface LearnedEffectBinding {
  fields: Array<{ field: string; variableId: string }>;
  signature: string;
}

interface LearnedGridBinding {
  fields: Array<{ field: string; variableId: string }>;
  signature: string;
}

/** Central store for all learned bindings */
interface LearnedStore {
  colors: Map<string, LearnedBinding>;
  floats: Map<string, LearnedBinding>;
  strings: Map<string, LearnedBinding>;
  bools: Map<string, LearnedBinding>;
  textStyles: Map<string, LearnedTextStyle>;
  effects: Map<string, LearnedEffectBinding>;
  layoutGrids: Map<string, LearnedGridBinding>;
  typoVars: Map<string, LearnedBinding>;
}

function createStore(): LearnedStore {
  return {
    colors: new Map(),
    floats: new Map(),
    strings: new Map(),
    bools: new Map(),
    textStyles: new Map(),
    effects: new Map(),
    layoutGrids: new Map(),
    typoVars: new Map(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// LICENSE
// ═══════════════════════════════════════════════════════════════════

var API_BASE = "https://token-rebinder-api.andreas-everform.workers.dev";
var LICENSE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkLicense(): Promise<"free" | "pro" | "team"> {
  try {
    var cached = await figma.clientStorage.getAsync("license") as { tier: "free" | "pro" | "team"; checkedAt: number } | undefined;
    var now = Date.now();

    if (cached && cached.checkedAt && (now - cached.checkedAt) < LICENSE_TTL) {
      return cached.tier;
    }

    var user = figma.currentUser;
    if (!user) return "free";

    var resp = await fetch(API_BASE + "/license/" + user.id);
    if (!resp.ok) return cached ? cached.tier : "free";

    var data = await resp.json() as { tier: "free" | "pro" | "team" };
    var license = { tier: data.tier, checkedAt: now };
    await figma.clientStorage.setAsync("license", license);
    return data.tier;
  } catch (e) {
    var fallback = await figma.clientStorage.getAsync("license") as { tier: "free" | "pro" | "team" } | undefined;
    return fallback ? fallback.tier : "free";
  }
}

async function checkFileAccess(tier: "free" | "pro" | "team"): Promise<boolean> {
  if (tier !== "free") return true;

  var fileKey = figma.fileKey;
  if (!fileKey) return true;

  var stored = await figma.clientStorage.getAsync("activeFile") as string | undefined;
  if (!stored) {
    await figma.clientStorage.setAsync("activeFile", fileKey);
    return true;
  }
  return stored === fileKey;
}

// ═══════════════════════════════════════════════════════════════════
// FIELD DISPATCH TABLES
// ═══════════════════════════════════════════════════════════════════

/** All scalar VariableBindableNodeField values grouped by category */
const SPACING_FIELDS = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "itemSpacing", "counterAxisSpacing",
] as const;

const RADIUS_FIELDS = [
  "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius",
] as const;

const DIMENSION_FIELDS = [
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
] as const;

const STROKE_WEIGHT_FIELDS = [
  "strokeWeight", "strokeTopWeight", "strokeRightWeight",
  "strokeBottomWeight", "strokeLeftWeight",
] as const;

const GRID_GAP_FIELDS = ["gridRowGap", "gridColumnGap"] as const;

const MISC_FLOAT_FIELDS = ["opacity"] as const;
const MISC_BOOL_FIELDS = ["visible"] as const;
const MISC_STRING_FIELDS = ["characters"] as const;

/** All scalar fields combined for learning */
const ALL_FLOAT_FIELDS = [
  ...SPACING_FIELDS, ...RADIUS_FIELDS, ...DIMENSION_FIELDS,
  ...STROKE_WEIGHT_FIELDS, ...GRID_GAP_FIELDS, ...MISC_FLOAT_FIELDS,
];

const TYPO_VAR_FIELDS = [
  "fontSize", "lineHeight", "letterSpacing", "paragraphSpacing", "paragraphIndent",
] as const;

const TYPO_STRING_FIELDS = ["fontFamily", "fontStyle"] as const;

const EFFECT_FIELDS = ["color", "radius", "spread", "offsetX", "offsetY"] as const;
const GRID_FIELDS = ["sectionSize", "count", "offset", "gutterSize"] as const;

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function rgbToHex(r: number, g: number, b: number): string {
  var toHex = function(v: number) {
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return ("#" + toHex(r) + toHex(g) + toHex(b)).toLowerCase();
}

function hexToRgbInts(hex: string): [number, number, number] {
  var h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function fuzzyMatchColor(
  hex: string,
  map: Map<string, LearnedBinding>,
  tolerance: number
): LearnedBinding | null {
  var rgb1 = hexToRgbInts(hex);
  var bestMatch: LearnedBinding | null = null;
  var bestDist = Infinity;
  map.forEach(function(binding, mapHex) {
    var rgb2 = hexToRgbInts(mapHex);
    var dist = Math.abs(rgb1[0] - rgb2[0]) + Math.abs(rgb1[1] - rgb2[1]) + Math.abs(rgb1[2] - rgb2[2]);
    if (dist > 0 && dist <= tolerance * 3 && dist < bestDist) {
      bestDist = dist;
      bestMatch = binding;
    }
  });
  return bestMatch;
}

/** Round floats consistently for key matching */
function fkey(field: string, value: number): string {
  return field + ":" + (Math.round(value * 100) / 100).toString();
}

function skey(field: string, value: string): string {
  return field + ":" + value;
}

function bkey(field: string, value: boolean): string {
  return field + ":" + (value ? "1" : "0");
}

function effectSig(e: Effect): string {
  var parts: string[] = [e.type as string];
  if ("color" in e) {
    var c = (e as any).color as RGBA;
    parts.push(rgbToHex(c.r, c.g, c.b));
  }
  if ("radius" in e) parts.push("r" + String((e as any).radius));
  if ("spread" in e) parts.push("s" + String((e as any).spread));
  if ("offset" in e) {
    var off = (e as any).offset;
    parts.push("o" + off.x + "," + off.y);
  }
  return parts.join("|");
}

function gridSig(g: LayoutGrid): string {
  var a = g as any;
  return (a.pattern || "") + "|" +
    (a.alignment || "") + "|" +
    (a.sectionSize !== undefined ? a.sectionSize : "") + "|" +
    (a.count !== undefined ? a.count : "") + "|" +
    (a.gutterSize !== undefined ? a.gutterSize : "") + "|" +
    (a.offset !== undefined ? a.offset : "");
}

const SEMANTIC_PREFIXES = [
  "Text/", "Surface/", "Border/", "Icon/", "Buttons/",
  "Interactive", "System/", "Basic/", "Spacing/", "Radius/",
  "Size/", "Shadow/", "Effect/", "Typography/", "Font/",
];

function isSemantic(name: string): boolean {
  for (var i = 0; i < SEMANTIC_PREFIXES.length; i++) {
    if (name.indexOf(SEMANTIC_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function isBetter(candidate: Variable, existing: Variable): boolean {
  var cs = isSemantic(candidate.name);
  var es = isSemantic(existing.name);
  if (cs && !es) return true;
  return false;
}

/** Safely read a scalar property from a node */
function readScalar(node: SceneNode, field: string): number | string | boolean | null {
  try {
    var val = (node as any)[field];
    if (val === undefined || val === figma.mixed) return null;
    return val;
  } catch (_e) {
    return null;
  }
}

/** Check if a field already has a bound variable */
function isAlreadyBound(node: SceneNode, field: string): boolean {
  try {
    var bv = (node as any).boundVariables;
    if (!bv) return false;
    var binding = bv[field];
    if (!binding) return false;
    // Arrays: check if non-empty
    if (Array.isArray(binding)) return binding.length > 0 && binding[0] && binding[0].id;
    // Scalar alias
    return !!(binding as any).id;
  } catch (_e) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 1: LEARN FROM EXISTING DESIGNS
// ═══════════════════════════════════════════════════════════════════

async function learnFromFile(
  excludeIds: Set<string>,
  store: LearnedStore
): Promise<number> {
  var scanned = 0;

  async function resolveVar(id: string): Promise<Variable | null> {
    try {
      return await figma.variables.getVariableByIdAsync(id);
    } catch (_e) {
      return null;
    }
  }

  async function storeColor(hex: string, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var existing = store.colors.get(hex);
    if (!existing || isBetter(v, existing.variable)) {
      store.colors.set(hex, { variable: v, name: v.name });
    }
  }

  async function storeFloat(field: string, value: number, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var key = fkey(field, value);
    var existing = store.floats.get(key);
    if (!existing || isBetter(v, existing.variable)) {
      store.floats.set(key, { variable: v, name: v.name });
    }
  }

  async function storeString(field: string, value: string, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var key = skey(field, value);
    if (!store.strings.has(key)) {
      store.strings.set(key, { variable: v, name: v.name });
    }
  }

  async function storeBool(field: string, value: boolean, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var key = bkey(field, value);
    if (!store.bools.has(key)) {
      store.bools.set(key, { variable: v, name: v.name });
    }
  }

  async function scanNode(node: SceneNode): Promise<void> {
    scanned++;
    if (excludeIds.has(node.id)) return;

    try {
      if (!("boundVariables" in node)) { /* skip */ }
      else {
        var bv = node.boundVariables as Record<string, any>;
        if (!bv) { /* skip */ }
        else {
          // ── Paint colors (fills + strokes) ──
          var paintFields: Array<"fills" | "strokes"> = ["fills", "strokes"];
          for (var pf = 0; pf < paintFields.length; pf++) {
            var pfName = paintFields[pf];
            var aliases = bv[pfName] as Array<{ id: string }> | undefined;
            var paints = (node as any)[pfName];
            if (Array.isArray(aliases) && Array.isArray(paints)) {
              for (var pi = 0; pi < Math.min(paints.length, aliases.length); pi++) {
                var paint = paints[pi];
                var alias = aliases[pi];
                if (paint && paint.type === "SOLID" && alias && alias.id) {
                  await storeColor(rgbToHex(paint.color.r, paint.color.g, paint.color.b), alias.id);
                }
              }
            }
          }

          // ── Scalar FLOAT fields ──
          for (var fi = 0; fi < ALL_FLOAT_FIELDS.length; fi++) {
            var ff = ALL_FLOAT_FIELDS[fi];
            var fa = bv[ff] as { id: string } | undefined;
            if (fa && fa.id) {
              var fv = readScalar(node, ff);
              if (typeof fv === "number") {
                await storeFloat(ff, fv, fa.id);
              }
            }
          }

          // ── BOOLEAN (visible) ──
          for (var bi = 0; bi < MISC_BOOL_FIELDS.length; bi++) {
            var bf = MISC_BOOL_FIELDS[bi];
            var ba = bv[bf] as { id: string } | undefined;
            if (ba && ba.id) {
              var bval = readScalar(node, bf);
              if (typeof bval === "boolean") {
                await storeBool(bf, bval, ba.id);
              }
            }
          }

          // ── STRING (characters) ──
          for (var si = 0; si < MISC_STRING_FIELDS.length; si++) {
            var sf = MISC_STRING_FIELDS[si];
            var sa = bv[sf] as { id: string } | undefined;
            if (sa && sa.id) {
              var sv = readScalar(node, sf);
              if (typeof sv === "string") {
                await storeString(sf, sv, sa.id);
              }
            }
          }

          // ── Effects ──
          if (bv.effects && "effects" in node) {
            var effects = (node as any).effects as ReadonlyArray<Effect>;
            for (var ei = 0; ei < effects.length; ei++) {
              var eff = effects[ei];
              var ebv = (eff as any).boundVariables;
              if (!ebv) continue;

              var sig = effectSig(eff);
              var learnedFields: Array<{ field: string; variableId: string }> = [];

              for (var efi = 0; efi < EFFECT_FIELDS.length; efi++) {
                var ef = EFFECT_FIELDS[efi];
                var ea = ebv[ef];
                if (ea && ea.id) {
                  learnedFields.push({ field: ef, variableId: ea.id });
                }
              }

              if (learnedFields.length > 0 && !store.effects.has(sig)) {
                store.effects.set(sig, { fields: learnedFields, signature: sig });
              }
            }
          }

          // ── Layout Grids ──
          if (bv.layoutGrids && "layoutGrids" in node) {
            var grids = (node as any).layoutGrids as ReadonlyArray<LayoutGrid>;
            for (var gi = 0; gi < grids.length; gi++) {
              var grid = grids[gi];
              var gbv = (grid as any).boundVariables;
              if (!gbv) continue;

              var gsig = gridSig(grid);
              var gFields: Array<{ field: string; variableId: string }> = [];

              for (var gfi = 0; gfi < GRID_FIELDS.length; gfi++) {
                var gf = GRID_FIELDS[gfi];
                var ga = gbv[gf];
                if (ga && ga.id) {
                  gFields.push({ field: gf, variableId: ga.id });
                }
              }

              if (gFields.length > 0 && !store.layoutGrids.has(gsig)) {
                store.layoutGrids.set(gsig, { fields: gFields, signature: gsig });
              }
            }
          }

          // ── Text: styles + typography variables ──
          if (node.type === "TEXT") {
            var textNode = node as TextNode;

            // Text style (monolithic)
            var styleId = textNode.textStyleId;
            if (styleId && styleId !== figma.mixed && styleId !== "") {
              var fn = textNode.fontName;
              var fs = textNode.fontSize;
              if (fn !== figma.mixed && fs !== figma.mixed) {
                var tsig = (fn as FontName).family + ":" + (fn as FontName).style + ":" + Math.round(fs as number);
                if (!store.textStyles.has(tsig)) {
                  store.textStyles.set(tsig, { textStyleId: styleId as string });
                }
              }
            }

            // Typography variable fields (FLOAT: fontSize, lineHeight, etc.)
            for (var ti = 0; ti < TYPO_VAR_FIELDS.length; ti++) {
              var tf = TYPO_VAR_FIELDS[ti];
              var ta = bv[tf];
              // Text fields return VariableAlias[] — take first
              var tAlias = Array.isArray(ta) && ta.length > 0 ? ta[0] : (ta && (ta as any).id ? ta : null);
              if (tAlias && tAlias.id) {
                var rawVal = (textNode as any)[tf];
                if (rawVal !== figma.mixed && rawVal !== undefined) {
                  // lineHeight/letterSpacing are objects: { value, unit }
                  var numVal: number;
                  if (typeof rawVal === "object" && rawVal !== null && "value" in rawVal) {
                    numVal = (rawVal as any).value;
                  } else if (typeof rawVal === "number") {
                    numVal = rawVal;
                  } else {
                    continue;
                  }
                  var tKey = fkey(tf, numVal);
                  var tVar = await resolveVar(tAlias.id);
                  if (tVar && !store.typoVars.has(tKey)) {
                    store.typoVars.set(tKey, { variable: tVar, name: tVar.name });
                  }
                }
              }
            }

            // Typography STRING fields (fontFamily, fontStyle)
            for (var tsi = 0; tsi < TYPO_STRING_FIELDS.length; tsi++) {
              var tsf = TYPO_STRING_FIELDS[tsi];
              var tsa = bv[tsf];
              var tsAlias = Array.isArray(tsa) && tsa.length > 0 ? tsa[0] : (tsa && (tsa as any).id ? tsa : null);
              if (tsAlias && tsAlias.id) {
                var tsRaw = (textNode as any)[tsf];
                if (tsRaw !== figma.mixed && typeof tsRaw === "string") {
                  var tsKey = skey(tsf, tsRaw);
                  var tsVar = await resolveVar(tsAlias.id);
                  if (tsVar && !store.strings.has(tsKey)) {
                    store.strings.set(tsKey, { variable: tsVar, name: tsVar.name });
                  }
                }
              }
            }
          }

          // ── Component properties ──
          if ("componentProperties" in node && bv.componentProperties) {
            var cpBv = bv.componentProperties as Record<string, { id: string }>;
            var cpDefs = (node as InstanceNode).componentProperties;
            if (cpDefs) {
              var cpKeys = Object.keys(cpBv);
              for (var ci = 0; ci < cpKeys.length; ci++) {
                var cpName = cpKeys[ci];
                var cpAlias = cpBv[cpName];
                if (!cpAlias || !cpAlias.id) continue;
                var cpDef = cpDefs[cpName];
                if (!cpDef) continue;
                var cpVal = cpDef.value;
                if (typeof cpVal === "boolean") {
                  await storeBool("cp:" + cpName, cpVal, cpAlias.id);
                } else if (typeof cpVal === "string") {
                  await storeString("cp:" + cpName, cpVal, cpAlias.id);
                }
              }
            }
          }
        }
      }
    } catch (_e) {
      // Skip problematic nodes silently
    }

    // Recurse
    if ("children" in node) {
      var children = (node as FrameNode).children;
      for (var ci2 = 0; ci2 < children.length; ci2++) {
        try {
          await scanNode(children[ci2]);
        } catch (_e) { /* skip */ }
      }
    }
  }

  // Scan current page
  var page = figma.currentPage;
  for (var i = 0; i < page.children.length; i++) {
    var topNode = page.children[i];
    if (excludeIds.has(topNode.id)) continue;
    try {
      await scanNode(topNode);
    } catch (_e) { /* skip */ }

    if (scanned % 500 === 0) {
      figma.ui.postMessage({
        type: "progress",
        text: "Learning: " + scanned + " nodes, " + store.colors.size + " colors, " +
          store.floats.size + " floats, " + store.effects.size + " effects, " +
          store.textStyles.size + " text styles...",
      });
    }
  }

  return scanned;
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: UPGRADE PRIMITIVES → SEMANTIC
// ═══════════════════════════════════════════════════════════════════

async function upgradePrimitives(store: LearnedStore): Promise<number> {
  var upgraded = 0;

  // Color primitives
  var primColors: Array<{ hex: string; varId: string }> = [];
  store.colors.forEach(function(b, hex) {
    if (!isSemantic(b.name)) primColors.push({ hex: hex, varId: b.variable.id });
  });

  if (primColors.length > 0) {
    var primIds = new Set<string>();
    for (var i = 0; i < primColors.length; i++) primIds.add(primColors[i].varId);

    try {
      var allColorVars = await figma.variables.getLocalVariablesAsync("COLOR");
      for (var vi = 0; vi < allColorVars.length; vi++) {
        var v = allColorVars[vi];
        if (!isSemantic(v.name)) continue;
        try {
          var coll = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
          if (!coll) continue;
          for (var mi = 0; mi < coll.modes.length; mi++) {
            var val = v.valuesByMode[coll.modes[mi].modeId];
            if (val && typeof val === "object" && "type" in val &&
                (val as VariableAlias).type === "VARIABLE_ALIAS") {
              var aid = (val as VariableAlias).id;
              if (primIds.has(aid)) {
                for (var pi = 0; pi < primColors.length; pi++) {
                  if (primColors[pi].varId === aid) {
                    store.colors.set(primColors[pi].hex, { variable: v, name: v.name });
                    upgraded++;
                    break;
                  }
                }
              }
            }
          }
        } catch (_e) { /* skip */ }
      }
    } catch (_e) { /* skip */ }
  }

  // Float primitives — same pattern
  var primFloats: Array<{ key: string; varId: string }> = [];
  store.floats.forEach(function(b, key) {
    if (!isSemantic(b.name)) primFloats.push({ key: key, varId: b.variable.id });
  });

  if (primFloats.length > 0) {
    var fPrimIds = new Set<string>();
    for (var fi = 0; fi < primFloats.length; fi++) fPrimIds.add(primFloats[fi].varId);

    try {
      var allFloatVars = await figma.variables.getLocalVariablesAsync("FLOAT");
      for (var fvi = 0; fvi < allFloatVars.length; fvi++) {
        var fv = allFloatVars[fvi];
        if (!isSemantic(fv.name)) continue;
        try {
          var fc = await figma.variables.getVariableCollectionByIdAsync(fv.variableCollectionId);
          if (!fc) continue;
          for (var fmi = 0; fmi < fc.modes.length; fmi++) {
            var fval = fv.valuesByMode[fc.modes[fmi].modeId];
            if (fval && typeof fval === "object" && "type" in fval &&
                (fval as VariableAlias).type === "VARIABLE_ALIAS") {
              var faid = (fval as VariableAlias).id;
              if (fPrimIds.has(faid)) {
                for (var fpi = 0; fpi < primFloats.length; fpi++) {
                  if (primFloats[fpi].varId === faid) {
                    store.floats.set(primFloats[fpi].key, { variable: fv, name: fv.name });
                    upgraded++;
                    break;
                  }
                }
              }
            }
          }
        } catch (_e) { /* skip */ }
      }
    } catch (_e) { /* skip */ }
  }

  return upgraded;
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: LOCAL VARIABLE FALLBACKS
// ═══════════════════════════════════════════════════════════════════

async function addLocalFallbacks(store: LearnedStore): Promise<number> {
  var added = 0;

  // COLOR fallbacks
  try {
    var colorVars = await figma.variables.getLocalVariablesAsync("COLOR");
    for (var i = 0; i < colorVars.length; i++) {
      try {
        var v = colorVars[i];
        var coll = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
        if (!coll) continue;
        for (var mi = 0; mi < coll.modes.length; mi++) {
          var val = v.valuesByMode[coll.modes[mi].modeId];
          if (val && typeof val === "object" && "r" in val) {
            var hex = rgbToHex((val as RGB).r, (val as RGB).g, (val as RGB).b);
            if (!store.colors.has(hex)) {
              store.colors.set(hex, { variable: v, name: v.name });
              added++;
            }
          }
          // Resolve aliases
          if (val && typeof val === "object" && "type" in val &&
              (val as VariableAlias).type === "VARIABLE_ALIAS") {
            try {
              var rv = await figma.variables.getVariableByIdAsync((val as VariableAlias).id);
              if (!rv) continue;
              var rc = await figma.variables.getVariableCollectionByIdAsync(rv.variableCollectionId);
              if (!rc) continue;
              var rval = rv.valuesByMode[rc.modes[0].modeId];
              if (rval && typeof rval === "object" && "r" in rval) {
                var rhex = rgbToHex((rval as RGB).r, (rval as RGB).g, (rval as RGB).b);
                if (!store.colors.has(rhex)) {
                  store.colors.set(rhex, { variable: v, name: v.name });
                  added++;
                }
              }
            } catch (_e) { /* skip */ }
          }
        }
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }

  // FLOAT fallbacks — use variable.scopes to determine applicable fields
  try {
    var floatVars = await figma.variables.getLocalVariablesAsync("FLOAT");
    for (var fi = 0; fi < floatVars.length; fi++) {
      try {
        var fv = floatVars[fi];
        var fc = await figma.variables.getVariableCollectionByIdAsync(fv.variableCollectionId);
        if (!fc) continue;
        var fval = fv.valuesByMode[fc.modes[0].modeId];
        if (typeof fval !== "number") {
          // Try alias resolution
          if (fval && typeof fval === "object" && "type" in fval &&
              (fval as VariableAlias).type === "VARIABLE_ALIAS") {
            try {
              var rfv = await figma.variables.getVariableByIdAsync((fval as VariableAlias).id);
              if (!rfv) continue;
              var rfc = await figma.variables.getVariableCollectionByIdAsync(rfv.variableCollectionId);
              if (!rfc) continue;
              fval = rfv.valuesByMode[rfc.modes[0].modeId];
              if (typeof fval !== "number") continue;
            } catch (_e) { continue; }
          } else {
            continue;
          }
        }
        var numVal = fval as number;
        // Map scopes to fields
        var scopes = fv.scopes || [];
        var targetFields: string[] = [];
        for (var si = 0; si < scopes.length; si++) {
          var scope = scopes[si];
          if (scope === "CORNER_RADIUS") targetFields = targetFields.concat(RADIUS_FIELDS as any);
          else if (scope === "GAP") targetFields = targetFields.concat(SPACING_FIELDS as any);
          else if (scope === "WIDTH_HEIGHT") targetFields = targetFields.concat(DIMENSION_FIELDS as any);
          else if (scope === "STROKE_FLOAT") targetFields = targetFields.concat(STROKE_WEIGHT_FIELDS as any);
          else if (scope === "OPACITY") targetFields.push("opacity");
          else if (scope === "ALL_SCOPES") targetFields = targetFields.concat(ALL_FLOAT_FIELDS);
          else if (scope === "FONT_SIZE") targetFields.push("fontSize");
          else if (scope === "LINE_HEIGHT") targetFields.push("lineHeight");
          else if (scope === "LETTER_SPACING") targetFields.push("letterSpacing");
          else if (scope === "PARAGRAPH_SPACING") targetFields.push("paragraphSpacing");
          else if (scope === "PARAGRAPH_INDENT") targetFields.push("paragraphIndent");
        }
        // If no scopes, apply to all float fields as last resort
        if (targetFields.length === 0) targetFields = ALL_FLOAT_FIELDS.slice();

        for (var tfi = 0; tfi < targetFields.length; tfi++) {
          var key = fkey(targetFields[tfi], numVal);
          if (!store.floats.has(key)) {
            store.floats.set(key, { variable: fv, name: fv.name });
            added++;
          }
        }
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }

  return added;
}

// ═══════════════════════════════════════════════════════════════════
// FONT FIXES
// ═══════════════════════════════════════════════════════════════════

var FONT_FIXES: Record<string, { family: string; style: string }> = {
  "Chillax:Semi": { family: "Chillax", style: "Semibold" },
  "Chillax:Regular": { family: "Chillax", style: "Regular" },
  "Chillax:Medium": { family: "Chillax", style: "Medium" },
  "Chillax:Bold": { family: "Chillax", style: "Bold" },
  "Chillax:Light": { family: "Chillax", style: "Light" },
  "Chillax:Extralight": { family: "Chillax", style: "ExtraLight" },
  "Chillax": { family: "Chillax", style: "Regular" },
};

async function fixFonts(node: TextNode): Promise<number> {
  var fixed = 0;
  var fontName = node.fontName;

  if (fontName === figma.mixed) {
    var len = node.characters.length;
    var i = 0;
    while (i < len) {
      var cf = node.getRangeFontName(i, i + 1) as FontName;
      var fix = FONT_FIXES[cf.family + ":" + cf.style] || FONT_FIXES[cf.family];
      if (fix && (cf.family !== fix.family || cf.style !== fix.style)) {
        var end = i + 1;
        while (end < len) {
          var nf = node.getRangeFontName(end, end + 1) as FontName;
          if (nf.family !== cf.family || nf.style !== cf.style) break;
          end++;
        }
        try {
          await figma.loadFontAsync({ family: fix.family, style: fix.style });
          node.setRangeFontName(i, end, { family: fix.family, style: fix.style });
          fixed++;
        } catch (_e) { /* skip */ }
        i = end;
      } else {
        i++;
      }
    }
  } else {
    var fix2 = FONT_FIXES[fontName.family + ":" + fontName.style] || FONT_FIXES[fontName.family];
    if (fix2 && (fontName.family !== fix2.family || fontName.style !== fix2.style)) {
      try {
        await figma.loadFontAsync({ family: fix2.family, style: fix2.style });
        node.fontName = { family: fix2.family, style: fix2.style };
        fixed = 1;
      } catch (_e) { /* skip */ }
    }
  }
  return fixed;
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 4: APPLY TO PUSHED FRAME
// ═══════════════════════════════════════════════════════════════════

/** Map field name to RunOptions category */
function fieldEnabled(field: string, opts: RunOptions): boolean {
  if (SPACING_FIELDS.indexOf(field as any) >= 0) return opts.spacing;
  if (RADIUS_FIELDS.indexOf(field as any) >= 0) return opts.radius;
  if (DIMENSION_FIELDS.indexOf(field as any) >= 0) return opts.dimensions;
  if (STROKE_WEIGHT_FIELDS.indexOf(field as any) >= 0) return opts.misc;
  if (GRID_GAP_FIELDS.indexOf(field as any) >= 0) return opts.layout;
  if (field === "opacity" || field === "visible" || field === "characters") return opts.misc;
  return true;
}

function incCounter(field: string, r: Results): void {
  if (SPACING_FIELDS.indexOf(field as any) >= 0) { r.spacingRebound++; return; }
  if (RADIUS_FIELDS.indexOf(field as any) >= 0) { r.radiusRebound++; return; }
  if (DIMENSION_FIELDS.indexOf(field as any) >= 0) { r.dimensionsRebound++; return; }
  if (STROKE_WEIGHT_FIELDS.indexOf(field as any) >= 0) { r.strokeWeightRebound++; return; }
  if (GRID_GAP_FIELDS.indexOf(field as any) >= 0) { r.gridGapsRebound++; return; }
  if (field === "opacity") { r.opacityRebound++; return; }
  if (field === "visible") { r.visibilityRebound++; return; }
  if (field === "characters") { r.charactersRebound++; return; }
}

async function applyToNode(
  node: SceneNode,
  store: LearnedStore,
  opts: RunOptions,
  results: Results,
  unmatchedColors: Map<string, number>
): Promise<void> {
  results.targetNodesScanned++;

  // Track category totals for health score
  if (node.hasOwnProperty("fills")) {
    results.totalPaintNodes++;
  }
  if (node.hasOwnProperty("paddingTop")) {
    results.totalLayoutNodes++;
  }
  if (node.type === "TEXT") {
    results.totalTextNodes++;
  }
  try {
    if (node.hasOwnProperty("effects") && (node as any).effects && (node as any).effects.length > 0) {
      results.totalEffectNodes++;
    }
  } catch (e) { /* ignore */ }

  if (results.targetNodesScanned % 100 === 0) {
    figma.ui.postMessage({
      type: "progress",
      text: "Rebinding node " + results.targetNodesScanned + "...",
    });
  }

  // ── FILLS ──
  if (opts.colors && "fills" in node && Array.isArray(node.fills)) {
    var fills = (node.fills as Paint[]).slice();
    var fillsChanged = false;
    for (var fi = 0; fi < fills.length; fi++) {
      var p = fills[fi];
      if (p.type !== "SOLID") continue;
      var hex = rgbToHex(p.color.r, p.color.g, p.color.b);
      var binding = store.colors.get(hex) || null;
      if (!binding) {
        binding = fuzzyMatchColor(hex, store.colors, 2);
        if (binding) results.fuzzyMatches++;
      }
      if (binding) {
        fills[fi] = figma.variables.setBoundVariableForPaint(p, "color", binding.variable);
        results.fillsRebound++;
        fillsChanged = true;
      } else if (hex !== "#ffffff" && hex !== "#000000") {
        unmatchedColors.set(hex, (unmatchedColors.get(hex) || 0) + 1);
      }
    }
    if (fillsChanged) node.fills = fills;
  }

  // ── STROKES ──
  if (opts.colors && "strokes" in node && Array.isArray(node.strokes)) {
    var strokes = (node.strokes as Paint[]).slice();
    var strokesChanged = false;
    for (var si = 0; si < strokes.length; si++) {
      var sp = strokes[si];
      if (sp.type !== "SOLID") continue;
      var shex = rgbToHex(sp.color.r, sp.color.g, sp.color.b);
      var sb = store.colors.get(shex) || null;
      if (!sb) {
        sb = fuzzyMatchColor(shex, store.colors, 2);
        if (sb) results.fuzzyMatches++;
      }
      if (sb) {
        strokes[si] = figma.variables.setBoundVariableForPaint(sp, "color", sb.variable);
        results.strokesRebound++;
        strokesChanged = true;
      } else if (shex !== "#ffffff" && shex !== "#000000") {
        unmatchedColors.set(shex, (unmatchedColors.get(shex) || 0) + 1);
      }
    }
    if (strokesChanged) node.strokes = strokes;
  }

  // ── SCALAR FLOATS ──
  for (var sfi = 0; sfi < ALL_FLOAT_FIELDS.length; sfi++) {
    var sf2 = ALL_FLOAT_FIELDS[sfi];
    if (!fieldEnabled(sf2, opts)) continue;
    if (isAlreadyBound(node, sf2)) continue;
    var sv2 = readScalar(node, sf2);
    if (typeof sv2 !== "number") continue;
    var sk = fkey(sf2, sv2);
    var sfb = store.floats.get(sk);
    if (sfb) {
      try {
        (node as any).setBoundVariable(sf2, sfb.variable);
        incCounter(sf2, results);
      } catch (_e) { /* field not applicable to this node type */ }
    }
  }

  // ── BOOLEAN (visible) ──
  if (opts.misc) {
    for (var bfi = 0; bfi < MISC_BOOL_FIELDS.length; bfi++) {
      var bf2 = MISC_BOOL_FIELDS[bfi];
      if (isAlreadyBound(node, bf2)) continue;
      var bv2 = readScalar(node, bf2);
      if (typeof bv2 !== "boolean") continue;
      var bk = bkey(bf2, bv2);
      var bb = store.bools.get(bk);
      if (bb) {
        try {
          (node as any).setBoundVariable(bf2, bb.variable);
          results.visibilityRebound++;
        } catch (_e) { /* skip */ }
      }
    }
  }

  // ── STRING (characters) ──
  if (opts.misc) {
    for (var msfi = 0; msfi < MISC_STRING_FIELDS.length; msfi++) {
      var msf = MISC_STRING_FIELDS[msfi];
      if (isAlreadyBound(node, msf)) continue;
      var msv = readScalar(node, msf);
      if (typeof msv !== "string") continue;
      var msk = skey(msf, msv);
      var msb = store.strings.get(msk);
      if (msb) {
        try {
          (node as any).setBoundVariable(msf, msb.variable);
          results.charactersRebound++;
        } catch (_e) { /* skip */ }
      }
    }
  }

  // ── EFFECTS ──
  if (opts.effects && "effects" in node && Array.isArray((node as any).effects)) {
    var effs = ((node as any).effects as Effect[]).slice();
    var effsChanged = false;
    for (var efi2 = 0; efi2 < effs.length; efi2++) {
      var eff2 = effs[efi2];
      var esig = effectSig(eff2);
      var el = store.effects.get(esig);
      if (!el) continue;
      for (var elfi = 0; elfi < el.fields.length; elfi++) {
        try {
          var eVar = await figma.variables.getVariableByIdAsync(el.fields[elfi].variableId);
          if (eVar) {
            effs[efi2] = figma.variables.setBoundVariableForEffect(
              effs[efi2], el.fields[elfi].field as any, eVar
            );
            results.effectFieldsRebound++;
            effsChanged = true;
          }
        } catch (_e) { /* skip */ }
      }
    }
    if (effsChanged) (node as any).effects = effs;
  }

  // ── LAYOUT GRIDS ──
  if (opts.layout && "layoutGrids" in node) {
    var lgs = ((node as any).layoutGrids as LayoutGrid[]).slice();
    var lgsChanged = false;
    for (var lgi = 0; lgi < lgs.length; lgi++) {
      var lgsig = gridSig(lgs[lgi]);
      var lgLearned = store.layoutGrids.get(lgsig);
      if (!lgLearned) continue;
      for (var lgfi = 0; lgfi < lgLearned.fields.length; lgfi++) {
        try {
          var lgVar = await figma.variables.getVariableByIdAsync(lgLearned.fields[lgfi].variableId);
          if (lgVar) {
            lgs[lgi] = figma.variables.setBoundVariableForLayoutGrid(
              lgs[lgi], lgLearned.fields[lgfi].field as any, lgVar
            );
            results.layoutGridsRebound++;
            lgsChanged = true;
          }
        } catch (_e) { /* skip */ }
      }
    }
    if (lgsChanged) (node as any).layoutGrids = lgs;
  }

  // ── FONTS + TEXT STYLES + TYPOGRAPHY VARIABLES ──
  if (node.type === "TEXT") {
    var textNode = node as TextNode;

    // Fix font names
    if (opts.colors) { // fonts always run with colors
      results.fontsFixed += await fixFonts(textNode);
    }

    // Apply text style
    if (opts.typography) {
      var tfn = textNode.fontName;
      var tfs = textNode.fontSize;
      if (tfn !== figma.mixed && tfs !== figma.mixed) {
        var existingStyle = textNode.textStyleId;
        if (!existingStyle || existingStyle === "" || existingStyle === figma.mixed) {
          var tSig = (tfn as FontName).family + ":" + (tfn as FontName).style + ":" + Math.round(tfs as number);
          var tl = store.textStyles.get(tSig);
          if (tl) {
            try {
              var style = await figma.getStyleByIdAsync(tl.textStyleId);
              if (style) {
                textNode.textStyleId = tl.textStyleId;
                results.textStylesRebound++;
              }
            } catch (_e) { /* skip */ }
          }
        }
      }

      // Individual typography variables
      for (var tvfi = 0; tvfi < TYPO_VAR_FIELDS.length; tvfi++) {
        var tvf = TYPO_VAR_FIELDS[tvfi];
        if (isAlreadyBound(textNode, tvf)) continue;
        var tvRaw = (textNode as any)[tvf];
        if (tvRaw === figma.mixed || tvRaw === undefined) continue;
        var tvNum: number;
        if (typeof tvRaw === "object" && tvRaw !== null && "value" in tvRaw) {
          tvNum = (tvRaw as any).value;
        } else if (typeof tvRaw === "number") {
          tvNum = tvRaw;
        } else {
          continue;
        }
        var tvKey = fkey(tvf, tvNum);
        var tvBinding = store.typoVars.get(tvKey);
        if (tvBinding) {
          try {
            textNode.setBoundVariable(tvf as any, tvBinding.variable);
            results.typoVarsRebound++;
          } catch (_e) { /* skip */ }
        }
      }

      // Typography STRING fields
      for (var tsfi2 = 0; tsfi2 < TYPO_STRING_FIELDS.length; tsfi2++) {
        var tsf2 = TYPO_STRING_FIELDS[tsfi2];
        if (isAlreadyBound(textNode, tsf2)) continue;
        var tsRaw2 = (textNode as any)[tsf2];
        if (tsRaw2 === figma.mixed || typeof tsRaw2 !== "string") continue;
        var tsKey2 = skey(tsf2, tsRaw2);
        var tsBinding = store.strings.get(tsKey2);
        if (tsBinding) {
          try {
            textNode.setBoundVariable(tsf2 as any, tsBinding.variable);
            results.typoVarsRebound++;
          } catch (_e) { /* skip */ }
        }
      }
    }
  }

  // ── COMPONENT PROPERTIES ──
  if (opts.misc && "componentProperties" in node) {
    try {
      var cpDefs2 = (node as InstanceNode).componentProperties;
      if (cpDefs2) {
        var cpNames = Object.keys(cpDefs2);
        for (var cpi = 0; cpi < cpNames.length; cpi++) {
          var cpn = cpNames[cpi];
          var cpd = cpDefs2[cpn];
          if (isAlreadyBound(node, "componentProperties")) continue;
          if (typeof cpd.value === "boolean") {
            var cpbk = bkey("cp:" + cpn, cpd.value);
            var cpbb = store.bools.get(cpbk);
            if (cpbb) {
              try {
                (node as any).setProperties({ [cpn]: cpbb.variable });
                results.componentPropsRebound++;
              } catch (_e) { /* skip */ }
            }
          }
        }
      }
    } catch (_e) { /* skip */ }
  }

  // ── RECURSE ──
  if ("children" in node) {
    var ch = (node as FrameNode).children;
    for (var ri = 0; ri < ch.length; ri++) {
      await applyToNode(ch[ri], store, opts, results, unmatchedColors);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// UI + ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

figma.showUI(__html__, { width: 360, height: 780, themeColors: true });

var currentTier: "free" | "pro" | "team" = "free";
var lastStore: LearnedStore = createStore();
var lastHealthScore = 0;

figma.ui.onmessage = async function(msg) {
  if (msg.type === "open-upgrade") {
    figma.openExternal(API_BASE + "/auth/figma?tier=pro");
    return;
  }

  if (msg.type === "export-json") {
    if (currentTier === "free") {
      figma.ui.postMessage({
        type: "upsell",
        feature: "export",
        text: "Export token mappings as JSON is a Pro feature.",
      });
      return;
    }
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
    };
    figma.ui.postMessage({ type: "export-data", json: JSON.stringify(mapping, null, 2) });
    return;
  }

  if (msg.type !== "run") return;
  var opts = msg.options as RunOptions;

  currentTier = await checkLicense();
  figma.ui.postMessage({ type: "tier", tier: currentTier });

  var hasAccess = await checkFileAccess(currentTier);
  if (!hasAccess) {
    figma.ui.postMessage({
      type: "upsell",
      feature: "multi-file",
      text: "Free tier is limited to one Figma file. Upgrade to Pro for unlimited files.",
    });
    return;
  }

  try {
    var selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", text: "No frame selected." });
      return;
    }

    var excludeIds = new Set<string>();
    for (var i = 0; i < selection.length; i++) excludeIds.add(selection[i].id);

    var store = createStore();

    // Phase 1: Learn
    figma.ui.postMessage({ type: "progress", text: "Phase 1/4: Learning from existing designs..." });
    var sourceScanned = await learnFromFile(excludeIds, store);

    // Phase 2: Upgrade primitives
    figma.ui.postMessage({
      type: "progress",
      text: "Phase 2/4: Upgrading primitives (" + store.colors.size + " colors, " + store.floats.size + " floats)...",
    });
    var upgraded = await upgradePrimitives(store);

    // Phase 3: Local fallbacks
    figma.ui.postMessage({ type: "progress", text: "Phase 3/4: Adding local variable fallbacks..." });
    var localAdded = await addLocalFallbacks(store);

    // Phase 4: Apply
    figma.ui.postMessage({
      type: "progress",
      text: "Phase 4/4: Rebinding (" + store.colors.size + " colors, " +
        store.floats.size + " floats, " + store.effects.size + " effects, " +
        store.textStyles.size + " text styles)...",
    });

    var results: Results = {
      sourceNodesScanned: sourceScanned,
      targetNodesScanned: 0,
      colorsLearned: store.colors.size,
      floatsLearned: store.floats.size,
      textStylesLearned: store.textStyles.size,
      effectsLearned: store.effects.size,
      fillsRebound: 0, strokesRebound: 0,
      spacingRebound: 0, radiusRebound: 0, dimensionsRebound: 0,
      effectFieldsRebound: 0, strokeWeightRebound: 0,
      opacityRebound: 0, visibilityRebound: 0,
      typoVarsRebound: 0, textStylesRebound: 0, fontsFixed: 0,
      layoutGridsRebound: 0, componentPropsRebound: 0,
      gridGapsRebound: 0, charactersRebound: 0,
      fuzzyMatches: 0,
      localFallbacksAdded: localAdded,
      primitivesUpgraded: upgraded,
      unmatchedColors: [],
      totalPaintNodes: 0,
      totalLayoutNodes: 0,
      totalTextNodes: 0,
      totalEffectNodes: 0,
    };

    var unmatchedTracker = new Map<string, number>();

    for (var ni = 0; ni < selection.length; ni++) {
      await applyToNode(selection[ni], store, opts, results, unmatchedTracker);
    }

    results.unmatchedColors = Array.from(unmatchedTracker.entries())
      .map(function(e) { return { hex: e[0], count: e[1] }; })
      .sort(function(a, b) { return b.count - a.count; })
      .slice(0, 20);

    // Store for export
    lastStore = store;

    // Compute health score
    var totalRebound = results.fillsRebound + results.strokesRebound + results.spacingRebound
      + results.radiusRebound + results.dimensionsRebound + results.effectFieldsRebound
      + results.strokeWeightRebound + results.typoVarsRebound + results.textStylesRebound
      + results.fontsFixed + results.layoutGridsRebound + results.opacityRebound
      + results.visibilityRebound + results.gridGapsRebound + results.charactersRebound
      + results.componentPropsRebound;

    var totalScanned = results.totalPaintNodes + results.totalLayoutNodes
      + results.totalTextNodes + results.totalEffectNodes;

    var healthScore = totalScanned > 0 ? Math.round((totalRebound / totalScanned) * 100) : 0;
    if (healthScore > 100) healthScore = 100;

    var categoryScores = {
      colors: results.totalPaintNodes > 0
        ? Math.min(Math.round(((results.fillsRebound + results.strokesRebound) / results.totalPaintNodes) * 100), 100) : 0,
      layout: results.totalLayoutNodes > 0
        ? Math.min(Math.round(((results.spacingRebound + results.radiusRebound + results.dimensionsRebound + results.gridGapsRebound) / results.totalLayoutNodes) * 100), 100) : 0,
      typography: results.totalTextNodes > 0
        ? Math.min(Math.round(((results.typoVarsRebound + results.textStylesRebound + results.fontsFixed) / results.totalTextNodes) * 100), 100) : 0,
      effects: results.totalEffectNodes > 0
        ? Math.min(Math.round((results.effectFieldsRebound / results.totalEffectNodes) * 100), 100) : 0,
    };

    lastHealthScore = healthScore;

    // Version history metadata on free tier
    if (currentTier === "free") {
      figma.currentPage.setPluginData("token-rebinder", "Restored by Token Rebinder — " + new Date().toISOString());
    }

    figma.ui.postMessage({ type: "done", results: results, tier: currentTier, healthScore: healthScore, categoryScores: categoryScores });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      text: "Error: " + (error instanceof Error ? error.message : String(error)),
    });
  }
};
