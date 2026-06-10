/**
 * LlmAgent.js
 * [Production Release v1.3.4] - The Ultimate Autonomous Orchestrator with Multi-Channel Logging
 *
 * @description
 * An elite, highly optimized autonomous orchestrator agent designed specifically for
 * the rigorous execution limits of Google Apps Script (GAS).
 *
 * [Core Capabilities]:
 * - **Custom Server Name Routing**: Intelligently parses user-defined custom server names
 *   from MCP and A2A configurations, injecting them into the LLM's context to guarantee
 *   flawless tool selection when users reference specific servers by their custom aliases.
 * - **One-Pass Fast-Track**: Radically reduces latency and token costs. If a prompt requires
 *   no external tools, the Planner generates the final answer directly, bypassing the
 *   execution and synthesis loops entirely.
 * - **Schema Interception**: Intelligently intercepts Fast-Tracked conversational responses
 *   and routes them through the Synthesis engine ONLY if a strict JSON `outputSchema` is demanded.
 * - **Payload Bulletproofing**: Defends against context-limit crashes (e.g., HTTP 400) by
 *   safely truncating massive raw tool outputs (HTML/JSON dumps) at `maxResultLength`.
 * - **Dynamic Re-Planning (ReAct)**: If a capability fails decisively, the agent discards
 *   the current DAG queue and dynamically regenerates an alternative execution plan to achieve the goal.
 * - **Temporal Context Anchoring**: Injects the exact system time into the global context,
 *   completely resolving 'Planner Context Blindness' for relative temporal queries (e.g., "tomorrow").
 * - **Seamless Chat Context**: Maintains and propagates conversation history dynamically to
 *   sub-agents, MCP servers, and A2A remote servers without polluting the core logic history.
 * - **Local JSON Bypass (v1.3.1)**: Allows feeding pre-fetched Agent Card JSON objects directly
 *   to bypass redundant HTTP requests, slashing network latency for A2A protocols.
 * - **Multi-Channel Log Propagation (v1.3.3)**: Supports explicit log propagation from
 *   the orchestrator down to sub-clients, storing logs inside multi-channel Sheets dynamically.
 * - **Global Scope Initialization Fix (v1.3.4)**: Resolves compilation ReferenceError by removing
 *   unbound properties from global context, using runtime shadow cloning for context safety.
 *
 * @usage
 * const agent = new LlmAgent({
 *   apiKey: "YOUR_GEMINI_API_KEY",
 *   name: "OrchestratorPrime",
 *   logSpreadsheetId: "YOUR_LOG_SPREADSHEET_ID",
 *   a2aServerAgentCardURLs: [
 *     "https://script.google.com/macros/s/{deploymentID}/exec"
 *   ],
 *   a2aServerAgentCardJSONs: [
 *     {
 *       "server local-cache-agent": {
 *         name: "CachedAgent",
 *         url: "https://script.google.com/macros/s/{deploymentID}/exec",
 *         description: "Bypasses HTTP fetch.",
 *         skills: [...]
 *       }
 *     }
 *   ]
 * });
 * agent.setServices({ lock: LockService.getScriptLock() });
 */
var LlmAgent = class LlmAgent {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    if (!this.apiKey)
      throw new Error(
        "CRITICAL: apiKey is explicitly required to instantiate LlmAgent.",
      );

    this.name = config.name || "Agent";
    this.description = config.description || "";
    this.model = config.model || "models/gemini-3-flash-preview";
    this.instruction = config.instruction || "";
    this.state = config.state || {};

    // Limits and Safeguards
    this.maxReplans = config.maxReplans !== undefined ? config.maxReplans : 2;
    this.timeoutMs = config.timeoutMs || 280000; // 280 seconds (GAS safe limit)
    this.maxResultLength = config.maxResultLength || 20000; // Bulletproofing threshold
    this.startTime = null;

    // Capabilities configuration
    this.tools = config.tools || [];
    this.mcpServers = config.mcpServers || [];
    this.a2aServerAgentCardURLs = config.a2aServerAgentCardURLs || [];
    this.a2aServerAgentCardJSONs = config.a2aServerAgentCardJSONs || [];
    this.subAgents = config.subAgents || [];
    this.skillFolderId = config.skillFolderId || "";

    // Built-in integrations
    this.codeExecutor = config.codeExecutor || null;
    this.googleSearch = config.googleSearch || null;
    this.urlContext = config.urlContext || null;
    this.fileSearch = config.fileSearch || null;

    // Advanced config
    this.generateContentConfig = config.generateContentConfig || null;
    this.outputSchema = config.outputSchema || null;
    this.logSpreadsheetId = config.logSpreadsheetId || ""; // Propagated down to MCPApp and A2AApp in v1.3.3

    // Internal state
    this.history = [];
    this.logs = [];
    this.services = null;
    this.capabilities = [];
    this._capabilitiesInitialized = false;
  }

  setServices(services = {}) {
    this.services = services;
    this._initializeCapabilities();
    return this;
  }

  /**
   * Sets the conversation history for the agent.
   * This allows the agent to maintain context across multiple interactions in a chat environment.
   * The history format is fully compatible with GeminiWithFiles.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {LlmAgent} This agent instance for chaining.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error(
        "CRITICAL: History must be an array of objects compatible with GeminiWithFiles.",
      );
    }
    this.history = history;
    return this;
  }

  /**
   * Retrieves the current conversation history.
   *
   * @returns {Array<Object>} The current history array.
   */
  getHistory() {
    return this.history;
  }

  _requireLockService() {
    if (!this.services || !this.services.lock) {
      throw new Error(
        "CRITICAL FAILURE: LockService is strictly required for LlmAgent but was not provided.",
      );
    }
  }

  getAgentInf() {
    if (!this._capabilitiesInitialized) this._initializeCapabilities();
    return this.capabilities;
  }

  getLogs() {
    return this.logs;
  }

  /**
   * Robust JSON extraction helper to handle markdown wrappers and raw text.
   * @param {string} text - Raw string output from LLM.
   * @returns {Object|Array} Parsed JSON.
   */
  _extractJson(text) {
    if (typeof text !== "string") return text;
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    try {
      return match ? JSON.parse(match[1]) : JSON.parse(text);
    } catch (e) {
      const fallbackMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (fallbackMatch) {
        try {
          return JSON.parse(fallbackMatch[1]);
        } catch (err) {
          /* cascade to throw */
        }
      }
      throw new Error(
        "Invalid JSON structure returned by model: " + text.substring(0, 150),
      );
    }
  }

  /**
   * Extracts the custom user-defined server name from a configuration array item.
   * Matches objects like: { "custom_name": { httpUrl: "..." } }
   *
   * @param {string|Object} item - The configuration item from mcpServers or a2aServerAgentCardURLs/JSONs.
   * @returns {string|null} The custom server name, or null if not applicable.
   */
  _extractCustomName(item) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const keys = Object.keys(item);
      // Ensure the object has exactly one key acting as the custom name alias
      if (keys.length === 1 && typeof item[keys[0]] === "object") {
        return keys[0];
      }
    }
    return null;
  }

  _initializeCapabilities(logCallback = null) {
    this._requireLockService();
    if (this._capabilitiesInitialized) return;

    const log = (message, data = null) => {
      const entry = { timestamp: new Date().toISOString(), message, data };
      this.logs.push(entry);
      if (logCallback) logCallback(entry);
    };

    log("Initiating capabilities pre-fetch sequence...");
    this.capabilities = [];

    // 1. Native Tools
    if (this.tools?.length > 0) {
      this.tools.forEach((t) => {
        this.capabilities.push({
          id: `tool_${t.name}`,
          type: "Native Tool",
          name: t.name,
          description: {
            description: t.description || "Native function execution.",
            parameters: t.parameters?.properties
              ? Object.keys(t.parameters.properties)
              : [],
          },
          _tool: t,
        });
      });
    }

    // 2. MCP Servers
    if (this.mcpServers?.length > 0) {
      try {
        const mcpConfig = {};
        if (this.logSpreadsheetId) {
          mcpConfig.log = true;
          mcpConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const mcpApp = new MCPApp(mcpConfig).setServices(this.services);
        const initClient = mcpApp.client({
          apiKey: this.apiKey,
          prompt: "system_initialization",
          mcpServerUrls: this.mcpServers,
          batchProcess: true,
          history: [],
        });

        if (initClient?.mcpServerObj?.length > 0) {
          initClient.mcpServerObj.forEach((obj, idx) => {
            const originalUrlOrObj = obj.original || this.mcpServers[idx];
            const customName = this._extractCustomName(this.mcpServers[idx]);
            const sInfo = obj.initialize?.result?.serverInfo || {
              name: `MCPServer_${idx}`,
              version: "unknown",
            };

            let rawTools = [];
            if (obj["tools/list"]?.result?.tools)
              rawTools = obj["tools/list"].result.tools;
            else if (obj["tools/list"]?.tools)
              rawTools = obj["tools/list"].tools;
            else if (Array.isArray(obj["tools/list"]))
              rawTools = obj["tools/list"];

            const toolDescriptions = rawTools.map((t) => ({
              name: t.name,
              description: t.description,
              required_parameters: t.inputSchema?.required || [],
            }));

            // Override display name if user provided a custom name
            const displayName = customName || sInfo.name;

            this.capabilities.push({
              id: `mcp_${idx}`,
              type: "MCP Server",
              name: displayName,
              description: {
                custom_server_name: customName || undefined,
                server_name: sInfo.name,
                version: sInfo.version,
                tools: toolDescriptions,
              },
              URL: originalUrlOrObj, // Kept intact for downward GASADK compat
            });
          });
        }
      } catch (e) {
        log("MCP Server initialization failed", { error: e.message });
      }
    }

    // 3. A2A Servers (URL and Direct JSON Bypass Integration)
    if (
      this.a2aServerAgentCardURLs?.length > 0 ||
      this.a2aServerAgentCardJSONs?.length > 0
    ) {
      try {
        const combinedA2AConfigs = [];
        const a2aConfig = { model: this.model };
        if (this.logSpreadsheetId) {
          a2aConfig.log = true;
          a2aConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const a2aApp = new A2AApp(a2aConfig).setServices(this.services);

        // 3a. Process Remote URLs
        if (this.a2aServerAgentCardURLs?.length > 0) {
          try {
            const agentCards = [].concat(
              a2aApp.getAgentCards(this.a2aServerAgentCardURLs) || [],
            );
            agentCards.forEach((card, idx) => {
              if (card?.url) {
                combinedA2AConfigs.push({
                  card: card,
                  sourceConfig: this.a2aServerAgentCardURLs[idx],
                });
              }
            });
          } catch (fetchErr) {
            log("A2A Server URL retrieval failed", { error: fetchErr.message });
          }
        }

        // 3b. Process Local Direct JSON Bypass
        if (this.a2aServerAgentCardJSONs?.length > 0) {
          this.a2aServerAgentCardJSONs.forEach((jsonConfig) => {
            let card = jsonConfig;
            const customName = this._extractCustomName(jsonConfig);
            // If the JSON is wrapped with a custom name alias, unwrap it to get the raw card
            if (
              customName &&
              typeof jsonConfig[customName] === "object" &&
              !Array.isArray(jsonConfig[customName])
            ) {
              card = jsonConfig[customName];
            }
            if (card) {
              combinedA2AConfigs.push({
                card: card,
                sourceConfig: jsonConfig,
              });
            }
          });
        }

        // 3c. Capability Registration
        combinedA2AConfigs.forEach(({ card, sourceConfig }, idx) => {
          if (card?.url || card?.name) {
            // Fallback validation for edge cases
            const customName = this._extractCustomName(sourceConfig);
            const displayName = customName || card.name || `A2AServer_${idx}`;
            const safeCardInfo = {
              custom_server_name: customName || undefined,
              original_card_name: card.name,
              description: card.description,
              skills: (card.skills || []).map((s) => ({
                name: s.name,
                description: s.description,
              })),
            };
            this.capabilities.push({
              id: `a2a_${idx}`,
              type: "A2A Server",
              name: displayName,
              description: safeCardInfo,
              URL: card.url || `local_json_bypass_${idx}`,
              _card: card, // Downward injected cleanly into A2AApp context
            });
          }
        });
      } catch (e) {
        log("A2A Server initialization failed", { error: e.message });
      }
    }

    // 4. SubAgents
    if (this.subAgents?.length > 0) {
      this.subAgents.forEach((sa) => {
        this.capabilities.push({
          id: `subagent_${sa.name}`,
          type: "SubAgent",
          name: sa.name,
          description: sa.description || "Hierarchical sub-agent.",
          instruction: sa.instruction || "",
          _agent: sa,
        });
      });
    }

    // 5. Agent Skills
    if (this.skillFolderId) {
      try {
        const folder = DriveApp.getFolderById(this.skillFolderId);
        const subFolders = folder.getFolders();
        while (subFolders.hasNext()) {
          const subF = subFolders.next();
          const folderId = subF.getId();
          const files = subF.getFiles();
          while (files.hasNext()) {
            const file = files.next();
            const fname = file.getName();
            if (fname === "SKILL.md" || fname.endsWith(".md")) {
              const content = file.getBlob().getDataAsString();
              const nameMatch = content.match(/name:\s*([^\r\n]+)/);
              const descMatch = content.match(/description:\s*([^\r\n]+)/);
              const skillName = nameMatch
                ? nameMatch[1].trim()
                : subF.getName();
              const skillDesc = descMatch
                ? descMatch[1].trim()
                : "Agent skill definition.";
              this.capabilities.push({
                id: `skill_${skillName}`,
                type: "Agent Skill",
                name: skillName,
                description: skillDesc,
                content: content,
                folderId: folderId,
              });
            }
          }
        }
      } catch (e) {
        log("Agent Skills initialization failed", { error: e.message });
      }
    }

    // 6. Built-ins
    if (this.googleSearch)
      this.capabilities.push({
        id: `builtin_googleSearch`,
        type: "Built-in Tool",
        name: "GoogleSearch",
        description: "Search the web via Google for current information.",
        _tool: { googleSearch: this.googleSearch },
      });
    if (this.codeExecutor)
      this.capabilities.push({
        id: `builtin_codeExecutor`,
        type: "Built-in Tool",
        name: "CodeExecutor",
        description: "Execute Python code for math or logic.",
        _tool: { codeExecution: this.codeExecutor },
      });
    if (this.fileSearch)
      this.capabilities.push({
        id: `builtin_fileSearch`,
        type: "Built-in Tool",
        name: "FileSearch",
        description: "Search files.",
        _tool: { fileSearch: this.fileSearch },
      });
    if (this.urlContext)
      this.capabilities.push({
        id: `builtin_urlContext`,
        type: "Built-in Tool",
        name: "UrlContext",
        description: "Fetch context from URLs.",
        _tool: { urlContext: this.urlContext },
      });

    this._capabilitiesInitialized = true;
    log("Capabilities pre-fetch complete.", {
      loadedCapabilities: this.capabilities.length,
    });
  }

  _executeTask(cap, executionPrompt) {
    if (!cap) {
      const g = new GeminiWithFiles({
        apiKey: this.apiKey,
        model: this.model,
        history: [...this.history],
      });
      return g.generateContent({ q: executionPrompt });
    }

    switch (cap.type) {
      case "Native Tool": {
        const funcs = {
          params_: {
            [cap.name]: {
              description: cap.description?.description || "",
              parameters: cap._tool.parameters,
            },
          },
        };
        funcs[cap.name] = cap._tool.function;
        const g = new GeminiWithFiles({
          apiKey: this.apiKey,
          model: this.model,
          functions: funcs,
          history: [...this.history],
        });
        return g.generateContent({ q: executionPrompt });
      }
      case "MCP Server": {
        const mcpConfig = {};
        if (this.logSpreadsheetId) {
          mcpConfig.log = true;
          mcpConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const mcpApp = new MCPApp(mcpConfig).setServices(this.services);
        const tempClient = mcpApp.client({
          apiKey: this.apiKey,
          prompt: executionPrompt,
          mcpServerUrls: [cap.URL],
          batchProcess: true,
          history: [...this.history],
        });
        const res = tempClient.callMCPServers();
        if (res?.error)
          throw new Error(`MCP Error: ${JSON.stringify(res.error)}`);
        return res?.result || res;
      }
      case "A2A Server": {
        // [Optimization v1.3.1]: Pass LlmAgent model settings to A2AApp context natively
        const a2aConfig = { model: this.model };
        if (this.logSpreadsheetId) {
          a2aConfig.log = true;
          a2aConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const a2aApp = new A2AApp(a2aConfig).setServices(this.services);
        // By passing agentCards directly, A2AApp guarantees a zero-latency HTTP bypass for card fetching.
        // By passing directRouting: true, we cleanly bypass A2AApp's internal local double-planning (Phase 3-7).
        const res = a2aApp.client({
          apiKey: this.apiKey,
          prompt: executionPrompt,
          agentCards: [cap._card],
          history: [...this.history],
          directRouting: true,
        });
        if (res?.error)
          throw new Error(`A2A Error: ${JSON.stringify(res.error)}`);
        return res?.result || res;
      }
      case "SubAgent":
        if (typeof cap._agent.setHistory === "function") {
          cap._agent.setHistory([...this.history]);
        }
        return cap._agent.run(executionPrompt);
      case "Agent Skill": {
        const g = new GeminiWithFiles({
          apiKey: this.apiKey,
          model: this.model,
          systemInstruction: {
            parts: [{ text: `Strictly apply this skill:\n\n${cap.content}` }],
          },
          history: [...this.history],
        });
        return g.generateContent({ q: executionPrompt });
      }
      case "Built-in Tool": {
        const g = new GeminiWithFiles({
          apiKey: this.apiKey,
          model: this.model,
          tools: [cap._tool],
          history: [...this.history],
        });
        return g.generateContent({ q: executionPrompt });
      }
      default:
        throw new Error(`Unknown capability: ${cap.type}`);
    }
  }

  run(prompt, logCallback = null) {
    this.startTime = Date.now();

    const log = (message, data = null) => {
      const entry = { timestamp: new Date().toISOString(), message, data };
      this.logs.push(entry);
      if (typeof logCallback === "function") logCallback(entry);
    };

    if (!this._capabilitiesInitialized) this._initializeCapabilities(log);
    log("Agent run sequence initiated", { prompt });

    // Global Context Hoisting
    const temporalContext = `\n[System Time Anchor]: Current system date/time is ${new Date().toString()}. Use this as the baseline for relative time references.`;

    let globalInstruction = `You are an autonomous orchestrator agent. Designation: "${this.name}".${temporalContext}\n`;
    let baseInstruction = this.instruction;
    if (this.state && typeof baseInstruction === "string") {
      baseInstruction = baseInstruction.replace(/{(\w+)}/g, (match, key) =>
        this.state[key] !== undefined ? this.state[key] : match,
      );
    }
    if (baseInstruction)
      globalInstruction += `User Persona & Core Instructions: ${typeof baseInstruction === "string" ? baseInstruction : JSON.stringify(baseInstruction)}\n`;

    // Capability Compaction
    const plannerCapabilities = this.capabilities.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      description: c.description,
    }));
    const capabilityIds = this.capabilities.map((c) => c.id);

    // Unified Schema Definitions
    const taskArraySchema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          task_id: { type: "number" },
          description: { type: "string" },
          capability_id: { type: "string", enum: capabilityIds },
          execution_prompt: { type: "string" },
          depends_on: {
            type: "array",
            items: { type: "number" },
            description: "Task IDs this task depends on.",
          },
        },
        required: [
          "task_id",
          "description",
          "capability_id",
          "execution_prompt",
          "depends_on",
        ],
      },
    };

    const plannerSchema = {
      type: "object",
      properties: {
        requires_capabilities: {
          type: "boolean",
          description: "True ONLY if external tools are strictly required.",
        },
        direct_answer: {
          type: "string",
          description:
            "If requires_capabilities is false, provide the final comprehensive answer here directly to the user.",
        },
        plan: taskArraySchema,
      },
      required: ["requires_capabilities"],
    };

    const plannerPromptStr = `
Objective: Decompose the user's prompt into tasks and assign MINIMAL necessary capabilities.

User Prompt: "${prompt}"

Available Capabilities:
${JSON.stringify(plannerCapabilities, null, 2)}

Instructions:
1. Decompose the prompt into sequential tasks. Select exactly ONE capability per task by its "id".
   *CRITICAL*: If the user explicitly mentions a custom server name in their prompt, you MUST tightly match it against the "custom_server_name" or "name" fields in the capabilities list to ensure accurate tool routing.
2. Selective Context Passing (depends_on): Evaluate dependencies. Include previous "task_id" in "depends_on" if strictly required.
3. SUB-AGENT PROMPT STYLING (CRITICAL): Delegate to 'MCP Server' or 'A2A Server' using natural language queries, not robotic instructions.
4. ONE-PASS FAST-TRACK (CRITICAL): If NO capabilities are required to answer the prompt entirely, set "requires_capabilities" to false, and write your complete response in "direct_answer". You MUST append "\n\nExecution Summary: NO capabilities were used." at the end of "direct_answer". Leave "plan" empty.
5. BAN ON SYNTHESIS TASKS (CRITICAL): Do NOT create tasks for compiling, summarizing, formatting, or synthesizing the final answer. The system automatically executes a final synthesis phase using all gathered data. Create tasks ONLY for actively executing tools or fetching data.
`;

    log("Planning phase initiated.");
    const plannerConfig = {
      apiKey: this.apiKey,
      model: this.model,
      history: this.history,
      systemInstruction: { parts: [{ text: globalInstruction }] },
      responseSchema: plannerSchema,
    };

    let planResultText;
    try {
      planResultText = new GeminiWithFiles(plannerConfig).generateContent({
        q: plannerPromptStr,
      });
    } catch (e) {
      throw new Error(`Initial Planning Phase Error: ${e.message}`);
    }

    let planResult;
    try {
      planResult = this._extractJson(planResultText);
    } catch (e) {
      throw new Error(
        `Invalid JSON returned from Planner: ${e.message}\nRaw Output: ${planResultText}`,
      );
    }

    let planQueue = [];
    let taskResults = [];
    let replanCount = 0;

    // ==========================================
    // ZERO-SYNTHESIS BYPASS & SCHEMA INTERCEPTION
    // ==========================================
    if (planResult.requires_capabilities === false) {
      const directAns =
        planResult.direct_answer || "No capabilities required to answer.";

      // Intercept bypass if outputSchema is demanded to ensure strict formatting
      if (this.outputSchema) {
        log(
          "One-Pass Fast-Track intercepted: 'outputSchema' is defined. Routing to Synthesis for strict formatting.",
        );
        taskResults.push({
          task_id: 0,
          capability_used: "None",
          capability_type: "None",
          prompt: prompt,
          result: directAns,
          duration_ms: 0,
        });
        // planQueue remains empty, dropping immediately into the final Synthesis loop
      } else {
        log(
          "One-Pass Fast-Track Triggered: Bypassing execution and synthesis entirely.",
        );
        this.history.push({ role: "user", parts: [{ text: prompt }] });
        this.history.push({ role: "model", parts: [{ text: directAns }] });
        return directAns;
      }
    } else {
      planQueue = planResult.plan || [];
      const planSummary = planQueue
        .map((t) => `Task [${t.task_id}]: '${t.capability_id}'`)
        .join("\n");
      log("Execution Plan Generated:\n" + planSummary, { plan: planQueue });
    }

    let highestTaskId = Math.max(...planQueue.map((t) => t.task_id), 0);

    // ==========================================
    // ADAPTIVE EXECUTION PHASE
    // ==========================================
    while (planQueue.length > 0) {
      const timeElapsed = Date.now() - this.startTime;
      if (timeElapsed > this.timeoutMs) {
        log(
          `[TIMEOUT PREVENTION] Safe abort triggered. Elapsed: ${timeElapsed}ms exceeds ${this.timeoutMs}ms limit.`,
        );
        break;
      }

      const task = planQueue.shift();
      log(`Executing Task [${task.task_id}] via [${task.capability_id}]`, {
        description: task.description,
      });

      const cap = this.capabilities.find((c) => c.id === task.capability_id);

      let contextStr = "";
      if (task.depends_on && task.depends_on.length > 0) {
        const dependentResults = taskResults.filter(
          (tr) => task.depends_on.includes(tr.task_id) && !tr.error,
        );
        if (dependentResults.length > 0)
          contextStr = `\n\n[Context from dependent tasks]:\n${JSON.stringify(dependentResults)}`;
      }

      const finalExecutionPrompt = task.execution_prompt + contextStr;

      let rawResultData;
      let taskError = null;
      let retries = 1;
      const taskStartTime = Date.now();

      while (retries >= 0) {
        try {
          rawResultData = this._executeTask(cap, finalExecutionPrompt);
          taskError = null;
          break;
        } catch (err) {
          if (retries === 0) {
            taskError = err.message;
          } else {
            log(`Task [${task.task_id}] failed, retrying...`, {
              error: err.message,
            });
            Utilities.sleep(2000);
            retries--;
          }
        }
      }

      const durationMs = Date.now() - taskStartTime;

      // Result Payload Truncation (Bulletproofing against 400 Payload Too Large)
      let finalResultData = null;
      if (!taskError) {
        let resultStr =
          typeof rawResultData === "object"
            ? JSON.stringify(rawResultData)
            : String(rawResultData);
        if (resultStr.length > this.maxResultLength) {
          log(
            `[PAYLOAD WARNING] Task [${task.task_id}] result length (${resultStr.length}) exceeded limit. Truncating to ${this.maxResultLength} chars.`,
          );
          resultStr =
            resultStr.substring(0, this.maxResultLength) +
            "\n\n...[TRUNCATED: Exceeds context limit]";
        }
        finalResultData = resultStr;
      }

      if (!taskError) {
        taskResults.push({
          task_id: task.task_id,
          capability_used: task.capability_id,
          capability_type: cap ? cap.type : "Unknown",
          prompt: task.execution_prompt,
          result: finalResultData,
          duration_ms: durationMs,
        });
        log(
          `Task [${task.task_id}] completed successfully in ${durationMs}ms.`,
        );
      } else {
        taskResults.push({
          task_id: task.task_id,
          capability_used: task.capability_id,
          capability_type: cap ? cap.type : "Unknown",
          prompt: task.execution_prompt,
          error: taskError,
          duration_ms: durationMs,
        });
        log(`Task [${task.task_id}] failed definitively in ${durationMs}ms.`, {
          error: taskError,
        });

        // Dynamic Re-Planning Trigger
        if (replanCount < this.maxReplans) {
          replanCount++;
          log(
            `[DYNAMIC RE-PLANNING] Attempt ${replanCount}/${this.maxReplans}. Discarding remaining queue and regenerating DAG...`,
          );
          planQueue.length = 0;

          const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to failure.
Original Prompt: "${prompt}"
Capabilities: ${JSON.stringify(plannerCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(
            taskResults.filter((t) => !t.error),
            null,
            2,
          )}

FAILURE REPORT:
Failed Capability: ${task.capability_id}
Error: ${taskError}

Instructions:
1. Bypass the error. Do NOT use the exact same capability/prompt combination.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${highestTaskId + 1}.
`;
          try {
            // Re-planner explicitly uses the Array Schema
            const replanResText = new GeminiWithFiles({
              ...plannerConfig,
              responseSchema: taskArraySchema,
            }).generateContent({ q: replanPromptStr });
            const newPlan = this._extractJson(replanResText);
            planQueue.push(...newPlan);
            highestTaskId = Math.max(
              highestTaskId,
              ...newPlan.map((t) => t.task_id),
            );
            log("Re-planning successful. Appended new tasks to queue.", {
              newPlan,
            });
          } catch (replanErr) {
            log("Re-planning failed. Forcing synthesis.", {
              error: replanErr.message,
            });
            break;
          }
        } else {
          log(
            "Maximum re-planning limits reached. Continuing with failure state.",
          );
        }
      }
    }

    log("Execution phase complete. Initiating final synthesis.");

    let timeWarning = "";
    if (Date.now() - this.startTime > this.timeoutMs) {
      timeWarning =
        "\n[CRITICAL SYSTEM WARNING]: Execution was preemptively interrupted to prevent a system timeout. Answer based ONLY on the partial results gathered so far.";
    }

    const synthesizePrompt = `
[SYSTEM: FINAL SYNTHESIS]
Original User Prompt: "${prompt}"

Gathered Execution Data:
${JSON.stringify(taskResults, null, 2)}
${timeWarning}

Objective:
1. Formulate a comprehensive, natural response to the user based exclusively on the gathered data.
2. If tasks partially failed, transparently state what succeeded and what could not be completed.
3. CRITICAL: Append an "Execution Summary" at the very end of your response detailing the capabilities used, execution order, duration (ms), and prompts. If no capabilities were used, explicitly state "NO capabilities were used".
`;

    const synthConfig = {
      apiKey: this.apiKey,
      model: this.model,
      history: this.history,
      systemInstruction: { parts: [{ text: globalInstruction }] },
    };
    if (this.outputSchema) synthConfig.responseSchema = this.outputSchema;
    if (this.generateContentConfig)
      synthConfig.generationConfig = this.generateContentConfig;

    const finalAnswer = new GeminiWithFiles(synthConfig).generateContent({
      q: synthesizePrompt,
    });

    log("Final synthesis complete.");
    this.history.push({ role: "user", parts: [{ text: prompt }] });
    this.history.push({
      role: "model",
      parts: [
        {
          text:
            typeof finalAnswer === "string"
              ? finalAnswer
              : JSON.stringify(finalAnswer),
        },
      ],
    });

    return finalAnswer;
  }
};
