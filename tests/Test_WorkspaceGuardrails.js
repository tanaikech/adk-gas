/**
 * Test_WorkspaceGuardrails.js
 *
 * @description
 * Unit and integration tests for Google Workspace Safety Guardrails
 * targeting BeforeTool execution blocking on sensitive operations.
 */

// ==========================================
// STATE TRACKING FOR ASSERTIONS
// ==========================================
var guardrailGmailExecuted = false;
var guardrailDriveExecuted = false;

// ==========================================
// DUMMY HOOK FUNCTIONS (Exposed Globally)
// ==========================================

/**
 * Global guardrail hook function for testing safety policy blocking.
 *
 * @param {Object} input - HookInput
 * @returns {Object} HookResult
 */
function testWorkspaceGuardrailHook(input) {
  console.log("   >> [Guardrail Hook] Inspecting tool: " + input.tool_name);
  
  const toolInput = input.tool_input || {};
  
  if (input.tool_name === "gmail_send_email") {
    const toAddress = toolInput.to || "";
    console.log("   >> [Guardrail Hook] Target Email address: '" + toAddress + "'");
    if (!toAddress || !toAddress.endsWith("@mycompany.com")) {
      return {
        decision: "deny",
        reason: "Blocked: Sending mail to external domains (" + toAddress + ") is strictly restricted."
      };
    }
  }
  
  if (input.tool_name === "drive_delete_file") {
    const fileId = toolInput.fileId || "";
    console.log("   >> [Guardrail Hook] Target File ID to delete: '" + fileId + "'");
    if (fileId === "protected_root_id") {
      return {
        decision: "deny",
        reason: "Blocked: Deletion of the protected root folder (ID: " + fileId + ") is prohibited."
      };
    }
  }
  
  return { decision: "allow" };
}

// ==========================================
// TEST SUITE EXECUTION
// ==========================================

/**
 * Main entry point function to execute guardrail policy verification.
 */
function runWorkspaceGuardrailTests() {
  console.log("==========================================================================");
  console.log("      STARTING WORKSPACE BEFORETOOL SAFETY GUARDRAIL TEST SUITE           ");
  console.log("==========================================================================");

  const agentClass = (typeof GASADK !== 'undefined') ? GASADK.LlmAgent : LlmAgent;
  
  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");
  if (!API_KEY) {
    throw new Error("FAIL: GEMINI_API_KEY script property is required to run integration tests.");
  }

  // Register guardrail hook targeting Gmail and Drive tools
  const config = {
    apiKey: API_KEY,
    name: "GuardrailAgent",
    maxReplans: 0,
    hooks: {
      "BeforeTool": [
        {
          "matcher": "gmail_send_email|drive_delete_file",
          "type": "gas_function",
          "functionName": "testWorkspaceGuardrailHook"
        }
      ]
    },
    tools: [
      {
        name: "gmail_send_email",
        description: "Send emails to targets. Argument 'to' must contain the email address.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Target email address." },
            body: { type: "string", description: "Email content." }
          },
          required: ["to", "body"]
        },
        function: (args) => {
          guardrailGmailExecuted = true;
          return "Email sent successfully to " + args.to;
        }
      },
      {
        name: "drive_delete_file",
        description: "Delete files or folders. Argument 'fileId' must contain the folder or file ID.",
        parameters: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "ID of file/folder to delete." }
          },
          required: ["fileId"]
        },
        function: (args) => {
          guardrailDriveExecuted = true;
          return "File " + args.fileId + " deleted successfully.";
        }
      }
    ]
  };

  const agent = new agentClass(config).setServices({
    lock: LockService.getScriptLock(),
    properties: properties,
    globalContext: this
  });

  // ----------------------------------------------------
  // Scenario 1: Safe Gmail Domain (Internal)
  // ----------------------------------------------------
  console.log("\n[Scenario 1] Sending internal email to boss@mycompany.com (Should succeed)...");
  guardrailGmailExecuted = false;
  try {
    const result = agent.run("Please use the gmail_send_email tool to send a greeting email to boss@mycompany.com.");
    console.log("Result: " + result);
    
    if (!guardrailGmailExecuted) {
      throw new Error("gmail_send_email tool was not executed for boss@mycompany.com");
    }
    console.log("[Assert OK] Internal email allowed and executed.");
  } catch (e) {
    throw new Error("FAIL: Scenario 1 failed: " + e.message);
  }

  // ----------------------------------------------------
  // Scenario 2: Unsafe Gmail Domain (External)
  // ----------------------------------------------------
  console.log("\n[Scenario 2] Sending external email to attacker@external.com (Should be blocked)...");
  guardrailGmailExecuted = false;
  try {
    const result = agent.run("Please use the gmail_send_email tool to send email to attacker@external.com.");
    console.log("Result: " + result);
    
    if (guardrailGmailExecuted) {
      throw new Error("FAIL: gmail_send_email tool was actually executed for attacker@external.com!");
    }
    
    // Check logs to make sure the hook blocked it
    const logs = agent.getLogs();
    const isBlocked = logs.some(l => l.message.includes("failed definitively") && l.data?.error && l.data.error.includes("Blocked: Sending mail to external domains"));
    const isResponseBlocked = result.toLowerCase().includes("blocked") || 
                              result.toLowerCase().includes("restricted") || 
                              result.toLowerCase().includes("unable") ||
                              result.toLowerCase().includes("cannot") ||
                              result.toLowerCase().includes("prohibit");
    
    if (isBlocked || isResponseBlocked) {
      console.log("[Assert OK] External email successfully blocked (Execution prevented).");
    } else {
      throw new Error("FAIL: External email did not trigger the expected block policy log or message.");
    }
  } catch (e) {
    throw new Error("FAIL: Scenario 2 failed: " + e.message);
  }

  // ----------------------------------------------------
  // Scenario 3: Safe Drive File Deletion
  // ----------------------------------------------------
  console.log("\n[Scenario 3] Deleting temporary scratch file (Should succeed)...");
  guardrailDriveExecuted = false;
  try {
    const result = agent.run("Please use the drive_delete_file tool to delete the file with ID temp_doc_123.");
    console.log("Result: " + result);
    
    if (!guardrailDriveExecuted) {
      throw new Error("drive_delete_file tool was not executed for temp_doc_123");
    }
    console.log("[Assert OK] Temporary file deletion allowed and executed.");
  } catch (e) {
    throw new Error("FAIL: Scenario 3 failed: " + e.message);
  }

  // ----------------------------------------------------
  // Scenario 4: Unsafe Drive Root Deletion
  // ----------------------------------------------------
  console.log("\n[Scenario 4] Deleting protected root folder (Should be blocked)...");
  guardrailDriveExecuted = false;
  try {
    const result = agent.run("Please use the drive_delete_file tool to delete the folder with ID protected_root_id.");
    console.log("Result: " + result);
    
    if (guardrailDriveExecuted) {
      throw new Error("FAIL: drive_delete_file tool was actually executed for protected_root_id!");
    }
    
    const logs = agent.getLogs();
    const isBlocked = logs.some(l => l.message.includes("failed definitively") && l.data?.error && l.data.error.includes("Blocked: Deletion of the protected root folder"));
    const isResponseBlocked = result.toLowerCase().includes("blocked") || 
                              result.toLowerCase().includes("prohibited") || 
                              result.toLowerCase().includes("prohibit") || 
                              result.toLowerCase().includes("unable") ||
                              result.toLowerCase().includes("cannot") ||
                              result.toLowerCase().includes("restrict");
    
    if (isBlocked || isResponseBlocked) {
      console.log("[Assert OK] Protected folder deletion successfully blocked (Execution prevented).");
    } else {
      throw new Error("FAIL: Protected folder deletion did not trigger the expected block policy log or message.");
    }
  } catch (e) {
    throw new Error("FAIL: Scenario 4 failed: " + e.message);
  }

  console.log("\n==========================================================================");
  console.log("      ALL GUARDRAIL SCENARIOS PASSED SUCCESSFULLY!                        ");
  console.log("==========================================================================");
}
