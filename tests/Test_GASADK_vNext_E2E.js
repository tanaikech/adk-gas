/**
 * ============================================================================
 * GASADK vNext (Gemini 4 Hydrogen Edition) Single-Function E2E Test Suite
 * ============================================================================
 * Usage:
 *   1. Ensure Script Property `GEMINI_API_KEY` is set.
 *   2. Run `runAllGasadkVNextTests()` in Google Apps Script Editor.
 *   3. Copy & paste the full execution log for rigorous analysis.
 *
 * Safety Guarantees:
 *   - Never writes to or modifies any pre-existing user Google Drive files.
 *   - T04 (Google Drive MCP) executes strictly read-only `list_recent_files`.
 *   - All temporary Google Drive folders/files, PropertiesService keys, and
 *     CacheService keys created during testing are registered immediately and
 *     deleted inside `finally` (with a 270s soft time-budget guard so `finally`
 *     always executes well before GAS's 360s hard timeout).
 */

/**
 * Resolves GASADK classes safely whether running inside the GASADK library
 * project itself or in a consumer GAS project importing `GASADK` as a library.
 * Avoids V8 TDZ ReferenceError.
 * @private
 */
function resolveGasadkClasses_() {
  const lib = typeof GASADK !== "undefined" ? GASADK : null;
  const g = typeof globalThis !== "undefined" ? globalThis : this;
  return {
    LlmAgent: (lib && lib.LlmAgent) || g.LlmAgent,
    GeminiWithFiles: (lib && lib.GeminiWithFiles) || g.GeminiWithFiles,
    MCPApp: (lib && lib.MCPApp) || g.MCPApp,
    A2AApp: (lib && lib.A2AApp) || g.A2AApp,
    MCPA2Aserver: (lib && lib.MCPA2Aserver) || g.MCPA2Aserver,
    FileSearch: (lib && lib.FileSearch) || g.FileSearch,
    GasHookManager: (lib && lib.GasHookManager) || g.GasHookManager,
  };
}

/**
 * Single entry-point function executing ALL GASADK vNext E2E & regression tests.
 *
 * @param {Object} [options={}] Optional overrides:
 *   - apiKey {string}: Override GEMINI_API_KEY Script Property
 *   - skipDriveMcp {boolean}: Skip T04 live Google Drive MCP test (default: false)
 *   - workspaceMcpMode {"v1"|"v1self"}: Drive MCP endpoint mode (default: "v1")
 * @returns {Object} Structured summary report
 */
function runAllGasadkVNextTests(options = {}) {
  const suiteStartTime = Date.now();
  const MAX_SUITE_MS = 270000; // 4m30s soft budget -> ~90s headroom for finally cleanup
  const runId = Utilities.getUuid().slice(0, 8);
  const tmpPrefix = `GASADK_E2E_TMP_${runId}_`;

  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  const apiKey = options.apiKey || props.getProperty("GEMINI_API_KEY");

  const cls = resolveGasadkClasses_();
  const results = [];
  const cleanupRegistry = {
    driveFolderIds: [],
    driveFileIds: [],
    propertyKeys: [],
    cacheKeys: [],
    stateSessionIds: [],
  };

  const logLine = (msg) => console.log(`[GASADK_E2E ${new Date().toISOString()}] ${msg}`);

  const recordTest = (id, title, fn) => {
    const elapsed = Date.now() - suiteStartTime;
    if (elapsed > MAX_SUITE_MS) {
      const skipped = {
        id,
        title,
        status: "SKIPPED_TIME_BUDGET",
        duration_ms: 0,
        detail: `Suite elapsed ${elapsed}ms > ${MAX_SUITE_MS}ms soft budget`,
      };
      results.push(skipped);
      logLine(`[SKIP] ${id}: ${title} (${skipped.detail})`);
      return;
    }

    logLine(`--- [TEST START] ${id}: ${title} ---`);
    const t0 = Date.now();
    try {
      const meta = fn() || {};
      const durationMs = Date.now() - t0;
      const entry = {
        id,
        title,
        status: meta._skipped ? "SKIPPED" : "PASS",
        duration_ms: durationMs,
        metrics: meta,
      };
      results.push(entry);
      logLine(
        `[${entry.status}] ${id}: ${title} | duration_ms=${durationMs} | metrics=${JSON.stringify(meta)}`,
      );
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errMsg = err?.message || String(err);
      const entry = {
        id,
        title,
        status: "FAIL",
        duration_ms: durationMs,
        error: errMsg,
        stack: err?.stack ? String(err.stack).slice(0, 500) : "",
      };
      results.push(entry);
      logLine(`[FAIL] ${id}: ${title} | duration_ms=${durationMs} | error=${errMsg}`);
    }
  };

  const assertEq = (actual, expected, msg) => {
    if (actual !== expected) {
      throw new Error(`${msg} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`);
    }
  };

  const assertTrue = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  logLine(`========== GASADK vNext E2E SUITE START (runId=${runId}) ==========`);
  if (!apiKey) {
    throw new Error("CRITICAL: GEMINI_API_KEY is not set in Script Properties or options.apiKey.");
  }

  try {
    // ------------------------------------------------------------------------
    // T01: Default Model Verification across all 6 classes
    // ------------------------------------------------------------------------
    recordTest("T01", "Default Model = models/gemini-4-hydrogen (All 6 Classes)", () => {
      const expected = "models/gemini-4-hydrogen";
      const a = new cls.LlmAgent({ apiKey });
      const g = new cls.GeminiWithFiles({ apiKey });
      const m = new cls.MCPApp();
      const a2a = new cls.A2AApp();
      const srv = new cls.MCPA2Aserver();
      const fsApp = new cls.FileSearch({ apiKey });

      assertEq(a.model, expected, "LlmAgent default model mismatch");
      assertEq(g.model, expected, "GeminiWithFiles default model mismatch");
      assertEq(m.model, expected, "MCPApp default model mismatch");
      assertEq(a2a.model, expected, "A2AApp default model mismatch");
      assertEq(srv.model, expected, "MCPA2Aserver default model mismatch");
      assertEq(fsApp.model, expected, "FileSearch default model mismatch");
      return { defaultModel: expected, checkedClasses: 6 };
    });

    // ------------------------------------------------------------------------
    // T02: Gemini 4 Hydrogen Direct Call, thinkingConfig Guard & !p.thought Filter
    // ------------------------------------------------------------------------
    recordTest("T02", "Gemini 4 Hydrogen API + thinkingConfig Guard + Token Telemetry", () => {
      const gwf = new cls.GeminiWithFiles({
        apiKey,
        exportTotalTokens: true,
        generationConfig: {
          // Deliberately pass deprecated/400-prone params to verify Gemini 4 auto-guard
          thinkingConfig: { thinkingBudget: 0, thinkingLevel: "minimal" },
          frequencyPenalty: 0.2,
          presencePenalty: 0.1,
          candidateCount: 1,
        },
      });
      const res = gwf.generateContent({
        q: "Reply with exactly the string: HYDROGEN_OK",
      });
      assertTrue(res && typeof res === "object", "Expected exportTotalTokens wrapper object");
      assertTrue(
        String(res.returnValue).includes("HYDROGEN_OK"),
        `Unexpected response: ${res.returnValue}`,
      );
      return {
        returnValue: String(res.returnValue).slice(0, 80),
        inputTokens: res.inputTokenCount,
        outputTokens: res.outputTokenCount,
        totalTokens: res.totalTokenCount,
        llmCallCount: res.llmCallCount,
      };
    });

    // ------------------------------------------------------------------------
    // T03: Native Tool Single & Parallel Function Calling (thoughtSignature + fix)
    // ------------------------------------------------------------------------
    recordTest("T03", "Native Tools Parallel Function Calling (thoughtSignature & Non-Empty Return)", () => {
      const calls = [];
      const agent = new cls.LlmAgent({
        apiKey,
        name: "ParallelToolAgent",
        executionMode: "direct",
        timeoutMs: 60000,
        tools: [
          {
            name: "get_alpha_code",
            description: "Returns the fixed alpha verification code.",
            parameters: { type: "object", properties: {} },
            function: () => {
              calls.push("alpha");
              return { code: "ALPHA-771" };
            },
          },
          {
            name: "get_beta_code",
            description: "Returns the fixed beta verification code.",
            parameters: { type: "object", properties: {} },
            function: () => {
              calls.push("beta");
              return { code: "BETA-992" };
            },
          },
        ],
      }).setServices({ lock, properties: props });

      const answer = agent.run(
        "Call BOTH get_alpha_code and get_beta_code, and report both exact codes in your answer.",
      );
      assertTrue(typeof answer === "string" && answer.length > 0, "Answer must be non-empty string");
      assertTrue(calls.includes("alpha") && calls.includes("beta"), `Expected both tools called, got: ${JSON.stringify(calls)}`);
      assertTrue(answer.includes("ALPHA-771") && answer.includes("BETA-992"), `Missing codes in answer: ${answer}`);
      return {
        toolsCalled: calls,
        llmCallCount: agent.llmCallCount,
        accumulatedTokens: agent.accumulatedTokens,
        answerSnippet: answer.slice(0, 140),
      };
    });

    // ------------------------------------------------------------------------
    // T04: Google Drive MCP Server (Read-Only list_recent_files: Planner vs Direct)
    // ------------------------------------------------------------------------
    recordTest("T04", "Google Drive MCP Server Read-Only (Planner vs Direct Mode Benchmark)", () => {
      if (options.skipDriveMcp) {
        return { _skipped: true, reason: "skipDriveMcp=true" };
      }
      const mcpServers = cls.LlmAgent.createWorkspaceMcpServers(["drive"], {
        mode: options.workspaceMcpMode || "v1",
      });
      const prompt = "List the 3 most recent files from Google Drive (read-only). Return only their titles.";

      // 4a: Direct Mode (Single-Loop ReAct)
      const tDirect0 = Date.now();
      const directAgent = new cls.LlmAgent({
        apiKey,
        name: "DriveDirectAgent",
        executionMode: "direct",
        timeoutMs: 60000,
        mcpServers,
      }).setServices({ lock, properties: props });
      const directAnswer = directAgent.run(prompt, (entry) => {
        if (entry.message.includes("Error") || entry.message.includes("failed")) {
          logLine(`  [T04-direct log] ${entry.message}`);
        }
      });
      const directMs = Date.now() - tDirect0;

      // 4b: Planner Mode (Legacy-Compatible Default)
      const tPlan0 = Date.now();
      const plannerAgent = new cls.LlmAgent({
        apiKey,
        name: "DrivePlannerAgent",
        executionMode: "planner",
        timeoutMs: 60000,
        mcpServers,
      }).setServices({ lock, properties: props });
      const plannerAnswer = plannerAgent.run(prompt, (entry) => {
        if (entry.message.includes("Error") || entry.message.includes("failed")) {
          logLine(`  [T04-planner log] ${entry.message}`);
        }
      });
      const plannerMs = Date.now() - tPlan0;

      const mcpCap = directAgent.capabilities.find((c) => c.type === "MCP Server");
      const discoveredToolCount = mcpCap?.description?.tools?.length || 0;
      assertTrue(
        discoveredToolCount > 0,
        `Google Drive MCP discovered 0 tools (expected list_recent_files etc.). Check MCP-Protocol-Version/Accept/OAuth scopes.`,
      );

      assertTrue(typeof directAnswer === "string" && directAnswer.length > 0, "Direct mode returned empty answer");
      assertTrue(typeof plannerAnswer === "string" && plannerAnswer.length > 0, "Planner mode returned empty answer");

      return {
        discovered_tools: discoveredToolCount,
        direct_ms: directMs,
        direct_llm_calls: directAgent.llmCallCount,
        direct_tokens: directAgent.accumulatedTokens,
        planner_ms: plannerMs,
        planner_llm_calls: plannerAgent.llmCallCount,
        planner_tokens: plannerAgent.accumulatedTokens,
        speedup_ratio: plannerMs > 0 ? Number((plannerMs / Math.max(directMs, 1)).toFixed(2)) : 1,
      };
    });

    // ------------------------------------------------------------------------
    // T05: Retry Loop Termination (Zero Infinite Loop) & Raw Error Visibility
    // ------------------------------------------------------------------------
    recordTest("T05", "Retry Loop Exact Termination (2 Attempts) & Raw Error Log Visibility", () => {
      const agent = new cls.LlmAgent({
        apiKey,
        name: "RetryVerifyAgent",
        maxReplans: 0,
        timeoutMs: 30000,
      });
      let attempts = 0;
      agent._executeTask = () => {
        attempts++;
        throw new Error("SYNTHETIC_FAILURE_400_TEST");
      };
      agent._generateContent = () => "Synthesis saw SYNTHETIC_FAILURE_400_TEST";
      agent.currentPrompt = "Trigger controlled failure";
      agent.startTime = Date.now();
      agent.taskResults = [];
      agent.replanCount = 0;
      agent.capabilities = [{ id: "mcp_0", type: "MCP Server", name: "mock_mcp" }];
      agent.planQueue = [
        { task_id: 1, capability_id: "mcp_0", description: "fail", execution_prompt: "fail", depends_on: [] },
      ];

      const capturedLogs = [];
      agent._runRemainingQueueAndSynthesize((entry) => capturedLogs.push(entry.message));

      assertEq(attempts, 2, "Retry loop MUST execute exactly 2 times (initial + 1 retry)");
      assertTrue(
        capturedLogs.some((m) => m.includes("retrying") && m.includes("SYNTHETIC_FAILURE_400_TEST")),
        "Retry log message must expose raw error text",
      );
      assertTrue(
        capturedLogs.some((m) => m.includes("failed definitively") && m.includes("SYNTHETIC_FAILURE_400_TEST")),
        "Definitive failure log message must expose raw error text",
      );
      return { attempts, logsCaptured: capturedLogs.length };
    });

    // ------------------------------------------------------------------------
    // T06: Temporary Google Drive Folder + SKILL.md Discovery & Execution
    // ------------------------------------------------------------------------
    recordTest("T06", "Temp Google Drive Folder & Agent Skills (SKILL.md) Discovery", () => {
      const rootFolder = DriveApp.createFolder(`${tmpPrefix}SkillsRoot`);
      cleanupRegistry.driveFolderIds.push(rootFolder.getId());
      cleanupRegistry.cacheKeys.push(`agent_skills_${rootFolder.getId()}`);

      const subSkillFolder = rootFolder.createFolder(`${tmpPrefix}GreetingSkill`);
      cleanupRegistry.driveFolderIds.push(subSkillFolder.getId());

      const skillMd = [
        "---",
        "name: greeting_protocol",
        "description: Returns a standardized GASADK vNext greeting token.",
        "---",
        "When activated, always include the exact token `SKILL_VNEXT_4042` in your final response.",
      ].join("\n");
      const skillFile = subSkillFolder.createFile("SKILL.md", skillMd, MimeType.PLAIN_TEXT);
      cleanupRegistry.driveFileIds.push(skillFile.getId());

      const gwf = new cls.GeminiWithFiles({
        apiKey,
        skillFolderId: rootFolder.getId(),
        exportTotalTokens: true,
        generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } },
      });
      const res = gwf.generateContent({
        q: "Use the greeting_protocol skill and return the standardized greeting token.",
      });
      const text = String(res?.returnValue || res);
      assertTrue(text.includes("SKILL_VNEXT_4042"), `Skill token missing in output: ${text}`);
      return {
        tempFolderId: rootFolder.getId(),
        totalTokens: res?.totalTokenCount || 0,
        llmCallCount: res?.llmCallCount || 0,
      };
    });

    // ------------------------------------------------------------------------
    // T07: Chunked/Compressed HITL saveState / loadState / deleteState (>9KB)
    // ------------------------------------------------------------------------
    recordTest("T07", "Chunked/Compressed HITL State Persistence (>12KB UTF-8 Stress Test)", () => {
      const agent = new cls.LlmAgent({ apiKey, name: "ChunkStateAgent" }).setServices({
        lock,
        properties: props,
      });
      cleanupRegistry.stateSessionIds.push(agent.sessionId);

      // Build >12KB payload (mix of ASCII + Japanese multibyte UTF-8)
      const largePayload = "あいうえお_GASADK_CHUNK_TEST_".repeat(500);
      agent.currentPrompt = "Large state verification";
      agent.history = [{ role: "user", parts: [{ text: largePayload }] }];
      agent.taskResults = [{ task_id: 1, result: largePayload }];
      agent.saveState();

      const rawMeta = props.getProperty("HITL_STATE_" + agent.sessionId);
      assertTrue(Boolean(rawMeta), "Meta property must exist");
      const metaObj = JSON.parse(rawMeta);
      assertTrue(metaObj._chunked === true, "Expected _chunked=true for >8KB UTF-8 payload");

      const loaded = agent.loadState(agent.sessionId);
      assertEq(loaded.taskResults[0].result, largePayload, "Loaded chunked state payload mismatch");

      agent.deleteState(agent.sessionId);
      assertEq(props.getProperty("HITL_STATE_" + agent.sessionId), null, "Meta key must be deleted");
      assertEq(props.getProperty("HITL_STATE_" + agent.sessionId + "_0"), null, "Chunk 0 must be deleted");

      return {
        rawBytesApprox: Utilities.newBlob(largePayload).getBytes().length * 2,
        compressed: metaObj.compressed,
        chunks: metaObj.chunks,
      };
    });

    // ------------------------------------------------------------------------
    // T08: Pure Protocol Helpers (SSE, Schema Sanitizer, parseQueryParameters_)
    // ------------------------------------------------------------------------
    recordTest("T08", "Pure Protocol Helpers (SSE, Schema Sanitizer, Query Parser)", () => {
      const mcp = new cls.MCPApp();
      const gwf = new cls.GeminiWithFiles({ apiKey });

      // SSE decode
      const sseMock = {
        getContentText: () =>
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',
      };
      const parsedSse = mcp.parseJsonRpcResponse_(sseMock);
      assertEq(parsedSse?.result?.ok, true, "SSE JSON-RPC decode failed");

      // Schema sanitizer
      const sanitized = gwf._sanitizeToolParameters(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: ["integer", "null"], default: 5 },
          },
          required: [],
        },
        true,
      );
      assertEq(sanitized.$schema, undefined, "$schema not stripped");
      assertEq(sanitized.additionalProperties, undefined, "additionalProperties not stripped");
      assertEq(sanitized.required, undefined, "Empty required not stripped");
      assertEq(sanitized.properties.limit.nullable, true, "Nullable type union not converted");

      // Empty object root omission
      const emptySanitized = gwf._sanitizeToolParameters({ type: "object", properties: {} }, true);
      assertEq(emptySanitized, undefined, "Root empty object schema must return undefined");

      // Query parser edge cases
      const qp = mcp.parseQueryParameters_("https://example.com/mcp?flag&key=a=b&id=00123&msg=hello%20world");
      assertEq(qp.queryParameters.flag[0], "", "Valueless ?flag failed");
      assertEq(qp.queryParameters.key[0], "a=b", "Value with '=' truncated");
      assertEq(qp.queryParameters.id[0], "00123", "Leading zero stripped");
      assertEq(qp.queryParameters.msg[0], "hello world", "URL decode failed");

      const trailingQ = mcp.parseQueryParameters_("https://example.com/mcp?");
      assertEq(trailingQ.url, "https://example.com/mcp", "Trailing '?' failed");

      return { sse: "OK", sanitizer: "OK", queryParser: "OK" };
    });

    // ------------------------------------------------------------------------
    // T09: GasHookManager & Destructive MCP Tool Annotation Guard
    // ------------------------------------------------------------------------
    recordTest("T09", "GasHookManager Fast-Path + Lifecycle Hooks & ToolAnnotations Guard", () => {
      const emptyMgr = new cls.GasHookManager([]);
      const fastOut = emptyMgr.execute("Notification", { message: "fast" });
      assertEq(fastOut.message, "fast", "Empty GasHookManager fast-path failed");

      let hookTriggered = false;
      const mgr = new cls.GasHookManager([
        {
          event: "BeforeTool",
          name: "BlockDeleteHook",
          type: "function",
          handler: (inp) => {
            hookTriggered = true;
            if (inp.toolName === "delete_everything") {
              return { decision: "deny", reason: "Blocked by safety policy" };
            }
            return { decision: "allow" };
          },
        },
      ]);
      const denyRes = mgr.execute("BeforeTool", { toolName: "delete_everything" });
      assertTrue(hookTriggered && denyRes.decision === "deny", "BeforeTool deny hook failed");
      return { fastPath: "OK", denyDecision: denyRes.decision };
    });
  } finally {
    // ------------------------------------------------------------------------
    // T10: Guaranteed Cleanup of ALL Temporary Drive Files/Folders, Properties & Cache
    // ------------------------------------------------------------------------
    logLine("--- [CLEANUP START] T10: Deleting all temporary Drive & Storage artifacts ---");
    const cleanupReport = {
      filesTrashed: 0,
      foldersTrashed: 0,
      propertiesDeleted: 0,
      cachesRemoved: 0,
      errors: [],
    };

    cleanupRegistry.driveFileIds.forEach((fid) => {
      try {
        const f = DriveApp.getFileById(fid);
        f.setTrashed(true);
        if (f.isTrashed()) cleanupReport.filesTrashed++;
      } catch (e) {
        cleanupReport.errors.push(`file:${fid}:${e.message}`);
      }
    });

    // Trash child folders before parent folders
    cleanupRegistry.driveFolderIds.reverse().forEach((dirId) => {
      try {
        const d = DriveApp.getFolderById(dirId);
        d.setTrashed(true);
        if (d.isTrashed()) cleanupReport.foldersTrashed++;
      } catch (e) {
        cleanupReport.errors.push(`folder:${dirId}:${e.message}`);
      }
    });

    cleanupRegistry.stateSessionIds.forEach((sid) => {
      try {
        const tmpAgent = new cls.LlmAgent({ apiKey }).setServices({ lock, properties: props });
        tmpAgent.deleteState(sid);
        cleanupReport.propertiesDeleted++;
      } catch (e) {
        cleanupReport.errors.push(`state:${sid}:${e.message}`);
      }
    });

    cleanupRegistry.propertyKeys.forEach((k) => {
      try {
        props.deleteProperty(k);
        cleanupReport.propertiesDeleted++;
      } catch (e) {
        cleanupReport.errors.push(`prop:${k}:${e.message}`);
      }
    });

    cleanupRegistry.cacheKeys.forEach((ck) => {
      try {
        cache.remove(ck);
        cleanupReport.cachesRemoved++;
      } catch (e) {
        cleanupReport.errors.push(`cache:${ck}:${e.message}`);
      }
    });

    const t10Status = cleanupReport.errors.length === 0 ? "PASS" : "FAIL";
    results.push({
      id: "T10",
      title: "Guaranteed Cleanup Verification",
      status: t10Status,
      duration_ms: 0,
      metrics: cleanupReport,
    });
    logLine(`[${t10Status}] T10 Cleanup Report: ${JSON.stringify(cleanupReport)}`);
  }

  const totalMs = Date.now() - suiteStartTime;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status.startsWith("SKIPPED")).length;

  const summary = {
    runId,
    total_duration_ms: totalMs,
    passed,
    failed,
    skipped,
    results,
  };
  logLine(`========== [GASADK_E2E_SUMMARY] ==========\n${JSON.stringify(summary, null, 2)}`);
  return summary;
}
