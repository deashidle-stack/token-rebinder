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
  skippedNodes: number;   // whole subtrees that threw during the walk (partial result)
  skippedPaints: number;  // individual paints that couldn't bind (e.g. deleted variable); node still processed
}

type Provenance = "learned" | "upgraded" | "fallback";

interface LearnedBinding {
  variable: Variable;
  name: string;
  origin: Provenance;
  seenCount: number;
}

interface LearnedTextStyle {
  textStyleId: string;
  origin: Provenance;
  seenCount: number;
}

interface LearnedEffectBinding {
  fields: Array<{ field: string; variableId: string }>;
  signature: string;
  origin: Provenance;
  seenCount: number;
}

interface LearnedGridBinding {
  fields: Array<{ field: string; variableId: string }>;
  signature: string;
  origin: Provenance;
  seenCount: number;
}

/** Tab grouping in the review diff UI */
type PlanTab = "colors" | "dimensions" | "typography" | "effects" | "misc";

/**
 * A single proposed binding produced by the read-only plan pass.
 * The plan walk records these instead of mutating; commit re-walks and applies.
 */
interface PlanEntry {
  tab: PlanTab;
  fromValue: string;       // display string: hex, scalar, or effect/grid signature
  swatch: string | null;   // hex for a color swatch, else null
  toVariableName: string;
  provenance: Provenance;
  confidence: "exact" | "fuzzy";
  fuzzyDelta: number;      // 0 for exact
  seenCount: number;
}

/** Aggregated diff row sent to the UI (collapses identical PlanEntries + a count). */
interface PlanRow {
  key: string;             // stable row identity (colors: "c:<hex>"; else full signature)
  tab: PlanTab;
  fromValue: string;
  swatch: string | null;
  toVariableName: string;
  provenance: Provenance;
  confidence: "exact" | "fuzzy";
  fuzzyDelta: number;
  seenCount: number;
  count: number;           // how many nodes/fields this row covers
}

/**
 * Stable row identity. Colors key on the hex alone so a single color row can resolve
 * in place as the majority-vote leader shifts (and so fill+stroke of the same hex
 * aggregate into one row). Everything else keys on the full signature, because the
 * same numeric value can legitimately bind to different tokens via different fields.
 */
function planRowKey(tab: PlanTab, fromValue: string, swatch: string | null,
                    toVariableName: string, provenance: Provenance, confidence: string): string {
  if (tab === "colors" && swatch) return "c:" + fromValue;
  return tab + "|" + fromValue + "|" + toVariableName + "|" + provenance + "|" + confidence;
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
    if (!user || !user.id) return "free";

    var resp = await fetch(API_BASE + "/license/" + encodeURIComponent(user.id));
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

async function checkFileAccess(_tier: "free" | "pro" | "team"): Promise<boolean> {
  // Free tier covers full rebinding on unlimited files.
  // Team-only features are gated separately (rulebook, audit log, API access).
  return true;
}

function trackEvent(event: string, tier: string, payload?: Record<string, unknown>): void {
  try {
    fetch(API_BASE + "/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: event, tier: tier, payload: payload }),
    }).catch(function() { /* swallow async network rejection */ });
  } catch (_e) { /* fire and forget */ }
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
    if (Array.isArray(binding)) return !!(binding.length > 0 && binding[0] && binding[0].id);
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
  store: LearnedStore,
  wantedColors: Map<string, number>
): Promise<number> {
  var scanned = 0;

  // Majority-vote tally for colors: hex → (variableId → {variable, name, count}).
  // After the scan we pick the most-seen variable per hex (semantic tie-break),
  // which fixes the last-write-wins collision bug AND yields the "Learned ×N" count.
  var colorVotes = new Map<string, Map<string, { variable: Variable; name: string; count: number }>>();

  // For live streaming: last leader signature emitted per wanted hex, so we only
  // re-send a color row when its winning token or vote count actually changes.
  var emittedColor = new Map<string, string>();

  // Stream the current majority-vote winner for every TARGET color that's been seen
  // so far. This is what makes color rows resolve live during the long Learn scan —
  // the user watches "#0f3549 → Text/Primary ×N" climb and settle.
  function emitWantedColors(): void {
    if (wantedColors.size === 0) return;
    var rows: PlanRow[] = [];
    wantedColors.forEach(function(count, hex) {
      var byVar = colorVotes.get(hex);
      if (!byVar) return;
      var leader: { variable: Variable; name: string; count: number } | null = null;
      byVar.forEach(function(cand) {
        if (!leader) { leader = cand; return; }
        if (cand.count > (leader as any).count) { leader = cand; return; }
        if (cand.count === (leader as any).count && isBetter(cand.variable, (leader as any).variable)) { leader = cand; }
      });
      if (!leader) return;
      var sig = (leader as any).variable.id + ":" + (leader as any).count;
      if (emittedColor.get(hex) === sig) return; // unchanged since last emit
      emittedColor.set(hex, sig);
      rows.push({
        key: "c:" + hex, tab: "colors", fromValue: hex, swatch: hex,
        toVariableName: (leader as any).name, provenance: "learned", confidence: "exact",
        fuzzyDelta: 0, seenCount: (leader as any).count, count: count,
      });
    });
    if (rows.length > 0) figma.ui.postMessage({ type: "plan-batch", rows: rows });
  }

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
    var byVar = colorVotes.get(hex);
    if (!byVar) {
      byVar = new Map();
      colorVotes.set(hex, byVar);
    }
    var entry = byVar.get(varId);
    if (entry) {
      entry.count++;
    } else {
      byVar.set(varId, { variable: v, name: v.name, count: 1 });
    }
  }

  async function storeFloat(field: string, value: number, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var key = fkey(field, value);
    var existing = store.floats.get(key);
    if (!existing) {
      store.floats.set(key, { variable: v, name: v.name, origin: "learned", seenCount: 1 });
    } else if (existing.variable.id === v.id) {
      existing.seenCount++;
    } else if (isBetter(v, existing.variable)) {
      store.floats.set(key, { variable: v, name: v.name, origin: "learned", seenCount: existing.seenCount + 1 });
    } else {
      existing.seenCount++;
    }
  }

  async function storeString(field: string, value: string, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var key = skey(field, value);
    var ex = store.strings.get(key);
    if (!ex) {
      store.strings.set(key, { variable: v, name: v.name, origin: "learned", seenCount: 1 });
    } else if (ex.variable.id === v.id) {
      ex.seenCount++;
    }
  }

  async function storeBool(field: string, value: boolean, varId: string): Promise<void> {
    var v = await resolveVar(varId);
    if (!v) return;
    var key = bkey(field, value);
    var exb = store.bools.get(key);
    if (!exb) {
      store.bools.set(key, { variable: v, name: v.name, origin: "learned", seenCount: 1 });
    } else if (exb.variable.id === v.id) {
      exb.seenCount++;
    }
  }

  // Collapse the color vote tally into the store: most-seen wins, semantic tie-break.
  function resolveColorVotes(): void {
    colorVotes.forEach(function(byVar, hex) {
      var winner: { variable: Variable; name: string; count: number } | null = null;
      byVar.forEach(function(cand) {
        if (!winner) { winner = cand; return; }
        if (cand.count > winner.count) { winner = cand; return; }
        if (cand.count === winner.count && isBetter(cand.variable, winner.variable)) { winner = cand; }
      });
      if (winner) {
        store.colors.set(hex, {
          variable: (winner as any).variable,
          name: (winner as any).name,
          origin: "learned",
          seenCount: (winner as any).count,
        });
      }
    });
  }

  async function scanNode(node: SceneNode): Promise<void> {
    scanned++;
    // If the user cancelled, stop the (expensive) scan promptly instead of grinding
    // through all ~73k nodes and streaming rows into an already-dismissed UI.
    if (cancelRequested) return;
    // Stream learning progress + yield mid-subtree so the UI never freezes.
    if (scanned === 1 || scanned % 500 === 0) {
      figma.ui.postMessage({
        type: "progress", phase: 1, label: "Learning", current: scanned, total: 0,
        tally: {
          colors: colorVotes.size, values: store.floats.size,
          effects: store.effects.size, textStyles: store.textStyles.size,
        },
      });
      emitWantedColors(); // resolve target color rows live as we learn
      await yieldToUI();
    }
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
                store.effects.set(sig, { fields: learnedFields, signature: sig, origin: "learned", seenCount: 1 });
              } else if (learnedFields.length > 0) {
                (store.effects.get(sig) as LearnedEffectBinding).seenCount++;
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
                store.layoutGrids.set(gsig, { fields: gFields, signature: gsig, origin: "learned", seenCount: 1 });
              } else if (gFields.length > 0) {
                (store.layoutGrids.get(gsig) as LearnedGridBinding).seenCount++;
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
                  store.textStyles.set(tsig, { textStyleId: styleId as string, origin: "learned", seenCount: 1 });
                } else {
                  (store.textStyles.get(tsig) as LearnedTextStyle).seenCount++;
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
                    store.typoVars.set(tKey, { variable: tVar, name: tVar.name, origin: "learned", seenCount: 1 });
                  } else if (tVar) {
                    (store.typoVars.get(tKey) as LearnedBinding).seenCount++;
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
                    store.strings.set(tsKey, { variable: tsVar, name: tsVar.name, origin: "learned", seenCount: 1 });
                  } else if (tsVar) {
                    (store.strings.get(tsKey) as LearnedBinding).seenCount++;
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

  }

  // Final live emit (covers colors learned after the last progress tick); skip if cancelled.
  if (!cancelRequested) emitWantedColors();

  // Collapse color votes (majority-wins) into store.colors.
  resolveColorVotes();

  return scanned;
}

/**
 * Read-only pre-scan of the target frame(s) to find every color that WILL need a
 * binding (unbound SOLID fills/strokes), with occurrence counts. Mirrors the
 * already-bound guard from applyToNode so counts match the plan. Lets us stream
 * each target color's row live as Learn resolves its token.
 */
function collectTargetColors(node: SceneNode, opts: RunOptions, wanted: Map<string, number>): void {
  if (!opts.colors) return;
  try {
    var paintGroups: Array<"fills" | "strokes"> = ["fills", "strokes"];
    for (var g = 0; g < paintGroups.length; g++) {
      var arr = (node as any)[paintGroups[g]];
      if (!Array.isArray(arr)) continue;
      for (var pi = 0; pi < arr.length; pi++) {
        var p = arr[pi];
        if (!p || p.type !== "SOLID") continue;
        if (p.boundVariables && (p.boundVariables as any).color) continue; // already bound
        // White and black are included: they're real, meaningful bindings in most systems
        // (e.g. #000000 → Basic/Black, #ffffff → Surface/Base/Global BG) and stream live too.
        var hex = rgbToHex(p.color.r, p.color.g, p.color.b);
        wanted.set(hex, (wanted.get(hex) || 0) + 1);
      }
    }
  } catch (_e) { /* skip */ }
  if ("children" in node) {
    var ch = (node as FrameNode).children;
    for (var ci = 0; ci < ch.length; ci++) {
      try { collectTargetColors(ch[ci], opts, wanted); } catch (_e) { /* skip */ }
    }
  }
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
                    var prevC = store.colors.get(primColors[pi].hex);
                    // If we've already upgraded this hex to a semantic alias, only replace
                    // when the new one is strictly better — don't let a later, worse alias win.
                    if (prevC && prevC.origin === "upgraded" && !isBetter(v, prevC.variable)) break;
                    store.colors.set(primColors[pi].hex, {
                      variable: v, name: v.name, origin: "upgraded",
                      seenCount: prevC ? prevC.seenCount : 0,
                    });
                    if (!(prevC && prevC.origin === "upgraded")) upgraded++;
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
                    var prevF = store.floats.get(primFloats[fpi].key);
                    if (prevF && prevF.origin === "upgraded" && !isBetter(fv, prevF.variable)) break;
                    store.floats.set(primFloats[fpi].key, {
                      variable: fv, name: fv.name, origin: "upgraded",
                      seenCount: prevF ? prevF.seenCount : 0,
                    });
                    if (!(prevF && prevF.origin === "upgraded")) upgraded++;
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
              store.colors.set(hex, { variable: v, name: v.name, origin: "fallback", seenCount: 0 });
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
                  store.colors.set(rhex, { variable: v, name: v.name, origin: "fallback", seenCount: 0 });
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
            store.floats.set(key, { variable: fv, name: fv.name, origin: "fallback", seenCount: 0 });
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

/**
 * Predict the font name fixFonts() would produce for a single (non-mixed) font,
 * WITHOUT mutating. Mirrors fixFonts' exact match condition so the plan pass and
 * the commit pass derive the same text-style key. Returns the input unchanged when
 * no fix applies (avoids the family-fallback mangling an already-correct style).
 */
function predictFixedFont(fn: FontName): FontName {
  var fix = FONT_FIXES[fn.family + ":" + fn.style] || FONT_FIXES[fn.family];
  if (fix && (fn.family !== fix.family || fn.style !== fix.style)) {
    return { family: fix.family, style: fix.style };
  }
  return fn;
}

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

/** Map a scalar float/misc field to its diff tab. */
function fieldTab(field: string): PlanTab {
  if (SPACING_FIELDS.indexOf(field as any) >= 0) return "dimensions";
  if (RADIUS_FIELDS.indexOf(field as any) >= 0) return "dimensions";
  if (DIMENSION_FIELDS.indexOf(field as any) >= 0) return "dimensions";
  if (GRID_GAP_FIELDS.indexOf(field as any) >= 0) return "dimensions";
  if (STROKE_WEIGHT_FIELDS.indexOf(field as any) >= 0) return "dimensions";
  return "misc"; // opacity, visible, characters
}

/**
 * Width/height (and their min/max) can only be bound on layers whose sizing is
 * FIXED in that axis — auto-layout HUG/FILL layers reject the binding. Skipping
 * those in the PLAN removes ~thousands of phantom rows the user could never apply,
 * and (because it runs in both passes) keeps plan and commit counts aligned.
 * Non-auto-layout layers report no sizing mode → treated as bindable.
 */
function dimensionBindable(node: SceneNode, field: string): boolean {
  var horiz = field === "width" || field === "minWidth" || field === "maxWidth";
  var vert = field === "height" || field === "minHeight" || field === "maxHeight";
  if (!horiz && !vert) return true;
  try {
    var sizing = horiz ? (node as any).layoutSizingHorizontal : (node as any).layoutSizingVertical;
    if (typeof sizing === "string" && sizing !== "FIXED") return false;
  } catch (_e) { /* property absent → bindable */ }
  return true;
}

/**
 * Cooperative yield so the plugin thread releases control and the UI iframe
 * can repaint / receive queued messages mid-walk.
 *
 * PRIMARY: an ack round-trip through the iframe. We post "__yield"; the UI replies
 * "__yield-ack". Awaiting that reply is strictly stronger than setTimeout(0): the
 * reply PROVES the iframe received CPU time (so it could repaint) and that our queued
 * progress/plan-batch messages flushed. This makes "never looks frozen" a construction
 * guarantee rather than an assumption about setTimeout's repaint behavior.
 *
 * SAFETY NET: a setTimeout timeout resolves the yield anyway if the iframe is closed
 * or unresponsive, so a dead UI can never hang the walk. (If setTimeout itself is
 * unavailable, the ack is the only path — still correct, just no backstop.)
 */
var pendingYield: (() => void) | null = null;

function yieldToUI(): Promise<void> {
  return new Promise(function(resolve) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (pendingYield === settle) pendingYield = null;
      resolve();
    }
    function settle() { finish(); }

    // Resolve any stale pending resolver first so an overlapping yield can never
    // strand a prior promise (belt-and-suspenders; re-entrancy guard prevents overlap).
    if (pendingYield) { var stale = pendingYield; pendingYield = null; stale(); }
    pendingYield = settle;
    try { figma.ui.postMessage({ type: "__yield" }); } catch (_e) { /* no UI — fall through to timer */ }

    // Safety net: never hang if the iframe doesn't ack (closed/unresponsive).
    if (typeof setTimeout === "function") { setTimeout(finish, 1500); }
  });
}

// Incremental plan aggregation — streams diff rows to the UI DURING the plan walk
// (rows appear and their counts tick up live, like Check designs) instead of in one
// burst at the end. flushPlanRows() reads new PlanEntries since the last cursor,
// folds them into planAgg, and posts only the rows that changed.
var planAgg: Map<string, PlanRow> = new Map();
var planDirty: string[] = [];
var planFlushCursor = 0;

function resetPlanAgg(): void {
  planAgg = new Map();
  planDirty = [];
  planFlushCursor = 0;
}

function flushPlanRows(plan: PlanEntry[]): void {
  for (var i = planFlushCursor; i < plan.length; i++) {
    var e = plan[i];
    var key = planRowKey(e.tab, e.fromValue, e.swatch, e.toVariableName, e.provenance, e.confidence);
    var row = planAgg.get(key);
    if (row) {
      // Same color hex re-seen: keep its count growing and let the latest (final) token win.
      row.count++;
      row.toVariableName = e.toVariableName;
      row.provenance = e.provenance;
      row.confidence = e.confidence;
      row.fuzzyDelta = e.fuzzyDelta;
      row.seenCount = e.seenCount;
    } else {
      planAgg.set(key, {
        key: key, tab: e.tab, fromValue: e.fromValue, swatch: e.swatch, toVariableName: e.toVariableName,
        provenance: e.provenance, confidence: e.confidence, fuzzyDelta: e.fuzzyDelta,
        seenCount: e.seenCount, count: 1,
      });
    }
    if (planDirty.indexOf(key) < 0) planDirty.push(key);
  }
  planFlushCursor = plan.length;
  if (planDirty.length === 0) return;
  var out: PlanRow[] = [];
  for (var d = 0; d < planDirty.length; d++) {
    var r = planAgg.get(planDirty[d]);
    if (r) out.push(r);
  }
  planDirty = [];
  figma.ui.postMessage({ type: "plan-batch", rows: out });
}

async function applyToNode(
  node: SceneNode,
  store: LearnedStore,
  opts: RunOptions,
  results: Results,
  unmatchedColors: Map<string, number>,
  dryRun: boolean,
  plan: PlanEntry[]
): Promise<void> {
  // Stop the planning walk promptly if the user cancelled. (Commit ignores cancel —
  // once Apply is clicked it runs to completion.)
  if (dryRun && cancelRequested) return;
  results.targetNodesScanned++;

  // Track category totals for health score (read-only, runs in both passes)
  if ("fills" in node) {
    results.totalPaintNodes++;
  }
  if ("paddingTop" in node) {
    results.totalLayoutNodes++;
  }
  if (node.type === "TEXT") {
    results.totalTextNodes++;
  }
  try {
    if ("effects" in node && (node as any).effects && (node as any).effects.length > 0) {
      results.totalEffectNodes++;
    }
  } catch (e) { /* ignore */ }

  // Stream progress + yield so the UI repaints mid-walk (phase 4).
  // Planning flushes finely (every 20 nodes) so rows visibly trickle into the diff
  // as they're discovered; committing can stride coarsely (it doesn't render rows).
  var streamEvery = dryRun ? 20 : 200;
  if (results.targetNodesScanned % streamEvery === 0) {
    figma.ui.postMessage({
      type: "progress", phase: 4, label: dryRun ? "Planning" : "Applying",
      current: results.targetNodesScanned, total: walkTotal,
    });
    if (dryRun) flushPlanRows(plan); // stream rows discovered so far
    await yieldToUI();
  }

  // ── FILLS ──
  if (opts.colors && "fills" in node && Array.isArray(node.fills)) {
    var fills = (node.fills as Paint[]).slice();
    var fillsChanged = false;
    for (var fi = 0; fi < fills.length; fi++) {
      var p = fills[fi];
      if (p.type !== "SOLID") continue;
      // Don't touch paints that already carry a bound color variable — never clobber
      // an existing (possibly manually-set) binding, and keep plan/commit counts honest.
      if (p.boundVariables && (p.boundVariables as any).color) continue;
      var hex = rgbToHex(p.color.r, p.color.g, p.color.b);
      var binding = store.colors.get(hex) || null;
      var fillFuzzy = false;
      if (!binding) {
        binding = fuzzyMatchColor(hex, store.colors, 2);
        if (binding) fillFuzzy = true;
      }
      if (binding) {
        if (dryRun) {
          plan.push({
            tab: "colors", fromValue: hex, swatch: hex, toVariableName: binding.name,
            provenance: binding.origin, confidence: fillFuzzy ? "fuzzy" : "exact",
            fuzzyDelta: fillFuzzy ? 2 : 0, seenCount: binding.seenCount,
          });
        } else {
          try {
            fills[fi] = figma.variables.setBoundVariableForPaint(p, "color", binding.variable);
            results.fillsRebound++;
            if (fillFuzzy) results.fuzzyMatches++;
            fillsChanged = true;
          } catch (_e) { results.skippedPaints++; /* paint not bindable (e.g. variable deleted); node continues */ }
        }
      } else if (hex !== "#ffffff" && hex !== "#000000") {
        unmatchedColors.set(hex, (unmatchedColors.get(hex) || 0) + 1);
      }
    }
    if (!dryRun && fillsChanged) node.fills = fills;
  }

  // ── STROKES ──
  if (opts.colors && "strokes" in node && Array.isArray(node.strokes)) {
    var strokes = (node.strokes as Paint[]).slice();
    var strokesChanged = false;
    for (var si = 0; si < strokes.length; si++) {
      var sp = strokes[si];
      if (sp.type !== "SOLID") continue;
      if (sp.boundVariables && (sp.boundVariables as any).color) continue; // already bound — skip
      var shex = rgbToHex(sp.color.r, sp.color.g, sp.color.b);
      var sb = store.colors.get(shex) || null;
      var strokeFuzzy = false;
      if (!sb) {
        sb = fuzzyMatchColor(shex, store.colors, 2);
        if (sb) strokeFuzzy = true;
      }
      if (sb) {
        if (dryRun) {
          plan.push({
            tab: "colors", fromValue: shex, swatch: shex, toVariableName: sb.name,
            provenance: sb.origin, confidence: strokeFuzzy ? "fuzzy" : "exact",
            fuzzyDelta: strokeFuzzy ? 2 : 0, seenCount: sb.seenCount,
          });
        } else {
          try {
            strokes[si] = figma.variables.setBoundVariableForPaint(sp, "color", sb.variable);
            results.strokesRebound++;
            if (strokeFuzzy) results.fuzzyMatches++;
            strokesChanged = true;
          } catch (_e) { results.skippedPaints++; /* stroke not bindable; node continues */ }
        }
      } else if (shex !== "#ffffff" && shex !== "#000000") {
        unmatchedColors.set(shex, (unmatchedColors.get(shex) || 0) + 1);
      }
    }
    if (!dryRun && strokesChanged) node.strokes = strokes;
  }

  // ── SCALAR FLOATS ──
  for (var sfi = 0; sfi < ALL_FLOAT_FIELDS.length; sfi++) {
    var sf2 = ALL_FLOAT_FIELDS[sfi];
    if (!fieldEnabled(sf2, opts)) continue;
    if (isAlreadyBound(node, sf2)) continue;
    // Don't propose width/height on hug/fill layers — they can't accept the binding.
    if (DIMENSION_FIELDS.indexOf(sf2 as any) >= 0 && !dimensionBindable(node, sf2)) continue;
    var sv2 = readScalar(node, sf2);
    if (typeof sv2 !== "number") continue;
    var sk = fkey(sf2, sv2);
    var sfb = store.floats.get(sk);
    if (sfb) {
      if (dryRun) {
        plan.push({
          tab: fieldTab(sf2), fromValue: String(sv2), swatch: null, toVariableName: sfb.name,
          provenance: sfb.origin, confidence: "exact", fuzzyDelta: 0, seenCount: sfb.seenCount,
        });
      } else {
        try {
          (node as any).setBoundVariable(sf2, sfb.variable);
          incCounter(sf2, results);
        } catch (_e) { /* field not applicable to this node type */ }
      }
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
        if (dryRun) {
          plan.push({
            tab: "misc", fromValue: bf2 + ": " + String(bv2), swatch: null, toVariableName: bb.name,
            provenance: bb.origin, confidence: "exact", fuzzyDelta: 0, seenCount: bb.seenCount,
          });
        } else {
          try {
            (node as any).setBoundVariable(bf2, bb.variable);
            results.visibilityRebound++;
          } catch (_e) { /* skip */ }
        }
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
        if (dryRun) {
          plan.push({
            tab: "misc", fromValue: msf, swatch: null, toVariableName: msb.name,
            provenance: msb.origin, confidence: "exact", fuzzyDelta: 0, seenCount: msb.seenCount,
          });
        } else {
          try {
            (node as any).setBoundVariable(msf, msb.variable);
            results.charactersRebound++;
          } catch (_e) { /* skip */ }
        }
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
            if (dryRun) {
              plan.push({
                tab: "effects", fromValue: el.fields[elfi].field, swatch: null, toVariableName: eVar.name,
                provenance: el.origin, confidence: "exact", fuzzyDelta: 0, seenCount: el.seenCount,
              });
            } else {
              effs[efi2] = figma.variables.setBoundVariableForEffect(
                effs[efi2], el.fields[elfi].field as any, eVar
              );
              results.effectFieldsRebound++;
              effsChanged = true;
            }
          }
        } catch (_e) { /* skip */ }
      }
    }
    if (!dryRun && effsChanged) (node as any).effects = effs;
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
            if (dryRun) {
              plan.push({
                tab: "misc", fromValue: "grid:" + lgLearned.fields[lgfi].field, swatch: null, toVariableName: lgVar.name,
                provenance: lgLearned.origin, confidence: "exact", fuzzyDelta: 0, seenCount: lgLearned.seenCount,
              });
            } else {
              lgs[lgi] = figma.variables.setBoundVariableForLayoutGrid(
                lgs[lgi], lgLearned.fields[lgfi].field as any, lgVar
              );
              results.layoutGridsRebound++;
              lgsChanged = true;
            }
          }
        } catch (_e) { /* skip */ }
      }
    }
    if (!dryRun && lgsChanged) (node as any).layoutGrids = lgs;
  }

  // ── FONTS + TEXT STYLES + TYPOGRAPHY VARIABLES ──
  if (node.type === "TEXT") {
    var textNode = node as TextNode;

    // Capture the font BEFORE any fix so plan and commit compute the SAME text-style key.
    // (Commit runs fixFonts below, which would otherwise change fontName mid-pass and make
    // the committed text-style match diverge from what the plan showed.)
    var rawFont = textNode.fontName;
    var rawSize = textNode.fontSize;

    // Fix font names — a safe rename, applied only on commit (not part of the reviewable diff).
    if (opts.typography && !dryRun) {
      results.fontsFixed += await fixFonts(textNode);
    }

    // Apply text style
    if (opts.typography) {
      if (rawFont !== figma.mixed && rawSize !== figma.mixed) {
        var existingStyle = textNode.textStyleId;
        if (!existingStyle || existingStyle === "" || existingStyle === figma.mixed) {
          // Use the predicted post-fix font so the key matches in both passes.
          var pf = predictFixedFont(rawFont as FontName);
          var tSig = pf.family + ":" + pf.style + ":" + Math.round(rawSize as number);
          var tl = store.textStyles.get(tSig);
          if (tl) {
            try {
              var style = await figma.getStyleByIdAsync(tl.textStyleId);
              if (style) {
                if (dryRun) {
                  plan.push({
                    tab: "typography", fromValue: tSig, swatch: null, toVariableName: style.name,
                    provenance: tl.origin, confidence: "exact", fuzzyDelta: 0, seenCount: tl.seenCount,
                  });
                } else {
                  textNode.textStyleId = tl.textStyleId;
                  results.textStylesRebound++;
                }
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
          if (dryRun) {
            plan.push({
              tab: "typography", fromValue: tvf + ": " + String(tvNum), swatch: null, toVariableName: tvBinding.name,
              provenance: tvBinding.origin, confidence: "exact", fuzzyDelta: 0, seenCount: tvBinding.seenCount,
            });
          } else {
            try {
              textNode.setBoundVariable(tvf as any, tvBinding.variable);
              results.typoVarsRebound++;
            } catch (_e) { /* skip */ }
          }
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
          if (dryRun) {
            plan.push({
              tab: "typography", fromValue: tsf2 + ": " + tsRaw2, swatch: null, toVariableName: tsBinding.name,
              provenance: tsBinding.origin, confidence: "exact", fuzzyDelta: 0, seenCount: tsBinding.seenCount,
            });
          } else {
            try {
              textNode.setBoundVariable(tsf2 as any, tsBinding.variable);
              results.typoVarsRebound++;
            } catch (_e) { /* skip */ }
          }
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
          if (cpd.boundVariables && cpd.boundVariables.value) continue;
          if (typeof cpd.value === "boolean") {
            var cpbk = bkey("cp:" + cpn, cpd.value);
            var cpbb = store.bools.get(cpbk);
            if (cpbb) {
              if (dryRun) {
                plan.push({
                  tab: "misc", fromValue: "prop:" + cpn, swatch: null, toVariableName: cpbb.name,
                  provenance: cpbb.origin, confidence: "exact", fuzzyDelta: 0, seenCount: cpbb.seenCount,
                });
              } else {
                try {
                  (node as any).setProperties({ [cpn]: cpbb.variable });
                  results.componentPropsRebound++;
                } catch (_e) { /* skip */ }
              }
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
      try {
        await applyToNode(ch[ri], store, opts, results, unmatchedColors, dryRun, plan);
      } catch (_e) { results.skippedNodes++; }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// UI + ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

figma.showUI(__html__, { width: 460, height: 760, themeColors: true });

// Restore the user's last chosen window size, if any.
figma.clientStorage.getAsync("uiSize").then(function(s: any) {
  if (s && typeof s.w === "number" && typeof s.h === "number") {
    try { figma.ui.resize(s.w, s.h); } catch (_e) { /* ignore */ }
  }
}).catch(function() { /* ignore */ });

var currentTier: "free" | "pro" | "team" = "free";
var lastStore: LearnedStore = createStore();
var lastHealthScore = 0;
var lastCategoryScores: Record<string, number> | null = null;

// Total target nodes for the current walk (drives the progress bar in applyToNode).
var walkTotal = 0;

// Held plan state between run-plan (read-only) and commit (mutate).
var lastPlanStore: LearnedStore = createStore();
var lastPlanOpts: RunOptions | null = null;
var lastPlanSelectionIds: string[] = [];
var lastPlanCount = 0;          // number of proposed bindings (PlanEntry count)
var lastPlanSourceScanned = 0;
var lastPlanLocalAdded = 0;
var lastPlanUpgraded = 0;

function createResults(store: LearnedStore, sourceScanned: number, localAdded: number, upgraded: number): Results {
  return {
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
    skippedNodes: 0,
    skippedPaints: 0,
  };
}

function sumRebound(r: Results): number {
  return r.fillsRebound + r.strokesRebound + r.spacingRebound + r.radiusRebound
    + r.dimensionsRebound + r.effectFieldsRebound + r.strokeWeightRebound
    + r.typoVarsRebound + r.textStylesRebound + r.fontsFixed + r.layoutGridsRebound
    + r.opacityRebound + r.visibilityRebound + r.gridGapsRebound + r.charactersRebound
    + r.componentPropsRebound;
}

/** Count a node + all descendants (for the progress-bar total). */
function countNodes(node: SceneNode): number {
  var n = 1;
  if ("children" in node) {
    var ch = (node as FrameNode).children;
    for (var i = 0; i < ch.length; i++) {
      try { n += countNodes(ch[i]); } catch (_e) { /* skip */ }
    }
  }
  return n;
}

// Guards against overlapping run-plan/commit runs corrupting shared module state.
var isBusy = false;
// Set by `cancel` to abort an in-flight (read-only) plan before it posts plan-complete.
var cancelRequested = false;
// Target node count captured at plan time — compared at commit to detect a frame that
// structurally changed during review (so we never silently apply an unreviewed plan).
var lastPlanWalkTotal = 0;

// Track plugin open + sync tier on launch
checkLicense().then(function(t) {
  currentTier = t;
  figma.ui.postMessage({ type: "tier", tier: t });
  trackEvent("plugin_open", t);
});

figma.ui.onmessage = async function(msg) {
  if (msg.type === "__yield-ack") {
    if (pendingYield) { var r = pendingYield; pendingYield = null; r(); }
    return;
  }

  if (msg.type === "resize") {
    var rw = Math.min(900, Math.max(340, Math.floor(msg.width)));
    var rh = Math.min(1200, Math.max(420, Math.floor(msg.height)));
    try { figma.ui.resize(rw, rh); } catch (_e) { /* ignore */ }
    figma.clientStorage.setAsync("uiSize", { w: rw, h: rh }).catch(function() {});
    return;
  }

  if (msg.type === "open-upgrade") {
    trackEvent("upgrade_click", currentTier);
    figma.openExternal("https://tokenrebinder.everform.io/upgrade");
    return;
  }

  if (msg.type === "share-score") {
    // Score-focused artifact (distinct from the full mapping export).
    var card = {
      tool: "Token Rebinder",
      exportedAt: new Date().toISOString(),
      healthScore: lastHealthScore,
      categoryScores: lastCategoryScores,
    };
    figma.ui.postMessage({ type: "export-data", json: JSON.stringify(card, null, 2), filename: "token-health-score.json" });
    trackEvent("health_score", currentTier);
    return;
  }

  if (msg.type === "export-json") {
    currentTier = await checkLicense();
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
    figma.ui.postMessage({ type: "export-data", json: JSON.stringify(mapping, null, 2), filename: "token-rebinder-mapping.json" });
    trackEvent("export_json", currentTier);
    return;
  }

  if (msg.type === "cancel") {
    // Abort an in-flight plan (read-only, so safe) and drop any held plan.
    cancelRequested = true;
    lastPlanOpts = null;
    lastPlanSelectionIds = [];
    lastPlanCount = 0;
    return;
  }

  // ── RUN-PLAN: read-only. Learn → Upgrade → Fallback → Plan. Mutates nothing. ──
  if (msg.type === "run-plan") {
    if (isBusy) { figma.ui.postMessage({ type: "error", text: "A run is already in progress — please wait." }); return; }
    isBusy = true;
    cancelRequested = false;
    // Everything below must sit inside try/finally so isBusy is ALWAYS reset
    // (e.g. even if checkLicense or any await rejects) — never wedge the plugin "busy".
    try {
      var opts = msg.options as RunOptions;
      var autoApply = !!msg.autoApply;
      currentTier = await checkLicense();
      figma.ui.postMessage({ type: "tier", tier: currentTier });

      var selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({ type: "error", text: "No frame selected. Select the pushed frame, then run." });
        return;
      }

      var excludeIds = new Set<string>();
      for (var i = 0; i < selection.length; i++) excludeIds.add(selection[i].id);

      var store = createStore();

      // Pre-scan the target's colors so their rows can resolve LIVE during the long
      // Learn scan (the user watches each color settle on its majority-vote token).
      var wantedColors = new Map<string, number>();
      for (var wc = 0; wc < selection.length; wc++) collectTargetColors(selection[wc], opts, wantedColors);

      // Phase 1: Learn (streams color rows as it goes)
      figma.ui.postMessage({ type: "progress", phase: 1, label: "Learning", current: 0, total: 0 });
      var sourceScanned = await learnFromFile(excludeIds, store, wantedColors);
      if (cancelRequested) return; // cancelled during Learn — skip Upgrade/Fallback/Plan entirely

      // Phase 2: Upgrade primitives
      figma.ui.postMessage({ type: "progress", phase: 2, label: "Upgrading", current: 0, total: 0 });
      var upgraded = await upgradePrimitives(store);

      // Phase 3: Local fallbacks
      figma.ui.postMessage({ type: "progress", phase: 3, label: "Fallbacks", current: 0, total: 0 });
      var localAdded = await addLocalFallbacks(store);

      // Phase 4: Plan (dry-run — records proposed bindings, mutates nothing)
      walkTotal = 0;
      for (var ci = 0; ci < selection.length; ci++) walkTotal += countNodes(selection[ci]);
      figma.ui.postMessage({ type: "progress", phase: 4, label: "Planning", current: 0, total: walkTotal });

      resetPlanAgg(); // start a fresh streaming aggregation for this plan
      var planResults = createResults(store, sourceScanned, localAdded, upgraded);
      var planEntries: PlanEntry[] = [];
      var planUnmatched = new Map<string, number>();
      for (var pn = 0; pn < selection.length; pn++) {
        await applyToNode(selection[pn], store, opts, planResults, planUnmatched, true, planEntries);
      }

      // Final flush of any rows discovered since the last in-walk flush; rows already
      // streamed live during the walk above.
      flushPlanRows(planEntries);
      var byTab: Record<string, number> = { colors: 0, dimensions: 0, typography: 0, effects: 0, misc: 0 };
      planAgg.forEach(function(r) { byTab[r.tab] += r.count; });

      var unmatched = Array.from(planUnmatched.entries())
        .map(function(e) { return { hex: e[0], count: e[1] }; })
        .sort(function(a, b) { return b.count - a.count; })
        .slice(0, 20);

      // If the user cancelled mid-plan, drop everything — don't re-enable Apply for a stale plan.
      if (cancelRequested) { return; }

      // Hold state for commit
      lastPlanStore = store;
      lastStore = store; // for export
      lastPlanOpts = opts;
      lastPlanSelectionIds = selection.map(function(s) { return s.id; });
      lastPlanCount = planEntries.length;
      lastPlanWalkTotal = walkTotal;
      lastPlanSourceScanned = sourceScanned;
      lastPlanLocalAdded = localAdded;
      lastPlanUpgraded = upgraded;

      if (autoApply) {
        // No review step — go straight to commit. Don't post plan-complete (which would
        // briefly expose a clickable "Apply N" mid-commit).
        await commitAndReport(opts);
      } else {
        // learnedRatio: how much of the plan is backed by real learned bindings (vs fallbacks).
        var learnedEntries = 0;
        for (var le = 0; le < planEntries.length; le++) {
          if (planEntries[le].provenance !== "fallback") learnedEntries++;
        }
        var learnedRatio = planEntries.length > 0 ? learnedEntries / planEntries.length : 1;

        figma.ui.postMessage({
          type: "plan-complete",
          total: planEntries.length,
          byTab: byTab,
          unmatched: unmatched,
          learnedRatio: learnedRatio,
          learned: { colors: store.colors.size, values: store.floats.size, textStyles: store.textStyles.size, effects: store.effects.size },
        });
      }
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        text: "Error: " + (error instanceof Error ? error.message : String(error)),
      });
    } finally {
      isBusy = false;
      cancelRequested = false; // clear the flag so it can never leak into a later run
    }
    return;
  }

  // ── COMMIT: re-walk the held selection and apply for real. ──
  if (msg.type === "commit") {
    if (isBusy) { figma.ui.postMessage({ type: "error", text: "A run is already in progress — please wait." }); return; }
    if (!lastPlanOpts) {
      figma.ui.postMessage({ type: "error", text: "Nothing to apply — run a plan first." });
      return;
    }
    isBusy = true;
    try {
      await commitAndReport(lastPlanOpts);
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        text: "Error: " + (error instanceof Error ? error.message : String(error)),
      });
    } finally {
      isBusy = false;
      cancelRequested = false; // clear the flag so it can never leak into a later run
    }
    return;
  }
};

/** Re-walk the held selection, apply bindings for real, compute health, report done. */
async function commitAndReport(opts: RunOptions): Promise<void> {
  // Re-fetch selection by id (safe under dynamic-page; reflects current canvas state).
  var sel: SceneNode[] = [];
  for (var i = 0; i < lastPlanSelectionIds.length; i++) {
    var n = await figma.getNodeByIdAsync(lastPlanSelectionIds[i]);
    if (n && "type" in n) sel.push(n as SceneNode);
  }
  // A genuine "changed during review" signal: some (but not all) planned roots vanished.
  var missingRoots = lastPlanSelectionIds.length - sel.length;
  if (sel.length === 0) {
    figma.ui.postMessage({ type: "error", text: "The planned frame is no longer available. Re-select and run again." });
    return;
  }

  walkTotal = 0;
  for (var c = 0; c < sel.length; c++) walkTotal += countNodes(sel[c]);
  figma.ui.postMessage({ type: "progress", phase: 4, label: "Applying", current: 0, total: walkTotal });

  var results = createResults(lastPlanStore, lastPlanSourceScanned, lastPlanLocalAdded, lastPlanUpgraded);
  var unmatchedTracker = new Map<string, number>();
  var sink: PlanEntry[] = []; // unused during commit
  for (var s = 0; s < sel.length; s++) {
    await applyToNode(sel[s], lastPlanStore, opts, results, unmatchedTracker, false, sink);
  }

  results.unmatchedColors = Array.from(unmatchedTracker.entries())
    .map(function(e) { return { hex: e[0], count: e[1] }; })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 20);

  var totalRebound = sumRebound(results);
  // appliedBindings excludes font renames (not part of the reviewable plan).
  var appliedBindings = totalRebound - results.fontsFixed;
  // Planned-but-not-applied. Dominant cause is fields inapplicable to their layer type
  // (e.g. width on a hug/fill node), NOT review edits — so this is informational, not a warning.
  // A true "changed during review" is signalled separately by missingRoots / selectionChanged.
  var skippedFromPlan = lastPlanCount > appliedBindings ? lastPlanCount - appliedBindings : 0;
  // "Changed during review" = the reviewed plan no longer matches what we just committed:
  //   - a root frame disappeared (missingRoots), or
  //   - the target's node count differs from plan time (structure edited), or
  //   - we committed MORE bindings than were planned (nodes/values added since review).
  var nodeCountChanged = walkTotal !== lastPlanWalkTotal;
  var appliedExceedsPlan = appliedBindings > lastPlanCount;
  var selectionChanged = missingRoots > 0 || nodeCountChanged || appliedExceedsPlan;

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
  lastCategoryScores = categoryScores;

  trackEvent("plugin_run", currentTier, {
    healthScore: healthScore,
    nodesScanned: results.targetNodesScanned,
    totalRebound: totalRebound,
    skippedNodes: results.skippedNodes,
    bindingTypes: {
      fills: results.fillsRebound,
      strokes: results.strokesRebound,
      spacing: results.spacingRebound,
      radius: results.radiusRebound,
      effects: results.effectFieldsRebound,
      typography: results.typoVarsRebound + results.textStylesRebound,
    },
  });

  // Reset plan state — this plan has been consumed.
  lastPlanOpts = null;
  lastPlanSelectionIds = [];

  figma.ui.postMessage({
    type: "done",
    results: results,
    tier: currentTier,
    healthScore: healthScore,
    categoryScores: categoryScores,
    applied: appliedBindings,
    planned: lastPlanCount,
    skippedFromPlan: skippedFromPlan,
    selectionChanged: selectionChanged,
    skippedNodes: results.skippedNodes,
    skippedPaints: results.skippedPaints,
  });
}
