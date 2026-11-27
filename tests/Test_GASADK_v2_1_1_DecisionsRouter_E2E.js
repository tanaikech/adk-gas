/**
 * Test_GASADK_v2_1_1_DecisionsRouter_E2E.js
 *
 * Single-function live Google Apps Script (GAS) E2E test suite for GASADK v2.1.1
 * (Gemini Decisions API Dynamic 6-Model & Thinking Router).
 *
 * How to run:
 * 1. Add GASADK library (v2.1.1 / developmentMode: true) to your GAS project
 *    (or paste dist/GASADK.js directly).
 * 2. Set Script Property "GEMINI_API_KEY" in Project Settings -> Script Properties.
 * 3. Paste this file into your GAS project, select `runAllGasadkV211RoutingTests`,
 *    and click Run.
 * 4. Copy the entire Execution Log (including the final JSON summary) and share it
 *    for strict diagnostic analysis.
 *
 * Safety guarantees:
 * - Zero writes to existing Google Drive files or Gmail.
 * - Soft wall-clock deadline (270s) to stay safely under GAS's 6-minute hard limit.
 * - Guaranteed `finally` cleanup (restores default modelRouting registry).
 */

function runAllGasadkV211RoutingTests() {
  const SOFT_DEADLINE_MS = 270000;
  const suiteStartMs = Date.now();
  const LlmAgentCls = typeof GASADK !== "undefined" && GASADK.LlmAgent ? GASADK.LlmAgent : LlmAgent;
  const RouterCls =
    typeof GASADK !== "undefined" && GASADK.GeminiDecisionsRouter
      ? GASADK.GeminiDecisionsRouter
      : typeof GeminiDecisionsRouter !== "undefined"
        ? GeminiDecisionsRouter
        : null;

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("GEMINI_API_KEY");
  const lock = LockService.getScriptLock();

  if (!apiKey) {
    throw new Error("Missing Script Property 'GEMINI_API_KEY'. Please set it before running tests.");
  }

  const report = {
    suite: "GASADK_v2_1_1_DecisionsRouter_E2E",
    timestamp: new Date().toISOString(),
    routerClassVisible: Boolean(RouterCls),
    routerVersion: RouterCls ? RouterCls.VERSION : "via_LlmAgent_only",
    passed: 0,
    failed: 0,
    skipped: 0,
    totalDurationMs: 0,
    tests: [],
  };

  function checkTimeBudget(label) {
    const elapsed = Date.now() - suiteStartMs;
    if (elapsed >= SOFT_DEADLINE_MS) {
      throw new Error(`SOFT_DEADLINE_EXCEEDED at ${label} (${elapsed}ms >= ${SOFT_DEADLINE_MS}ms)`);
    }
  }

  function runTest(id, name, fn) {
    const t0 = Date.now();
    console.log(`\n============================================================`);
    console.log(`[START] ${id}: ${name}`);
    console.log(`============================================================`);
    const entry = {
      id,
      name,
      status: "PASS",
      durationMs: 0,
      details: null,
      error: null,
      stack: null,
    };
    try {
      checkTimeBudget(id);
      const details = fn();
      entry.details = details || {};
      if (details && details._skipped) {
        entry.status = "SKIP";
        report.skipped++;
        console.log(`[SKIP] ${id}: ${details.reason || "Skipped"}`);
      } else {
        report.passed++;
        console.log(`[PASS] ${id} (${Date.now() - t0}ms)`);
      }
    } catch (err) {
      entry.status = "FAIL";
      entry.error = err && err.message ? err.message : String(err);
      entry.stack = err && err.stack ? String(err.stack).slice(0, 1200) : null;
      report.failed++;
      console.error(`[FAIL] ${id} (${Date.now() - t0}ms): ${entry.error}`);
      if (entry.stack) console.error(entry.stack);
    } finally {
      entry.durationMs = Date.now() - t0;
      report.tests.push(entry);
    }
  }

  try {
    // ------------------------------------------------------------------
    // T01: JSON Config Export & Zero-Secret Verification (0 API calls)
    // ------------------------------------------------------------------
    runTest("T01", "getModelRoutingConfig() JSON Export & Zero-Secret Check", () => {
      const agent = new LlmAgentCls({
        apiKey,
        name: "T01_ConfigAgent",
      }).setServices({ lock, properties: props });

      const cfg = agent.getModelRoutingConfig();
      const jsonStr = JSON.stringify(cfg);

      if (jsonStr.includes(apiKey)) {
        throw new Error("SECURITY FAILURE: apiKey leaked into getModelRoutingConfig() JSON!");
      }
      if (cfg.activeMode !== "efficient") {
        throw new Error(`Expected default activeMode='efficient', got '${cfg.activeMode}'`);
      }
      const models = Object.keys(cfg.modelCatalog || {});
      if (models.length < 6) {
        throw new Error(`Expected >= 6 models in modelCatalog, got ${models.length}`);
      }
      if (!cfg.modeComparison || !cfg.modeComparison.fixed || !cfg.modeComparison.efficient || !cfg.modeComparison.quality) {
        throw new Error("Missing fixed/efficient/quality in modeComparison.");
      }

      console.log("[T01] Model Pool:", JSON.stringify(cfg.modelPool));
      console.log("[T01] Mode Comparison (trivial.default):", JSON.stringify({
        fixed: cfg.modeComparison.fixed,
        efficient: cfg.modeComparison.efficient.routes.trivial.default,
        quality: cfg.modeComparison.quality.routes.trivial.default,
      }));
      console.log("[T01] Mode Comparison (max_capability_override.synthesizer):", JSON.stringify({
        efficient: cfg.modeComparison.efficient.routes.max_capability_override.synthesizer,
        quality: cfg.modeComparison.quality.routes.max_capability_override.synthesizer,
      }));
      console.log("[T01] Warnings:", JSON.stringify(cfg.warnings));

      return {
        version: cfg.version,
        activeMode: cfg.activeMode,
        billingTier: cfg.billingTier,
        modelCount: models.length,
        warnings: cfg.warnings,
      };
    });

    // ------------------------------------------------------------------
    // T02: External Future-Model Customization & Reset Round-Trip
    // ------------------------------------------------------------------
    runTest("T02", "External Future-Model Customization & Reset Round-Trip", () => {
      LlmAgentCls.configureModelRouting({
        modelCatalog: {
          "models/gemini-5-future-test": {
            tier: "frontierMax",
            supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
            defaultThinkingLevel: "HIGH",
            supportsThinkingBudget: false,
            paidOnly: true,
          },
        },
        modelPool: { frontierMax: "models/gemini-5-future-test" },
      });

      const presetsAfter = LlmAgentCls.getModelRoutingPresets();
      const customFrontier =
        presetsAfter.modeComparison.quality.routes.frontier.synthesizer.model;
      if (customFrontier !== "models/gemini-5-future-test") {
        throw new Error(`Expected custom frontierMax model, got '${customFrontier}'`);
      }

      LlmAgentCls.resetModelRoutingDefaults();
      const presetsReset = LlmAgentCls.getModelRoutingPresets();
      const restoredFrontier =
        presetsReset.modeComparison.quality.routes.frontier.synthesizer.model;
      if (restoredFrontier !== "models/gemini-4-carbon") {
        throw new Error(`Expected restored 'models/gemini-4-carbon', got '${restoredFrontier}'`);
      }

      console.log(`[T02] Custom='${customFrontier}' -> Restored='${restoredFrontier}'`);
      return { customFrontier, restoredFrontier };
    });

    // ------------------------------------------------------------------
    // T03: Live previewModelRouting() Side-by-Side Comparison (Decisions API only)
    // ------------------------------------------------------------------
    runTest("T03", "Live previewModelRouting() (Trivial vs Max-Capability Prompts)", () => {
      const agent = new LlmAgentCls({
        apiKey,
        name: "T03_PreviewAgent",
      }).setServices({ lock, properties: props });

      const pTrivial = agent.previewModelRouting("Say hello in 5 words.", { role: "direct", hasTools: false });
      const pMaxCap = agent.previewModelRouting(
        "Use maximum capability and think as deeply as possible to design a fault-tolerant distributed consensus algorithm.",
        { role: "synthesizer", hasTools: false },
      );

      console.log("[T03] Trivial Preview:", JSON.stringify(pTrivial.comparison, null, 2));
      console.log("[T03] MaxCap Preview:", JSON.stringify(pMaxCap.comparison, null, 2));

      if (pTrivial.comparison.efficient.fallbackReason) {
        throw new Error(`Decisions API failed on trivial preview: ${pTrivial.comparison.efficient.fallbackReason}`);
      }
      if (!pMaxCap.comparison.efficient.maxCapabilityOverride) {
        throw new Error(
          `Expected maxCapabilityOverride=true on explicit max-capability prompt, got: ${JSON.stringify(pMaxCap.comparison.efficient)}`,
        );
      }

      return {
        trivial: {
          fixed: `${pTrivial.comparison.fixed.model} (${pTrivial.comparison.fixed.thinkingLevel})`,
          efficient: `${pTrivial.comparison.efficient.model} (${pTrivial.comparison.efficient.thinkingLevel}, ${pTrivial.comparison.efficient.decisionsLatencyMs}ms)`,
          quality: `${pTrivial.comparison.quality.model} (${pTrivial.comparison.quality.thinkingLevel})`,
        },
        maxCap: {
          maxCapabilityOverride: pMaxCap.comparison.efficient.maxCapabilityOverride,
          efficient: `${pMaxCap.comparison.efficient.model} (${pMaxCap.comparison.efficient.thinkingLevel}, ${pMaxCap.comparison.efficient.decisionsLatencyMs}ms)`,
          quality: `${pMaxCap.comparison.quality.model} (${pMaxCap.comparison.quality.thinkingLevel})`,
        },
      };
    });

    // ------------------------------------------------------------------
    // T04: Fixed Mode Live Execution (0 Decisions API calls)
    // ------------------------------------------------------------------
    runTest("T04", "Fixed Mode Execution (models/gemini-3.8-flash, 0 Decisions Calls)", () => {
      const routingLogs = [];
      const agent = new LlmAgentCls({
        apiKey,
        name: "T04_FixedAgent",
        model: "models/gemini-3.8-flash",
        modelRouting: "fixed",
        instruction: "Reply concisely.",
      }).setServices({ lock, properties: props });

      const t0 = Date.now();
      const answer = agent.run("What is the capital of Japan? Reply in one word.", (logEntry) => {
        console.log(`[T04 Log] ${logEntry.message}`);
        if (logEntry.message.includes("[ModelRouting]")) routingLogs.push(logEntry.message);
      });
      const elapsedMs = Date.now() - t0;
      const hist = agent.getRoutingHistory();

      if (!hist.length || hist.some((h) => h.mode !== "fixed" || h.decisionsInputTokens !== 0)) {
        throw new Error(`Expected fixed mode with 0 decisions tokens, got: ${JSON.stringify(hist)}`);
      }
      if (!routingLogs.length) {
        throw new Error("Expected [ModelRouting] log line in logCallback.");
      }

      console.log(`[T04] Answer: ${String(answer).slice(0, 200)}`);
      return {
        elapsedMs,
        answerPreview: String(answer).slice(0, 150),
        accumulatedTokens: agent.accumulatedTokens,
        llmCallCount: agent.llmCallCount,
        routingHistory: hist,
      };
    });

    // ------------------------------------------------------------------
    // T05: Efficient Mode (Default) vs Fixed Hydrogen Live Benchmark (Trivial Prompt)
    // ------------------------------------------------------------------
    runTest("T05", "Efficient Mode (Default) vs Fixed gemini-4-hydrogen Live Comparison", () => {
      const prompt = "What is 17 * 23? Answer with the number and one short sentence.";

      const effAgent = new LlmAgentCls({
        apiKey,
        name: "T05_EfficientAgent",
        // modelRouting omitted -> defaults to "efficient"
      }).setServices({ lock, properties: props });

      const tEff0 = Date.now();
      const effAns = effAgent.run(prompt, (e) => {
        if (e.message.includes("[ModelRouting]")) console.log(`[T05 Efficient] ${e.message}`);
      });
      const effMs = Date.now() - tEff0;

      const fixAgent = new LlmAgentCls({
        apiKey,
        name: "T05_FixedHydrogenAgent",
        model: "models/gemini-4-hydrogen",
        modelRouting: "fixed",
      }).setServices({ lock, properties: props });

      const tFix0 = Date.now();
      const fixAns = fixAgent.run(prompt, (e) => {
        if (e.message.includes("[ModelRouting]")) console.log(`[T05 Fixed] ${e.message}`);
      });
      const fixMs = Date.now() - tFix0;

      const speedup = effMs > 0 ? Number((fixMs / effMs).toFixed(2)) : null;
      console.log(`[T05] Efficient: ${effMs}ms (${effAgent.accumulatedTokens} tok) vs Fixed: ${fixMs}ms (${fixAgent.accumulatedTokens} tok) | Speedup=${speedup}x`);

      return {
        efficient: {
          ms: effMs,
          tokens: effAgent.accumulatedTokens,
          calls: effAgent.llmCallCount,
          answerPreview: String(effAns).slice(0, 150),
          routingHistory: effAgent.getRoutingHistory(),
        },
        fixedHydrogen: {
          ms: fixMs,
          tokens: fixAgent.accumulatedTokens,
          calls: fixAgent.llmCallCount,
          answerPreview: String(fixAns).slice(0, 150),
          routingHistory: fixAgent.getRoutingHistory(),
        },
        speedupRatio: speedup,
      };
    });

    // ------------------------------------------------------------------
    // T06: Efficient Mode + Explicit Japanese Max-Capability Directive + billingTier: "auto"
    // ------------------------------------------------------------------
    runTest("T06", "Explicit Max-Capability Escalation & Paid/Free Auto-Fallback", () => {
      const prompt =
        "最大の能力で最も深く考えて、Google Apps Scriptの6分実行制限を安全に回避するための設計原則を3点だけ簡潔に挙げてください。";

      const agent = new LlmAgentCls({
        apiKey,
        name: "T06_MaxCapAgent",
        modelRouting: { mode: "efficient", billingTier: "auto" },
      }).setServices({ lock, properties: props });

      const t0 = Date.now();
      const answer = agent.run(prompt, (e) => {
        if (e.message.includes("[ModelRouting]")) console.log(`[T06] ${e.message}`);
      });
      const elapsedMs = Date.now() - t0;
      const hist = agent.getRoutingHistory();

      const escalated = hist.some((h) => h.maxCapabilityOverride === true);
      if (!escalated) {
        throw new Error(`Expected maxCapabilityOverride=true in routingHistory: ${JSON.stringify(hist)}`);
      }
      if (!answer || String(answer).trim().length < 20) {
        throw new Error("Expected non-empty substantial answer from escalated model.");
      }

      console.log(`[T06] Answer preview: ${String(answer).slice(0, 220)}`);
      return {
        elapsedMs,
        accumulatedTokens: agent.accumulatedTokens,
        llmCallCount: agent.llmCallCount,
        routingHistory: hist,
        answerPreview: String(answer).slice(0, 220),
      };
    });

    // ------------------------------------------------------------------
    // T07: Quality Mode + Native Tool Calling (Role-Aware Routing & Zero HTTP 400)
    // ------------------------------------------------------------------
    runTest("T07", "Quality Mode + Native Tool Execution (Zero HTTP 400 Check)", () => {
      let toolInvoked = false;
      const agent = new LlmAgentCls({
        apiKey,
        name: "T07_QualityToolAgent",
        modelRouting: { mode: "quality", billingTier: "auto" },
        executionMode: "direct",
        tools: [
          {
            name: "get_gas_quota_status",
            description: "Returns current simulated GAS execution quota telemetry.",
            parameters: {
              type: "object",
              properties: {
                service: { type: "string", description: "Service name e.g. UrlFetch" },
              },
              required: ["service"],
            },
            function: (args) => {
              toolInvoked = true;
              return JSON.stringify({
                service: args.service || "UrlFetch",
                remainingDailyCalls: 19850,
                status: "HEALTHY",
              });
            },
          },
        ],
      }).setServices({ lock, properties: props });

      const t0 = Date.now();
      const answer = agent.run("Check the UrlFetch quota status using the tool and summarize it.", (e) => {
        if (e.message.includes("[ModelRouting]")) console.log(`[T07] ${e.message}`);
      });
      const elapsedMs = Date.now() - t0;

      if (!toolInvoked) {
        throw new Error("Native tool 'get_gas_quota_status' was not invoked.");
      }
      console.log(`[T07] Answer preview: ${String(answer).slice(0, 220)}`);
      return {
        elapsedMs,
        toolInvoked,
        accumulatedTokens: agent.accumulatedTokens,
        llmCallCount: agent.llmCallCount,
        routingHistory: agent.getRoutingHistory(),
        answerPreview: String(answer).slice(0, 220),
      };
    });

    // ------------------------------------------------------------------
    // T08: SubAgent Routing Inheritance & History Aggregation
    // ------------------------------------------------------------------
    runTest("T08", "SubAgent Routing Inheritance & Child History Aggregation", () => {
      const childAgent = new LlmAgentCls({
        apiKey,
        name: "MathSpecialistSubAgent",
        description: "Solves arithmetic and unit conversions.",
        instruction: "Solve the math problem concisely.",
      }).setServices({ lock, properties: props });

      const parentAgent = new LlmAgentCls({
        apiKey,
        name: "T08_ParentOrchestrator",
        modelRouting: "efficient",
        subAgents: [childAgent],
      }).setServices({ lock, properties: props });

      const t0 = Date.now();
      const answer = parentAgent.run(
        "Delegate to MathSpecialistSubAgent to compute 256 * 128 and report the result.",
        (e) => {
          if (e.message.includes("[ModelRouting]")) console.log(`[T08] ${e.message}`);
        },
      );
      const elapsedMs = Date.now() - t0;
      const hist = parentAgent.getRoutingHistory();

      console.log(`[T08] Total routing events (parent + child): ${hist.length}`);
      console.log(`[T08] Answer preview: ${String(answer).slice(0, 220)}`);
      return {
        elapsedMs,
        accumulatedTokens: parentAgent.accumulatedTokens,
        routingEventsCount: hist.length,
        routingHistory: hist,
        answerPreview: String(answer).slice(0, 220),
      };
    });
  } finally {
    // Guaranteed cleanup of any global routing customization
    try {
      LlmAgentCls.resetModelRoutingDefaults();
    } catch (_) {}
    report.totalDurationMs = Date.now() - suiteStartMs;
    console.log("\n=== GASADK v2.1.1 E2E SUMMARY (COMPACT, NO TRUNCATION) ===");
    console.log(
      JSON.stringify({
        suite: report.suite,
        routerVersion: report.routerVersion,
        passed: report.passed,
        failed: report.failed,
        skipped: report.skipped,
        totalDurationMs: report.totalDurationMs,
        summary: report.tests.map((t) => ({
          id: t.id,
          status: t.status,
          ms: t.durationMs,
          error: t.error,
          models:
            t.details && Array.isArray(t.details.routingHistory)
              ? t.details.routingHistory.map(
                  (h) => `${h.agent || ""}:${h.role}->${h.model}(${h.thinkingLevel},${h.decisionsLatencyMs}ms)`,
                )
              : undefined,
        })),
      }),
    );
    console.log("==========================================================");
  }
}
