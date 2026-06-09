/**
 * Headless harness for Token Rebinder's compiled code.js.
 *
 * Mocks the Figma plugin API, loads the REAL code.js per scenario (fresh module
 * state each time), and drives flows to observe runtime behavior without Figma.
 *
 * Run: node test/harness.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const CODE = fs.readFileSync(path.join(__dirname, "..", "code.js"), "utf8");
const FIGMA_MIXED = { __figmaMixed: true };

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
function mkVar(id, name) {
  return { id, name, resolvedType: "COLOR", variableCollectionId: "c1", valuesByMode: { m1: hexToRgb("0f3549") }, scopes: [] };
}

/** Build a fresh mocked Figma env + load code.js into it. */
function buildEnv() {
  const VARS = { v1: mkVar("v1", "Surface/Brand/bold"), v2: mkVar("v2", "Buttons/Map/Markers/Fill") };
  const counters = { setterCalls: 0, targetFillWrites: 0 };

  function peer(id, varId) {
    return { id, type: "RECTANGLE", fills: [{ type: "SOLID", color: hexToRgb("0f3549") }], strokes: [], boundVariables: { fills: [{ id: varId }] } };
  }
  const peers = [];
  for (let i = 0; i < 31; i++) peers.push(peer("a" + i, "v1"));
  for (let i = 0; i < 2; i++) peers.push(peer("b" + i, "v2"));

  const target = { id: "t1", type: "FRAME", name: "Pushed", strokes: [], boundVariables: {}, children: [] };
  let _fills = [{ type: "SOLID", color: hexToRgb("0f3549") }];
  Object.defineProperty(target, "fills", {
    get() { return _fills; }, set(v) { counters.targetFillWrites++; _fills = v; }, enumerable: true, configurable: true,
  });
  target._getBoundId = () => _fills[0] && _fills[0].boundVariables && _fills[0].boundVariables.color && _fills[0].boundVariables.color.id;

  const allNodes = {}; peers.forEach(n => allNodes[n.id] = n); allNodes[target.id] = target;
  const outbox = [];

  const figma = {
    mixed: FIGMA_MIXED, fileKey: "FK", currentUser: { id: "u1" },
    currentPage: { children: peers.concat([target]), selection: [target] },
    showUI() {},
    ui: {
      postMessage(m) {
        outbox.push(m);
        // Simulate the iframe replying to the cooperative-yield round-trip.
        if (m && m.type === "__yield") {
          setTimeout(function() { if (figma.ui.onmessage) figma.ui.onmessage({ type: "__yield-ack" }); }, 0);
        }
      },
      onmessage: null,
    },
    openExternal() {}, closePlugin() {},
    clientStorage: { getAsync: async () => undefined, setAsync: async () => {} },
    loadFontAsync: async () => {},
    getNodeByIdAsync: async (id) => allNodes[id] || null,
    getStyleByIdAsync: async () => null,
    variables: {
      getVariableByIdAsync: async (id) => VARS[id] || null,
      getLocalVariablesAsync: async () => [],
      getVariableCollectionByIdAsync: async () => ({ id: "c1", modes: [{ modeId: "m1" }] }),
      setBoundVariableForPaint(paint, field, v) { counters.setterCalls++; const np = Object.assign({}, paint); np.boundVariables = {}; np.boundVariables[field] = { type: "VARIABLE_ALIAS", id: v.id }; return np; },
      setBoundVariableForEffect(e) { counters.setterCalls++; return e; },
      setBoundVariableForLayoutGrid(g) { counters.setterCalls++; return g; },
    },
  };

  const factory = new Function("figma", "__html__", "console", "setTimeout", "fetch", CODE);
  factory(figma, "", console, setTimeout, async () => ({ ok: false, json: async () => ({}) }));
  return { figma, outbox, counters, target };
}

const ALL_OPTS = { colors: true, spacing: true, radius: true, effects: true, dimensions: true, typography: true, layout: true, misc: true };
let failures = 0;
function check(cond, msg) { if (cond) console.log("  ✅ " + msg); else { console.error("  ❌ " + msg); failures++; } }

(async () => {
  // ── Scenario 1: Plan → Commit (majority-vote, zero-mutation, parity) ──
  console.log("Scenario 1 — Plan → review → commit");
  {
    const env = buildEnv();
    await env.figma.ui.onmessage({ type: "run-plan", options: ALL_OPTS, autoApply: false });
    const phases = new Set(env.outbox.filter(m => m.type === "progress").map(m => m.phase));
    const rows = env.outbox.filter(m => m.type === "plan-batch").reduce((a, b) => a.concat(b.rows), []);
    const colorRow = rows.find(r => r.tab === "colors" && r.swatch);
    const planComplete = env.outbox.find(m => m.type === "plan-complete");

    check(env.counters.setterCalls === 0 && env.counters.targetFillWrites === 0, "Zero mutation during plan");
    check(phases.has(1) && phases.has(4), "Progress streamed across phases [" + [...phases].sort().join(",") + "]");
    check(colorRow && colorRow.toVariableName === "Surface/Brand/bold" && colorRow.seenCount === 31 && colorRow.provenance === "learned",
      "Majority-vote: 0F3549 → Surface/Brand/bold, Learned ×31 (beat Buttons/Map/Markers ×2)");
    check(planComplete && planComplete.total === 1, "plan-complete gate releases (Apply " + (planComplete && planComplete.total) + ")");

    const before = env.counters.setterCalls;
    await env.figma.ui.onmessage({ type: "commit" });
    const done = env.outbox.find(m => m.type === "done");
    check(env.counters.setterCalls > before && env.counters.targetFillWrites > 0, "Commit mutates");
    check(done && done.results.fillsRebound === 1, "Parity: fillsRebound = 1");
    check(env.target._getBoundId() === "v1", "Bound to v1 (Surface/Brand), not the map-marker token");
  }

  // ── Scenario 2: Cancel safety — after cancel, commit must not mutate ──
  console.log("Scenario 2 — Cancel safety");
  {
    const env = buildEnv();
    await env.figma.ui.onmessage({ type: "run-plan", options: ALL_OPTS, autoApply: false });
    await env.figma.ui.onmessage({ type: "cancel" });
    const mutBefore = env.counters.setterCalls;
    await env.figma.ui.onmessage({ type: "commit" });
    const err = env.outbox.filter(m => m.type === "error").pop();
    check(env.counters.setterCalls === mutBefore, "No mutation after cancel→commit");
    check(!!err, "Commit-after-cancel returns a clear error");
    check(!env.outbox.find(m => m.type === "done"), "No spurious 'done' after cancel");
  }

  // ── Scenario 3: Auto-apply — single run mutates and reports done, no separate commit ──
  console.log("Scenario 3 — Auto-apply (skip review)");
  {
    const env = buildEnv();
    await env.figma.ui.onmessage({ type: "run-plan", options: ALL_OPTS, autoApply: true });
    const done = env.outbox.find(m => m.type === "done");
    check(env.counters.setterCalls > 0 && env.counters.targetFillWrites > 0, "Auto-apply mutated in one run");
    check(done && done.results.fillsRebound === 1, "Auto-apply done totals correct");
    check(env.target._getBoundId() === "v1", "Auto-apply bound correct variable");
    check(!env.outbox.find(m => m.type === "plan-complete"), "Auto-apply emits NO plan-complete (no mid-commit Apply flash)");
  }

  console.log(failures ? ("\n⛔ " + failures + " check(s) failed.") : "\n🎉 All runtime checks passed against the real code.js.");
  if (failures) process.exitCode = 1;
})();
