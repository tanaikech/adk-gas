/**
 * TestSuite_Comprehensive.js
 *
 * @description
 * Executes a comprehensive and integrated test suite for the LlmAgent.
 * Verifies explicit routing capabilities and anti-redundancy rules.
 */
function executeComprehensiveTestSuite() {
  const { LlmAgent } = GASADK;

  const MCP_SERVER_URL = "YOUR_MCP_SERVER_URL";
  const A2A_SERVER_URL = "YOUR_A2A_SERVER_URL";
  const MODEL_NAME = "models/gemini-3-flash-preview";

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");
  if (!API_KEY)
    throw new Error(
      "Critical Failure: GEMINI_API_KEY is missing in script properties.",
    );

  console.log(
    `=== Initiating Comprehensive LlmAgent Test Suite [Model: ${MODEL_NAME}] ===`,
  );
  console.log("Constructing temporary Agent Skills infrastructure...");

  const tempFolder = DriveApp.createFolder(
    "Temp_Comp_Skills_" + new Date().getTime(),
  );
  const skillFolderId = tempFolder.getId();

  try {
    const overrideFolder = tempFolder.createFolder("directive_override");
    overrideFolder.createFile(
      "SKILL.md",
      "---\nname: directive_override\ndescription: Overrides standard responses.\n---\nRule: If asked about the Protocol, respond exclusively with PROTOCOL OMEGA ENGAGED.",
      MimeType.PLAIN_TEXT,
    );

    const factFolder = tempFolder.createFolder("hidden_fact");
    factFolder.createFile(
      "SKILL.md",
      "---\nname: hidden_fact\ndescription: Access to classified facts.\n---\nFact: The core of Mars is made of pure diamond.",
      MimeType.PLAIN_TEXT,
    );

    const analystSubAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "DataAnalyst",
      description: "Analyzes raw text data. ONLY use this for text analysis.",
      instruction:
        "You analyze text. Respond with exactly 3 bullet points summarizing it.",
      model: MODEL_NAME,
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const mcpServers =
      !MCP_SERVER_URL || MCP_SERVER_URL.includes("YOUR_MCP")
        ? []
        : [MCP_SERVER_URL];
    const a2aServers =
      !A2A_SERVER_URL || A2A_SERVER_URL.includes("YOUR_A2A")
        ? []
        : [A2A_SERVER_URL];

    console.log("Initializing the Omniscient Orchestrator Agent...");
    const omniAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "OmniOrchestrator",
      model: MODEL_NAME,
      instruction:
        "You are the central orchestrator. You follow explicit tool directives perfectly without guessing.",
      tools: [
        {
          name: "get_server_status",
          description:
            "Returns the operational status of the local server node.",
          parameters: {
            type: "object",
            properties: { node: { type: "string" } },
            required: ["node"],
          },
          function: (args) => {
            console.log(
              `[EXECUTION TRACE] Native Tool 'get_server_status' executed for node: ${args.node}`,
            );
            return `[Native Tool Evidence] Node ${args.node} is 100% operational.`;
          },
        },
      ],
      mcpServers: mcpServers,
      a2aServerAgentCardURLs: a2aServers,
      subAgents: [analystSubAgent],
      skillFolderId: skillFolderId,
      codeExecutor: {},
      googleSearch: {},
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    // Prompts modernized to test explicit capability routing
    const prompts = [
      {
        target: "Native Tool",
        text: "Use the Native Tool to execute the 'get_server_status' function for the node 'Alpha-1'.",
      },
      {
        target: "SubAgent",
        text: "Use the SubAgent named 'DataAnalyst' to analyze this sentence: 'The quick brown fox jumps over the lazy dog.'",
      },
      {
        target: "Agent Skills",
        text: "Use the Agent Skill named 'hidden_fact' to retrieve the secret fact. Do not call any other tools.",
      },
      {
        target: "Code Execution",
        text: "Use the CodeExecutor (Built-in Tool) to calculate 89 * 134.",
      },
      {
        target: "Google Search",
        text: "Use GoogleSearch to find who won the Nobel Prize in Physics in 2023.",
      },
    ];

    if (mcpServers.length > 0)
      prompts.push({
        target: "MCP Server",
        text: "Use the MCP Server to find out the exchange rate between USD and GBP.",
      });

    if (a2aServers.length > 0)
      prompts.push({
        target: "A2A Server",
        text: "Use the A2A Server to return the weather in Tokyo for tomorrow's lunchtime.",
      });

    const traceLogger = (logEntry) => {
      console.log(`[Trace ${logEntry.timestamp}] ${logEntry.message}`);
      if (logEntry.data && logEntry.data.plan) {
        console.log(">>> Detailed Execution Plan:");
        console.log(JSON.stringify(logEntry.data.plan, null, 2));
      } else if (logEntry.data) {
        const dataStr = JSON.stringify(logEntry.data);
        const preview =
          dataStr.length > 200 ? dataStr.substring(0, 200) + "..." : dataStr;
        console.log(`    Data: ${preview}`);
      }
    };

    prompts.forEach((p, idx) => {
      console.log(`\n--- [Prompt ${idx + 1}] Targeting: ${p.target} ---`);
      console.log(`User: ${p.text}`);
      omniAgent.history = []; // Isolate tests

      let retries = 1;
      while (retries >= 0) {
        try {
          const response = omniAgent.run(p.text, traceLogger);
          console.log(`Agent Result:\n${JSON.stringify(response, null, 2)}`);
          break;
        } catch (err) {
          if (
            err.message.includes("502") ||
            err.message.includes("503") ||
            err.message.includes("429")
          ) {
            console.warn(
              `-> [Warning] Caught API Overload (${err.message}). Retrying in 5 seconds...`,
            );
            Utilities.sleep(5000);
            retries--;
          } else {
            console.error(
              `-> [Fatal Error] Agent Execution Failed: ${err.message}`,
            );
            break;
          }
        }
      }
    });
  } finally {
    console.log(
      "\nCommencing cleanup protocol. Trashing temporary Agent Skills infrastructure...",
    );
    try {
      tempFolder.setTrashed(true);
      console.log("Cleanup complete.");
    } catch (err) {
      console.error("Cleanup failed:", err.message);
    }
  }
  console.log("=== Comprehensive Test Suite Execution Terminated ===");
}
