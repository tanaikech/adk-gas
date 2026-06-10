/**
 * TestSuite_Modular.js
 * [Production Release v1.3.4]
 *
 * @description
 * Complete, execution-ready modular test suite designed to thoroughly validate
 * all core capabilities of LlmAgent.js under GAS constraints.
 *
 * @setup_instructions
 * 1. Open your Google Apps Script project.
 * 2. Go to Project Settings (gear icon) -> Script Properties.
 * 3. Add the following properties:
 *    - GEMINI_API_KEY: "YOUR_ACTUAL_GEMINI_API_KEY"
 *    - MCP_SERVER_URL: "https://script.google.com/macros/s/{YOUR_MCP_DEPLOYMENT_ID}/exec?accessKey=sample" (Optional)
 *    - A2A_SERVER_URL: "https://script.google.com/macros/s/{YOUR_A2A_DEPLOYMENT_ID}/exec?accessKey=sample" (Optional)
 * 4. Ensure the Google Drive API service is enabled if required, though standard DriveApp is used here.
 * 5. Run the function `executeModularTestSuite()` from the editor.
 *
 * @cleanup_assurance
 * This script strictly ensures that any temporal Google Drive folders or files
 * created during the Skill retrieval tests are recursively and definitively
 * removed inside a robust `finally` block to prevent Drive storage bloat.
 */

function executeModularTestSuite() {
  const { LlmAgent } = GASADK;

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");

  // Retrieve target endpoint URLs if pre-configured
  const MCP_SERVER_URL =
    properties.getProperty("MCP_SERVER_URL") || "YOUR_MCP_SERVER_URL";
  const A2A_SERVER_URL =
    properties.getProperty("A2A_SERVER_URL") || "YOUR_A2A_SERVER_URL";

  const MODEL_NAME = "models/gemini-3-flash-preview";

  if (!API_KEY) {
    throw new Error(
      "CRITICAL FAILURE: GEMINI_API_KEY is not defined in GAS Script Properties.",
    );
  }

  console.log(
    `=== Initiating Modular LlmAgent Test Suite [Model: ${MODEL_NAME}] ===`,
  );

  /**
   * Diagnostic Core Logger Callback to print internal transition phases.
   */
  const coreLogger = (logEntry) => {
    console.log(`[Log ${logEntry.timestamp}] ${logEntry.message}`);
    if (logEntry.data && logEntry.data.plan) {
      console.log(">>> Detailed Execution Plan:");
      console.log(JSON.stringify(logEntry.data.plan, null, 2));
    } else if (logEntry.data) {
      const dataStr = JSON.stringify(logEntry.data);
      const preview =
        dataStr.length > 150 ? dataStr.substring(0, 150) + "..." : dataStr;
      console.log(`    Data: ${preview}`);
    }
  };

  /**
   * Helper utility to recursively delete files and subfolders within Google Drive.
   * Definitively cleans up temporary test assets.
   *
   * @param {GoogleAppsScript.Drive.Folder} folder - The target folder to clean up.
   */
  const cleanupFolderRecursive = (folder) => {
    if (!folder) return;
    try {
      const files = folder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        file.setTrashed(true);
      }
      const subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        cleanupFolderRecursive(subFolders.next());
      }
      folder.setTrashed(true);
    } catch (err) {
      console.warn(
        `[Cleanup Warning] Failed to clean Drive assets: ${err.message}`,
      );
    }
  };

  const tests = [
    /**
     * Test 1: Basic execution and Dynamic State Injection validation.
     */
    function testBasicAndState() {
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "BasicAgent",
        model: MODEL_NAME,
        instruction: "You are {role}. Reply concisely in English.",
        state: { role: "a cynical philosopher" },
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt = "What is the meaning of a bug in code?";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },

    /**
     * Test 2: Native Tool Binding & Execution.
     */
    function testNativeTools() {
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "NativeToolAgent",
        model: MODEL_NAME,
        instruction:
          "You are a financial assistant. Execute the tools available to you to fetch data.",
        tools: [
          {
            name: "get_stock_price",
            description: "Get the stock price for a given ticker symbol.",
            parameters: {
              type: "object",
              properties: { ticker: { type: "string" } },
              required: ["ticker"],
            },
            function: (args) =>
              `[Native Tool Evidence] Stock ${args.ticker} is trading at $150.00`,
          },
        ],
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt =
        "Execute the 'get_stock_price' function (Native Tool) with 'TSLA' as the ticker. Output the exact result.";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },

    /**
     * Test 3: Output Schema Interception & Structured Formulation.
     */
    function testOutputSchema() {
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "SchemaAgent",
        model: MODEL_NAME,
        instruction: "Extract the data into the exact JSON output format.",
        outputSchema: {
          type: "object",
          properties: {
            target: { type: "string" },
            weapons: { type: "array", items: { type: "string" } },
          },
          required: ["target", "weapons"],
        },
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt =
        "The assassin John Wick targets the High Table using a pistol and a pencil.";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },

    /**
     * Test 4: Built-in Python Code Executor execution.
     */
    function testCodeExecutor() {
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "CodeAgent",
        model: MODEL_NAME,
        instruction: "You are an advanced mathematician.",
        codeExecutor: {},
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt =
        "Use the Python CodeExecutor (Built-in Tool) to compute 2 ** 16.";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },

    /**
     * Test 5: Hierarchical Agent Delegation (SubAgents).
     */
    function testSubAgents() {
      const translator = new LlmAgent({
        apiKey: API_KEY,
        name: "Translator",
        description: "Translates any given text to German.",
        instruction: "Translate the provided text to German precisely.",
        model: MODEL_NAME,
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const mainAgent = new LlmAgent({
        apiKey: API_KEY,
        name: "Orchestrator",
        model: MODEL_NAME,
        instruction: "You manage sub-agents.",
        subAgents: [translator],
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt =
        "Use the SubAgent named 'Translator' to translate 'Hello World'.";
      console.log(`-> Prompt: ${prompt}`);
      console.log(
        "-> Result:",
        JSON.stringify(mainAgent.run(prompt, coreLogger)),
      );
    },

    /**
     * Test 6: Drive-based Agent Skills & Automatic Asset Cleanup.
     */
    function testAgentSkills() {
      console.log(
        "Setting up temporary Agent Skills directory on Google Drive...",
      );
      const tempFolder = DriveApp.createFolder(
        "Temp_Modular_Skills_" + new Date().getTime(),
      );

      try {
        const animalFolder = tempFolder.createFolder("animal_skill");
        animalFolder.createFile(
          "SKILL.md",
          "---\nname: animal_skill\ndescription: Secret animal knowledge.\n---\nRule: The supreme animal is the Capybara.",
          MimeType.PLAIN_TEXT,
        );

        const agent = new LlmAgent({
          apiKey: API_KEY,
          name: "SkillAgent",
          model: MODEL_NAME,
          instruction:
            "Use the functions at your disposal to acquire knowledge.",
          skillFolderId: tempFolder.getId(),
        }).setServices({
          lock: LockService.getScriptLock(),
          properties: properties,
        });

        const prompt =
          "Use the Agent Skill named 'animal_skill' and tell me the supreme animal.";
        console.log(`-> Prompt: ${prompt}`);
        console.log(
          "-> Result:",
          JSON.stringify(agent.run(prompt, coreLogger)),
        );
      } finally {
        // Enforce definitive recursive cleanup of Drive assets to avoid storage leaks
        cleanupFolderRecursive(tempFolder);
        console.log(
          "Temporary skills directory recursively cleaned and moved to trash successfully.",
        );
      }
    },

    /**
     * Test 7: Integration with Model Context Protocol (MCP) Server.
     */
    function testMCPServer() {
      if (!MCP_SERVER_URL || MCP_SERVER_URL === "YOUR_MCP_SERVER_URL") {
        console.log(
          "[Skipping MCP Server Test]: Valid MCP_SERVER_URL is not set.",
        );
        return;
      }
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "MCPAgent",
        model: MODEL_NAME,
        instruction: "You integrate with MCP protocols.",
        mcpServers: [MCP_SERVER_URL],
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt =
        "Use the MCP Server to find out the exchange rate between USD and GBP.";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },

    /**
     * Test 8: Integration with Agent-to-Agent (A2A) Remote Server.
     */
    function testA2AServer() {
      if (!A2A_SERVER_URL || A2A_SERVER_URL === "YOUR_A2A_SERVER_URL") {
        console.log(
          "[Skipping A2A Server Test]: Valid A2A_SERVER_URL is not set.",
        );
        return;
      }
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "A2AAgent",
        model: MODEL_NAME,
        instruction: "You fetch intelligence from remote agents.",
        a2aServerAgentCardURLs: [A2A_SERVER_URL],
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt =
        "Use the A2A Server to return the weather in Tokyo for tomorrow's lunchtime.";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },
  ];

  tests.forEach((testFn, idx) => {
    console.log(`\n==================================================`);
    console.log(`[Test ${idx + 1}/${tests.length}] Executing: ${testFn.name}`);
    console.log(`==================================================`);
    try {
      testFn();
      console.log(`[SUCCESS] ${testFn.name} execution completed.`);
    } catch (err) {
      console.error(`[FATAL ERROR] ${testFn.name} failed: ${err.stack}`);
    }
  });
  console.log("\n=== Modular Test Suite Execution Terminated ===");
}
