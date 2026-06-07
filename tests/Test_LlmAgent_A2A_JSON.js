/**
 * TestSuite_A2A_JSON.js
 *
 * @description
 * Executable Test Suite to strictly validate the new v1.3.1 feature:
 * `a2aServerAgentCardJSONs` and its coexistence with `a2aServerAgentCardURLs`.
 * This script ensures direct JSON injection bypasses HTTP fetch calls natively and maintains routing accuracy.
 *
 * [Execution Instructions]:
 * 1. Deploy the provided `A2A_MCP_Server.js` script as a Web App (ensure access is granted to "Anyone").
 * 2. Copy the resulting Web App URL and paste it into the `A2A_SERVER_WEBAPP_URL` constant below.
 * 3. Ensure your `GEMINI_API_KEY` is properly set in the Script Properties.
 * 4. Run the `executeA2AJSONTestSuite` function directly from the GAS Editor.
 * 5. Check the Execution Log for real-time tracking and results.
 */

function executeA2AJSONTestSuite() {
  const { LlmAgent } = GASADK;

  // --- CONFIGURATION REQUIRED ---
  // Replace this placeholder with the actual Web App URL deployed from A2A_MCP_Server.js
  const A2A_SERVER_WEBAPP_URL =
    "https://script.google.com/macros/s/{deploymentID}/exec";
  const MODEL_NAME = "models/gemini-3-flash-preview";

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");

  if (!API_KEY) {
    throw new Error(
      "CRITICAL FAILURE: GEMINI_API_KEY is not defined in Script Properties.",
    );
  }

  if (A2A_SERVER_WEBAPP_URL.includes("{deploymentID}")) {
    console.warn(
      "[WARNING] Running mock tests because A2A_SERVER_WEBAPP_URL was not configured. For true protocol testing, configure a deployed Web App URL.",
    );
  }

  console.log(
    `=== Initiating A2A JSON Bypass Test Suite [LlmAgent v1.3.1] ===`,
  );

  const coreLogger = (logEntry) => {
    console.log(`[Log] ${logEntry.message}`);
  };

  // --- Mock JSON Agent Card Generation ---
  // We mimic the exact structure that A2A_MCP_Server.js provides via .well-known/agent-card.json
  const MOCK_A2A_JSON_CARD = {
    "server cached-exchange-node": {
      name: "API Manager JSON Edition",
      description: "Directly loaded JSON agent card for A2A. Handles currency.",
      url: A2A_SERVER_WEBAPP_URL + "?accessKey=sample",
      skills: [
        {
          id: "get_exchange_rate",
          name: "Currency Exchange Rates Tool",
          description: "Helps with exchange values between various currencies",
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
        },
      ],
    },
  };

  try {
    // ---------------------------------------------------------
    // Scenario A: URLs ONLY
    // ---------------------------------------------------------
    console.log(
      "\n>>> [Scenario A] Executing Agent with a2aServerAgentCardURLs ONLY...",
    );
    const agentA = new LlmAgent({
      apiKey: API_KEY,
      name: "Agent_URL_Only",
      model: MODEL_NAME,
      a2aServerAgentCardURLs: [
        {
          "server remote-weather-node": {
            httpUrl: A2A_SERVER_WEBAPP_URL + "?accessKey=sample",
          },
        },
      ],
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const promptA =
      "Delegate strictly to 'server remote-weather-node'. What is the current weather in Tokyo?";
    const resA = agentA.run(promptA, coreLogger);
    console.log("-> [Scenario A Result]:\n" + resA);

    // ---------------------------------------------------------
    // Scenario B: JSONs ONLY
    // ---------------------------------------------------------
    console.log(
      "\n>>> [Scenario B] Executing Agent with a2aServerAgentCardJSONs ONLY (Zero-HTTP Bypass)...",
    );
    const agentB = new LlmAgent({
      apiKey: API_KEY,
      name: "Agent_JSON_Only",
      model: MODEL_NAME,
      a2aServerAgentCardJSONs: [MOCK_A2A_JSON_CARD],
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const promptB =
      "Delegate strictly to 'server cached-exchange-node'. Get the exchange rate from USD to JPY.";
    const resB = agentB.run(promptB, coreLogger);
    console.log("-> [Scenario B Result]:\n" + resB);

    // ---------------------------------------------------------
    // Scenario C: Coexistence (Both URLs and JSONs)
    // ---------------------------------------------------------
    console.log(
      "\n>>> [Scenario C] Executing Agent with BOTH URLs and JSONs...",
    );
    const agentC = new LlmAgent({
      apiKey: API_KEY,
      name: "Agent_Hybrid",
      model: MODEL_NAME,
      a2aServerAgentCardURLs: [
        {
          "server remote-identity-node": {
            httpUrl: A2A_SERVER_WEBAPP_URL + "?accessKey=sample",
          },
        },
      ],
      a2aServerAgentCardJSONs: [MOCK_A2A_JSON_CARD],
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const promptC =
      "First, ask 'server cached-exchange-node' for the USD to GBP exchange rate. Then, ask 'server remote-identity-node' what its secret access code is. Synthesize the final answer.";
    const resC = agentC.run(promptC, coreLogger);
    console.log("-> [Scenario C Result]:\n" + resC);
  } catch (error) {
    console.error(`[FATAL ERROR] Test suite crashed: ${error.stack}`);
  } finally {
    console.log("\n=== A2A JSON Bypass Test Suite Terminated ===");
  }
}
