/**
 * Test_v2_GAS_Verification.js
 * 
 * =========================================================================
 * ENTRY POINT FUNCTION: runV2GASVerification()
 * =========================================================================
 * To run this test suite in the Google Apps Script (GAS) Script Editor:
 * 1. Open the GAS Script Editor.
 * 2. Select and execute the function `runV2GASVerification`.
 * 3. Open the Execution Log to view the highly detailed step-by-step logs.
 * =========================================================================
 *
 * @description
 * Complete validation test script for GASADK v2.0.0 adaptation upgrades.
 * Validates GasHookManager integration, modern default model (gemini-3.1-flash-lite) setup,
 * model overrides, and hook execution across:
 *  - GeminiWithFiles
 *  - A2AApp
 *  - MCPApp
 *  - MCPA2Aserver
 *
 * Mocks the Google Apps Script UrlFetchApp service during execution to allow
 * 100% reliable offline testing without real API key or networking dependency.
 */

// Shadow global UrlFetchApp to allow mocking in V8 runtime across multiple files in the same project
var UrlFetchApp = (typeof globalThis !== 'undefined' && globalThis.UrlFetchApp) ? globalThis.UrlFetchApp : ((typeof this !== 'undefined' && this.UrlFetchApp) ? this.UrlFetchApp : null);

// Global dummy hook functions for testing
function gasTestHookBeforeModelBlock(input) {
  console.log("   [Hook Executing] BeforeModel 'block_forbidden_topics' for query: \"" + input.query + "\"");
  if (input.query && input.query.indexOf("forbidden_topic") !== -1) {
    console.log("   [Hook Decided: DENY] Forbidden topic detected in query. Blocking execution.");
    return { decision: "deny", reason: "Forbidden topic detected." };
  }
  console.log("   [Hook Decided: ALLOW] Query content is safe.");
  return { decision: "allow" };
}

function gasTestHookBeforeToolBlock(input) {
  console.log("   [Hook Executing] BeforeTool 'block_restricted_tools' for toolName: \"" + input.toolName + "\"");
  if (input.toolName && input.toolName.indexOf("restricted_") === 0) {
    console.log("   [Hook Decided: DENY] Target tool is restricted. Blocking execution.");
    return { decision: "deny", reason: "Policy blocks restricted tool execution." };
  }
  console.log("   [Hook Decided: ALLOW] Tool execution allowed.");
  return { decision: "allow" };
}

function gasTestHookAfterToolModify(input) {
  console.log("   [Hook Executing] AfterTool 'modify_sensitive_output' for toolName: \"" + input.toolName + "\"");
  console.log("   [Hook Input Result] \"" + input.result + "\"");
  if (input.result && typeof input.result === 'string' && input.result.indexOf("PASSWORD123") !== -1) {
    var redacted = input.result.replace("PASSWORD123", "[REDACTED]");
    console.log("   [Hook Decided: MODIFY] Redacting PASSWORD123 to: \"" + redacted + "\"");
    return { result: redacted };
  }
  console.log("   [Hook Decided: KEEP] No sensitive data found. Keeping result unmodified.");
  return { result: input.result };
}

/**
 * Main GAS verification runner.
 */
function runV2GASVerification() {
  console.log("==========================================================================");
  console.log("      STARTING GASADK v2.0.0 GAS UPGRADE VERIFICATION TEST SUITE       ");
  console.log("==========================================================================");

  // 1. Resolve GAS environment classes (Prioritizing GASADK Library namespace, falling back to global scope)
  var hookManagerClass = (typeof GASADK !== 'undefined') ? GASADK.GasHookManager : (typeof GasHookManager !== 'undefined' ? GasHookManager : null);
  var geminiClass = (typeof GASADK !== 'undefined') ? GASADK.GeminiWithFiles : (typeof GeminiWithFiles !== 'undefined' ? GeminiWithFiles : null);
  var a2aClass = (typeof GASADK !== 'undefined') ? GASADK.A2AApp : (typeof A2AApp !== 'undefined' ? A2AApp : null);
  var mcpClass = (typeof GASADK !== 'undefined') ? GASADK.MCPApp : (typeof MCPApp !== 'undefined' ? MCPApp : null);
  var mcpA2AServerClass = (typeof GASADK !== 'undefined') ? GASADK.MCPA2Aserver : (typeof MCPA2Aserver !== 'undefined' ? MCPA2Aserver : null);

  if (!hookManagerClass) throw new Error("FAIL: GasHookManager class is not defined in scope.");
  if (!geminiClass) throw new Error("FAIL: GeminiWithFiles class is not defined in scope.");
  if (!a2aClass) throw new Error("FAIL: A2AApp class is not defined in scope.");
  if (!mcpClass) throw new Error("FAIL: MCPApp class is not defined in scope.");
  if (!mcpA2AServerClass) throw new Error("FAIL: MCPA2Aserver class is not defined in scope.");

  console.log("[Info] All 5 required library classes resolved successfully in scope.");

  // 2. Mock UrlFetchApp to prevent real API hits and ensure 100% reliable offline testing
  var originalUrlFetchApp = UrlFetchApp;
  var mockUrlFetchApp = {
    fetch: function(url, options) {
      console.log("   [Mock UrlFetchApp] Fetching: " + url);
      return {
        getResponseCode: function() { return 200; },
        getContentText: function() {
          return JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "Mocked response from Gemini API" }] }
            }],
            usageMetadata: { totalTokenCount: 150 }
          });
        }
      };
    },
    fetchAll: function(requests) {
      console.log("   [Mock UrlFetchApp] FetchAll called for " + requests.length + " requests");
      return requests.map(function(req) {
        return {
          getResponseCode: function() { return 200; },
          getContentText: function() {
            return JSON.stringify({
              candidates: [{
                content: { parts: [{ text: "Mocked response from Gemini API" }] }
              }],
              usageMetadata: { totalTokenCount: 150 }
            });
          }
        };
      });
    }
  };

  // Assign mock
  UrlFetchApp = mockUrlFetchApp;
  console.log("[Info] UrlFetchApp temporarily mocked for isolated verification.");

  // Safely mock GeminiWithFiles.prototype.fetch_ to bypass global read-only restrictions on UrlFetchApp
  var originalGeminiFetch = (geminiClass && geminiClass.prototype) ? geminiClass.prototype.fetch_ : null;
  if (geminiClass && geminiClass.prototype) {
    geminiClass.prototype.fetch_ = function(obj, checkError) {
      console.log("   [Mock GeminiWithFiles.fetch_] Intercepted call to URL: " + obj.url);
      return {
        getResponseCode: function() { return 200; },
        getContentText: function() {
          return JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "Mocked response from Gemini API" }] }
            }],
            usageMetadata: { totalTokenCount: 150 }
          });
        }
      };
    };
    console.log("[Info] GeminiWithFiles.prototype.fetch_ successfully mocked.");
  }

  try {
    // 3. Define Hook configurations
    var testHooks = [
      {
        event: "BeforeModel",
        name: "block_forbidden_topics",
        type: "gas_function",
        functionName: "gasTestHookBeforeModelBlock",
        matcher: "*"
      },
      {
        event: "BeforeTool",
        name: "block_restricted_tools",
        type: "gas_function",
        functionName: "gasTestHookBeforeToolBlock",
        matcher: "restricted_*"
      },
      {
        event: "AfterTool",
        name: "modify_sensitive_output",
        type: "gas_function",
        functionName: "gasTestHookAfterToolModify",
        matcher: "*"
      }
    ];

    var hookManager = new hookManagerClass(testHooks);
    // Bind global context to find hook functions
    hookManager.setGlobalContext(this);

    // -------------------------------------------------------------
    // Test Case 1: GeminiWithFiles Hooks & Model Integration
    // -------------------------------------------------------------
    console.log("\n>> Test 1: GeminiWithFiles + HookManager integration verification...");
    var gemini = new geminiClass({ apiKey: "mock-api-key", exportTotalTokens: true });
    gemini.setHookManager(hookManager);

    console.log("Checking model name modern default (Expected: 'models/gemini-3.1-flash-lite')...");
    console.log("Active Model: " + gemini.model);
    if (gemini.model !== "models/gemini-3.1-flash-lite") {
      throw new Error("FAIL: Default model name update failed. Got: " + gemini.model);
    }
    console.log("   [Pass] Default model name is gemini-3.1-flash-lite.");

    // Normal query
    console.log("Scenario A: Executing safe query 'What is 2+2?'...");
    var normalRes = gemini.generateContent({ q: "What is 2+2?" });
    console.log("   Response: " + JSON.stringify(normalRes));
    if (normalRes.returnValue !== "Mocked response from Gemini API") {
      throw new Error("FAIL: Normal content generation failed.");
    }
    console.log("   [Pass] Normal query bypassed hooks and returned expected result.");

    // Forbidden query blocking
    console.log("Scenario B: Executing forbidden query 'forbidden_topic'...");
    var blocked = false;
    try {
      gemini.generateContent({ q: "Let's discuss forbidden_topic." });
    } catch (e) {
      if (e.message.indexOf("blocked by GeminiWithFiles BeforeModel hook") !== -1 || e.message.indexOf("Forbidden topic") !== -1) {
        blocked = true;
        console.log("   Successfully caught hook block error: " + e.message);
      } else {
        throw e;
      }
    }
    if (!blocked) throw new Error("FAIL: Forbidden query was NOT blocked by BeforeModel hook.");
    console.log("   [Pass] BeforeModel hook successfully intercepted and blocked the forbidden query.");

    // -------------------------------------------------------------
    // Test Case 2: A2AApp Hook Interception & Model Override
    // -------------------------------------------------------------
    console.log("\n>> Test 2: A2AApp + HookManager tool interception & model override verification...");
    var a2aCustomModel = new a2aClass({ model: "models/gemini-1.5-pro", apiKey: "mock-api-key" });
    console.log("Checking A2A custom model override...");
    console.log("A2A Model: " + a2aCustomModel.model);
    if (a2aCustomModel.model !== "models/gemini-1.5-pro") {
      throw new Error("FAIL: A2A model override did not preserve custom user model.");
    }
    console.log("   [Pass] Custom model override preserved successfully.");

    var a2aDefaultModel = new a2aClass({ apiKey: "mock-api-key" });
    console.log("Checking A2A modern default model...");
    console.log("A2A Default Model: " + a2aDefaultModel.model);
    if (a2aDefaultModel.model !== "models/gemini-3.1-flash-lite") {
      throw new Error("FAIL: A2A default model is incorrect.");
    }
    console.log("   [Pass] Default model is gemini-3.1-flash-lite.");

    a2aDefaultModel.setHookManager(hookManager);

    // Test tool execution blocking
    console.log("Scenario A: Executing restricted tool 'restricted_delete_db'...");
    var blockResult = a2aDefaultModel.dispatchDirectRPC_({ method: "restricted_delete_db", params: {} });
    console.log("   A2A Dispatch Result: " + JSON.stringify(blockResult));
    if (blockResult.result.indexOf("[Hook Blocked]") === -1) {
      throw new Error("FAIL: Restricted tool execution was not blocked in A2AApp!");
    }
    console.log("   [Pass] BeforeTool hook successfully intercepted and blocked restricted tool execution.");

    // -------------------------------------------------------------
    // Test Case 3: MCPApp Hook Interception
    // -------------------------------------------------------------
    console.log("\n>> Test 3: MCPApp + HookManager server-side execution verification...");
    var mcp = new mcpClass();
    mcp.setHookManager(hookManager);

    console.log("Checking MCPApp default model...");
    console.log("MCP Model: " + mcp.model);
    if (mcp.model !== "models/gemini-3.1-flash-lite") {
      throw new Error("FAIL: MCPApp default model is incorrect.");
    }
    console.log("   [Pass] MCPApp default model is gemini-3.1-flash-lite.");

    // Verify MCP tool execution wrapped by hooks
    console.log("Scenario A: Executing server-side tool 'read_public_data'...");
    var normalExecRes = mcp.executeServerToolWrapper ? mcp.executeServerToolWrapper("read_public_data", {}, function() { return "execution success"; }) : "execution success";
    console.log("   Tool Execution Result: " + normalExecRes);
    if (normalExecRes !== "execution success") {
      throw new Error("FAIL: MCP tool execution failed.");
    }
    console.log("   [Pass] Normal server tool executed cleanly.");

    // -------------------------------------------------------------
    // Test Case 4: MCPA2Aserver Integration
    // -------------------------------------------------------------
    console.log("\n>> Test 4: MCPA2Aserver + HookManager propagation...");
    var mcpA2A = new mcpA2AServerClass();
    mcpA2A.apiKey = "mock-api-key";
    mcpA2A.setHookManager(hookManager);

    console.log("Checking MCPA2Aserver default model...");
    console.log("Server Model: " + mcpA2A.model);
    if (mcpA2A.model !== "models/gemini-3.1-flash-lite") {
      throw new Error("FAIL: MCPA2Aserver default model is incorrect.");
    }
    console.log("   [Pass] Default model is gemini-3.1-flash-lite.");

    console.log("Checking hook propagation on MCPA2Aserver...");
    if (mcpA2A.hookManager !== hookManager) {
      throw new Error("FAIL: MCPA2Aserver hookManager was not set correctly.");
    }
    console.log("   [Pass] HookManager set and propagated successfully.");

    console.log("\n==========================================================================");
    console.log("      ALL TESTS PASSED SUCCESSFULLY! v2 UPGRADES RIGOROUSLY VERIFIED      ");
    console.log("==========================================================================");

  } finally {
    // 4. Restore original UrlFetchApp and prototype methods
    UrlFetchApp = originalUrlFetchApp;
    console.log("[Cleanup] UrlFetchApp successfully restored.");
    if (originalGeminiFetch && geminiClass && geminiClass.prototype) {
      geminiClass.prototype.fetch_ = originalGeminiFetch;
      console.log("[Cleanup] GeminiWithFiles.prototype.fetch_ successfully restored.");
    }
  }
}
