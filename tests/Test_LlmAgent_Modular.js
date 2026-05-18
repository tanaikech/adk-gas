/**
 * TestSuite_Modular.js
 *
 * @description
 * Executes a modular test suite for the LlmAgent.
 * Verifies that individual components function correctly without generating redundant "None" tasks.
 */

function executeModularTestSuite() {
  const { LlmAgent } = GASADK;

  const MCP_SERVER_URL = "YOUR_MCP_SERVER_URL";
  const A2A_SERVER_URL = "YOUR_A2A_SERVER_URL";
  const MODEL_NAME = "models/gemini-3-flash-preview";

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");

  if (!API_KEY)
    throw new Error(
      "Critical Failure: GEMINI_API_KEY is not defined in Script Properties.",
    );

  console.log(
    `=== Initiating Modular LlmAgent Test Suite [Model: ${MODEL_NAME}] ===`,
  );

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

  const tests = [
    function testBasicAndState() {
      const agent = new LlmAgent({
        apiKey: API_KEY,
        name: "BasicAgent",
        model: MODEL_NAME,
        instruction: "You are {role}. Reply concisely.",
        state: { role: "a cynical philosopher" },
      }).setServices({
        lock: LockService.getScriptLock(),
        properties: properties,
      });

      const prompt = "What is the meaning of a bug in code?";
      console.log(`-> Prompt: ${prompt}`);
      console.log("-> Result:", JSON.stringify(agent.run(prompt, coreLogger)));
    },

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

    function testAgentSkills() {
      console.log("Setting up temporary Agent Skills directory...");
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
        tempFolder.setTrashed(true);
        console.log("Temporary skills directory trashed.");
      }
    },

    function testMCPServer() {
      if (!MCP_SERVER_URL || MCP_SERVER_URL.includes("YOUR_MCP")) return;
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

    function testA2AServer() {
      if (!A2A_SERVER_URL || A2A_SERVER_URL.includes("YOUR_A2A")) return;
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
      console.log(`[SUCCESS] ${testFn.name}`);
    } catch (err) {
      console.error(`[FATAL ERROR] ${testFn.name} failed: ${err.stack}`);
    }
  });
  console.log("\n=== Modular Test Suite Execution Terminated ===");
}
