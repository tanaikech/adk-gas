/**
 * Executes a fully self-contained test suite validating local and cross-network Chat History.
 *
 * @description
 * This function validates that context (chat history) is correctly maintained locally by LlmAgent,
 * and transparently serialized/transmitted across the network by A2AApp. It confirms that the
 * remote A2A Server successfully merges client-side history with server-side injected history.
 *
 * @usage
 * Simply run this function directly from the Google Apps Script editor.
 * Ensure that the GEMINI_API_KEY property is correctly set in your Script Properties.
 */
function executeChatHistoryTestSuite() {
  const { LlmAgent, A2AApp } = GASADK;
  const A2A_SERVER_URL = "YOUR_A2A_SERVER_URL"; // "https://script.google.com/macros/s/{deploymentId}/exec/.well-known/agent-card.json?accessKey=sample";
  const MODEL_NAME = "models/gemini-3-flash-preview";

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");
  if (!API_KEY) {
    throw new Error(
      "CRITICAL FAILURE: GEMINI_API_KEY is missing in Script Properties.",
    );
  }

  console.log("=== Initiating Chat History Cross-Network Test Suite ===");

  // Test 1: Local Context Retention
  console.log("\n[Test 1] Local LlmAgent - Context Retention");
  const localAgent = new LlmAgent({
    apiKey: API_KEY,
    name: "LocalAgent",
    model: MODEL_NAME,
  }).setServices({ lock: LockService.getScriptLock(), properties: properties });

  localAgent.setHistory([
    { role: "user", parts: [{ text: "My favorite animal is the Capybara." }] },
    {
      role: "model",
      parts: [
        { text: "I have recorded that your favorite animal is the Capybara." },
      ],
    },
  ]);

  const resLocal = localAgent.run("What is my favorite animal?");
  console.log("Local Response:", resLocal);
  if (resLocal.toLowerCase().includes("capybara")) {
    console.log("[SUCCESS] Local context retention passed.");
  } else {
    console.error("[FAILURE] Local context retention failed.");
  }

  // Test 2: Cross-Network Client-Server History Merging
  console.log("\n[Test 2] Cross-Network A2A Server - History Integration");
  console.log(
    "Transmitting client history to the remote server. Expecting a response that synthesizes client and server history...",
  );

  const a2aApp = new A2AApp({ model: MODEL_NAME }).setServices({
    lock: LockService.getScriptLock(),
    properties: properties,
  });

  // Inject client-side history
  a2aApp.setHistory([
    { role: "user", parts: [{ text: "My name is Commander Shepard." }] },
    { role: "model", parts: [{ text: "Acknowledged, Commander Shepard." }] },
  ]);

  // CRITICAL: The prompt includes "What is your name?" to trigger the "OMEGA-SERVER" response.
  const prompt =
    "Delegate this task strictly to the remote agent ('API Manager'): 'Based on our chat history, what is my name? What is your name? Where are you located? What is your secret access code?'";
  console.log(`-> Client Prompt: "${prompt}"`);

  const a2aRes = a2aApp.client({
    apiKey: API_KEY,
    prompt: prompt,
    agentCardUrls: [A2A_SERVER_URL],
  });

  const textResult = Array.isArray(a2aRes.result)
    ? a2aRes.result.map((r) => r.text || r).join(" ")
    : JSON.stringify(a2aRes);
  console.log("-> Cross-Network Response:");
  console.log(textResult);

  // Stricter assertion based on the integrated contexts.
  if (
    textResult.includes("Shepard") &&
    textResult.includes("OMEGA-SERVER") &&
    textResult.includes("OMEGA-99") &&
    textResult.toLowerCase().includes("tokyo")
  ) {
    console.log(
      "[SUCCESS] Client history and Remote Server base history were perfectly integrated across the network.",
    );
  } else {
    console.error(
      "[FAILURE] Cross-network history integration failed. Validation keywords missing from response.",
    );
  }

  console.log(
    "=== Chat History Cross-Network Test Suite Execution Terminated ===",
  );
}
