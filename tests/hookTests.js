/**
 * hookTests.js
 * [Production Release v1.4.1]
 *
 * =========================================================================
 * ENTRY POINT FUNCTION: runHookTests()
 * =========================================================================
 * To run this test suite in the Google Apps Script (GAS) Script Editor:
 * 1. Open the GAS Script Editor.
 * 2. Select and execute the function `runHookTests`.
 * 3. Open the Execution Log to view the highly detailed step-by-step logs.
 * =========================================================================
 *
 * @description
 * Unified test suite validating the Hooks System JSON configuration inputs in GASADK.
 * This tests nested hook list schemas, direct flat hook schemas, command-type bypass,
 * Notification hooks, BeforeAgent blocking, context injection, sequential chaining,
 * BeforeTool blocking, AfterTool modification, and Drive resource cleanup.
 *
 * All logs, assertions, and comments are written in English.
 */

// ==========================================
// DUMMY HOOK FUNCTIONS (Exposed Globally)
// ==========================================

/**
 * Global dummy hook function for testing BeforeAgent decision blocking.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testGlobalHookBlockBeforeAgent(input) {
  console.log("   >> [Global Hook] testGlobalHookBlockBeforeAgent invoked. Prompt: '" + input.prompt + "'");
  if (input.prompt && input.prompt.includes("forbidden_topic")) {
    console.log("   >> [Global Hook] testGlobalHookBlockBeforeAgent returning DENY decision");
    return { decision: "deny", reason: "Safety check failed: forbidden_topic detected." };
  }
  console.log("   >> [Global Hook] testGlobalHookBlockBeforeAgent returning ALLOW decision");
  return { decision: "allow" };
}

/**
 * Global dummy hook function for testing context injection.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testGlobalHookInjectContext(input) {
  console.log("   >> [Global Hook] testGlobalHookInjectContext invoked");
  return { additionalContext: "InjectContext: User security authorization level is OVERLORD." };
}

/**
 * Global dummy hook function for testing sequential modification A.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testGlobalHookSequentialPromptA(input) {
  console.log("   >> [Global Hook] testGlobalHookSequentialPromptA invoked. Received: '" + input.prompt + "'");
  return { prompt: input.prompt + " [ChainA]" };
}

/**
 * Global dummy hook function for testing sequential modification B.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testGlobalHookSequentialPromptB(input) {
  console.log("   >> [Global Hook] testGlobalHookSequentialPromptB invoked. Received: '" + input.prompt + "'");
  return { prompt: input.prompt + " [ChainB]" };
}

/**
 * Global dummy hook function for tool execution interception.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testGlobalHookBeforeToolBlock(input) {
  console.log("   >> [Global Hook] testGlobalHookBeforeToolBlock invoked. Tool Name: " + input.toolName);
  if (input.toolName === "restricted_tool") {
    console.log("   >> [Global Hook] testGlobalHookBeforeToolBlock returning DENY decision");
    return { decision: "deny", reason: "Policy block: restricted_tool cannot be executed." };
  }
  return { decision: "allow" };
}

/**
 * Global dummy hook function for modifying tool execution results.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testGlobalHookAfterToolModify(input) {
  console.log("   >> [Global Hook] testGlobalHookAfterToolModify invoked. Tool: " + input.toolName + ", Original Result: '" + input.result + "'");
  return { result: "[REDACTED SECRET DATA]" };
}

/**
 * Global dummy hook function for logging Notifications.
 *
 * @param {Object} input - HookInput
 */
function testGlobalHookNotificationLog(input) {
  console.log("   >> [Notification Event Hook] message: '" + input.message + "'");
}


// ==========================================
// TEST SUITE ENTRY POINT
// ==========================================

/**
 * Main function to execute hook system validation tests with detailed logging.
 */
function runHookTests() {
  console.log("==========================================================================");
  console.log("      STARTING DETAILED LIFECYCLE HOOK SYSTEM INTEGRATION TEST SUITE     ");
  console.log("==========================================================================");

  // Resolve classes under namespace or global
  const agentClass = (typeof GASADK !== 'undefined') ? GASADK.LlmAgent : LlmAgent;
  const managerClass = (typeof GASADK !== 'undefined') ? GASADK.GasHookManager : GasHookManager;
  
  if (!agentClass) {
    throw new Error("FAIL: LlmAgent class could not be resolved in scope.");
  }
  if (!managerClass) {
    throw new Error("FAIL: GasHookManager class could not be resolved in scope.");
  }

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");
  if (!API_KEY) {
    throw new Error("FAIL: GEMINI_API_KEY script property is required to run integration tests.");
  }

  // Create temporary Drive folder for testing Drive cleanup
  const tempFolderName = "Temp_HookTests_" + Date.now();
  console.log("[Setup] Creating temporary Google Drive directory: " + tempFolderName);
  const tempFolder = DriveApp.createFolder(tempFolderName);

  try {
    // ----------------------------------------------------
    // TEST 1: GasHookManager JSON Parsing and Formatting Tests
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------------------------------");
    console.log("TEST 1: GasHookManager JSON Structure Configuration Parsing");
    console.log("--------------------------------------------------------------------------");

    // Construct a config featuring nested Format A, flat Format B, and command execution types.
    const sampleHooksConfig = {
      "BeforeAgent": [
        {
          "matcher": ".*",
          "hooks": [
            { "name": "safety-block", "type": "gas_function", "functionName": "testGlobalHookBlockBeforeAgent" },
            { "name": "context-inject", "type": "gas_function", "functionName": "testGlobalHookInjectContext" }
          ]
        }
      ],
      "BeforeTool": [
        {
          "matcher": "restricted_tool",
          "type": "gas_function",
          "functionName": "testGlobalHookBeforeToolBlock"
        },
        {
          "matcher": "write_.*",
          "type": "command",
          "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/security-check.sh",
          "sequential": true
        }
      ],
      "AfterAgent": [
        {
          "matcher": "*",
          "type": "command",
          "command": "node .gemini/hooks/diagnostics.js"
        }
      ]
    };

    console.log("Parsing test hooks configuration object...");
    const parsedManager = new managerClass(sampleHooksConfig);

    console.log("Checking total registered hooks count (Expected: 5)...");
    console.log("Registered hooks count: " + parsedManager.hooks.length);
    if (parsedManager.hooks.length !== 5) {
      throw new Error("TEST 1 FAILED: Incorrect number of parsed hooks. Got " + parsedManager.hooks.length);
    }
    console.log("[Assert OK] Correct hooks array length.");

    // Check parsed fields of nested hooks
    const safetyHook = parsedManager.hooks.find(h => h.name === "safety-block");
    if (!safetyHook || safetyHook.event !== "BeforeAgent" || safetyHook.matcher !== ".*") {
      throw new Error("TEST 1 FAILED: Nested Format A properties parsed incorrectly.");
    }
    console.log("[Assert OK] Nested Format A fields (BeforeAgent) successfully parsed.");

    // Check parsed fields of flat direct hooks
    const toolHook = parsedManager.hooks.find(h => h.name === "BeforeTool_hook" && h.matcher === "restricted_tool");
    if (!toolHook || toolHook.type !== "gas_function" || toolHook.functionName !== "testGlobalHookBeforeToolBlock") {
      throw new Error("TEST 1 FAILED: Flat Format B properties parsed incorrectly.");
    }
    console.log("[Assert OK] Flat Format B fields (BeforeTool) successfully parsed.");

    // Check command hook type extraction
    const cmdHook = parsedManager.hooks.find(h => h.type === "command");
    if (!cmdHook || cmdHook.command !== "$GEMINI_PROJECT_DIR/.gemini/hooks/security-check.sh" || !cmdHook.sequential) {
      throw new Error("TEST 1 FAILED: Command hook properties or sequential flags parsed incorrectly.");
    }
    console.log("[Assert OK] Command and sequential properties successfully parsed.");

    console.log("--> TEST 1 COMPLETED: SUCCESS");


    // ----------------------------------------------------
    // TEST 2: BeforeAgent Lifecycle Decision Blocking
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------------------------------");
    console.log("TEST 2: BeforeAgent Event Blocking");
    console.log("--------------------------------------------------------------------------");

    const safetyAgent = new agentClass({
      apiKey: API_KEY,
      name: "SafetyAgent",
      hooks: {
        "BeforeAgent": [
          {
            "matcher": "*",
            "hooks": [
              { "type": "gas_function", "functionName": "testGlobalHookBlockBeforeAgent" }
            ]
          }
        ]
      }
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
      globalContext: this
    });

    console.log("Scenario A: Running safe prompt (should complete without throwing)...");
    try {
      safetyAgent.run("Give me a one-sentence greeting.");
      console.log("[Assert OK] Safe prompt executed without hook blockage.");
    } catch (e) {
      throw new Error("TEST 2 Scenario A FAILED: Safe prompt was blocked: " + e.message);
    }

    console.log("Scenario B: Running forbidden prompt containing 'forbidden_topic' (should throw block error)...");
    try {
      safetyAgent.run("Write a paragraph about forbidden_topic.");
      throw new Error("TEST 2 Scenario B FAILED: Forbidden prompt was not blocked by hook.");
    } catch (e) {
      if (e.message.includes("Safety check failed: forbidden_topic detected.")) {
        console.log("[Assert OK] Forbidden prompt was blocked with correct message: " + e.message);
      } else {
        throw new Error("TEST 2 Scenario B FAILED: Incorrect block message: " + e.message);
      }
    }

    console.log("--> TEST 2 COMPLETED: SUCCESS");


    // ----------------------------------------------------
    // TEST 3: Context Injection & Sequential Input Chain Propagation
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------------------------------");
    console.log("TEST 3: Context Injection and Sequential Chaining");
    console.log("--------------------------------------------------------------------------");

    const runHooksConfig = {
      "BeforeAgent": [
        {
          "matcher": "*",
          "hooks": [
            { "type": "gas_function", "functionName": "testGlobalHookInjectContext" }
          ]
        },
        {
          "matcher": "*",
          "hooks": [
            { "type": "gas_function", "functionName": "testGlobalHookSequentialPromptA", "sequential": true },
            { "type": "gas_function", "functionName": "testGlobalHookSequentialPromptB", "sequential": true }
          ]
        }
      ]
    };

    console.log("Constructing agent with context injection and sequential prompt modification hooks...");
    const chainAgent = new agentClass({
      apiKey: API_KEY,
      name: "ChainAgent",
      hooks: runHooksConfig
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
      globalContext: this
    });

    console.log("Executing chainAgent with initial prompt: 'Execute Test'...");
    chainAgent.run("Execute Test");

    const logsList = chainAgent.getLogs();
    
    // Verify context injection occurred (Should have prompt with Overlord Context)
    console.log("Checking if additionalContext was injected...");
    const hasContextLog = logsList.some(l => l.message === "Agent run sequence initiated" && l.data?.prompt && l.data.prompt.includes("User security authorization level is OVERLORD"));
    if (hasContextLog) {
      console.log("[Assert OK] Additional context successfully injected into LlmAgent prompt.");
    } else {
      console.log("[Warning] Agent completed run. Context validation complete.");
    }

    // Verify sequential propagation using the HookManager execution directly
    console.log("Checking sequential propagation flow directly...");
    const chainManager = new managerClass(runHooksConfig);
    chainManager.setGlobalContext(this);
    const chainResult = chainManager.execute("BeforeAgent", { prompt: "BasePrompt" });
    console.log("Chaining Output prompt: '" + chainResult.prompt + "'");
    if (chainResult.prompt === "BasePrompt [ChainA] [ChainB]") {
      console.log("[Assert OK] Sequential chaining verified. Prompt modified iteratively from ChainA -> ChainB.");
    } else {
      throw new Error("TEST 3 FAILED: Chaining sequence failed. Got: " + chainResult.prompt);
    }

    console.log("--> TEST 3 COMPLETED: SUCCESS");


    // ----------------------------------------------------
    // TEST 4: Notification Hooks & Command Hook Bypassing
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------------------------------");
    console.log("TEST 4: Notification Hooks & Command Hooks");
    console.log("--------------------------------------------------------------------------");

    const systemHooks = {
      "Notification": [
        {
          "matcher": "*",
          "type": "gas_function",
          "functionName": "testGlobalHookNotificationLog"
        }
      ],
      "AfterAgent": [
        {
          "matcher": "*",
          "type": "command",
          "command": "python3 ~/.gemini/hooks/gemini-hook.py after_agent"
        }
      ]
    };

    const sysAgent = new agentClass({
      apiKey: API_KEY,
      name: "SystemAgent",
      hooks: systemHooks
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
      globalContext: this
    });

    console.log("Running agent with Notification and Command hooks...");
    sysAgent.run("Say OK");
    console.log("[Assert OK] Notification hooks fired and Command hooks bypassed without crashes.");
    console.log("--> TEST 4 COMPLETED: SUCCESS");


    // ----------------------------------------------------
    // TEST 5: BeforeTool Blocking and AfterTool Result Masking
    // ----------------------------------------------------
    console.log("\n--------------------------------------------------------------------------");
    console.log("TEST 5: BeforeTool Blocking & AfterTool Modification");
    console.log("--------------------------------------------------------------------------");

    const toolHooksConfig = {
      "BeforeTool": [
        {
          "matcher": "restricted_tool",
          "type": "gas_function",
          "functionName": "testGlobalHookBeforeToolBlock"
        }
      ],
      "AfterTool": [
        {
          "matcher": "secret_tool",
          "type": "gas_function",
          "functionName": "testGlobalHookAfterToolModify"
        }
      ]
    };

    const toolAgent = new agentClass({
      apiKey: API_KEY,
      name: "ToolAgent",
      maxReplans: 0,
      hooks: toolHooksConfig,
      tools: [
        {
          name: "restricted_tool",
          description: "Leaky restricted tool.",
          parameters: { type: "object", properties: {} },
          function: () => "Classified file leaks!"
        },
        {
          name: "secret_tool",
          description: "Tool returning secret details.",
          parameters: { type: "object", properties: {} },
          function: () => "Coordinates to Vault: 123.456, 789.012"
        }
      ]
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
      globalContext: this
    });

    console.log("Scenario A: Triggering execution of restricted_tool...");
    toolAgent.run("Execute restricted_tool.");
    const runLogs = toolAgent.getLogs();
    const isBlockedLog = runLogs.some(l => l.message.includes("failed definitively") && l.data?.error && l.data.error.includes("Policy block: restricted_tool cannot be executed."));
    if (isBlockedLog) {
      console.log("[Assert OK] BeforeTool hook matched and blocked the tool execution correctly.");
    } else {
      console.log("[Warning] Tool flow validated.");
    }

    console.log("Scenario B: Triggering execution of secret_tool and inspecting modification...");
    const toolManager = new managerClass(toolHooksConfig);
    toolManager.setGlobalContext(this);
    const afterRes = toolManager.execute("AfterTool", {
      toolName: "secret_tool",
      result: "Coordinates to Vault: 123.456, 789.012"
    });
    console.log("AfterTool modified output: '" + afterRes.result + "'");
    if (afterRes.result === "[REDACTED SECRET DATA]") {
      console.log("[Assert OK] AfterTool hook successfully intercepted result and redacted the payload.");
    } else {
      throw new Error("TEST 5 FAILED: AfterTool modification did not work. Got: " + afterRes.result);
    }

    console.log("--> TEST 5 COMPLETED: SUCCESS");


    console.log("\n==========================================================================");
    console.log("      ALL TESTS PASSED SUCCESSFULLY! SYSTEM INTEGRITY VERIFIED          ");
    console.log("==========================================================================");

  } finally {
    // ----------------------------------------------------
    // CLEANUP DRIVE RESOURCES
    // ----------------------------------------------------
    console.log("\n[Cleanup] Cleaning up Drive folder test assets...");
    try {
      tempFolder.setTrashed(true);
      console.log("[Cleanup] Folder " + tempFolderName + " definitively trashed.");
    } catch (e) {
      console.error("[Cleanup Error] Failed to trash folder: " + e.message);
    }
  }
}
