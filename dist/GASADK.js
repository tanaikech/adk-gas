/**
 * LlmAgent.js
 * [Production Release v1.3.3] - The Ultimate Autonomous Orchestrator with Multi-Channel Logging
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


/**
 * GeminiWithFiles
 * Author: Kanshi Tanaike
 * Version: 2.0.30
 * GitHub: https://github.com/tanaikech/GeminiWithFiles
 * @class
 */
var GeminiWithFiles = class GeminiWithFiles {
  constructor(object = {}) {
    const {
      apiKey,
      accessToken,
      model,
      version,
      doCountToken,
      history,
      functions,
      response_mime_type,
      responseMimeType,
      response_schema = null,
      responseSchema = null,
      response_json_schema = null,
      responseJsonSchema = null,
      temperature = null,
      systemInstruction,
      exportTotalTokens,
      exportRawData,
      toolConfig,
      tools,
      propertiesService,
      resumableUploadAsNewUpload = false,
      generationConfig = {},
      skillFolderId,
    } = object;

    // Updated default model to models/gemini-3.1-flash-lite
    this.model = model || "models/gemini-3.1-flash-lite";
    this.version = version || "v1beta";

    const baseUrl = "https://generativelanguage.googleapis.com";
    this.urlGenerateContent = `${baseUrl}/${this.version}/${this.model}:generateContent`;
    this.urlBatchGenerateContent = `${baseUrl}/${this.version}/${this.model}:batchGenerateContent`;
    this.urlUploadFile = `${baseUrl}/upload/${this.version}/files`;
    this.urlGetFileList = `${baseUrl}/${this.version}/files`;
    this.urlDeleteFile = `${baseUrl}/${this.version}/`;
    this.urlCountToken = `${baseUrl}/${this.version}/${this.model}:countTokens`;

    this.doCountToken = doCountToken || false;
    this.exportTotalTokens = exportTotalTokens || false;
    this.exportRawData = exportRawData || false;

    this.queryParameters = apiKey ? { key: apiKey } : {};
    this.accessToken = accessToken || ScriptApp.getOAuthToken();
    this.headers = { authorization: `Bearer ${this.accessToken}` };

    this.fileIds = [];
    this.asImage = false;
    this.blobs = [];
    this.resumableUploads = [];
    this.fileList = [];

    this.skillFolderId = skillFolderId || null;

    this.response_mime_type = response_mime_type || responseMimeType || "";
    this.response_schema = response_schema || responseSchema || null;
    this.response_json_schema =
      response_json_schema || responseJsonSchema || null;
    this.temperature = temperature ?? null;

    this.functions = functions?.params_ ? functions : {};
    if (this.functions && !this.functions.params_) this.functions.params_ = {};

    if (this.skillFolderId) {
      this.functions.params_.activate_skill = {
        description:
          "Activate a specific skill and get detailed instructions and a list of resources. Call this first if you need a skill for the task.",
        parameters: {
          type: "object",
          properties: { skillName: { type: "string" } },
          required: ["skillName"],
        },
      };
      this.functions.activate_skill = (args) =>
        this._activateSkill(args.skillName);

      this.functions.params_.read_skill_resource = {
        description:
          "Read the contents of a resource file (e.g., template) in a skill.",
        parameters: {
          type: "object",
          properties: {
            skillName: { type: "string" },
            fileName: { type: "string" },
          },
          required: ["skillName", "fileName"],
        },
      };
      this.functions.read_skill_resource = (args) =>
        this._readSkillResource(args.skillName, args.fileName);

      this.functions.params_.run_dynamic_script = {
        description:
          "Executes a dynamic JavaScript file from the skill resources.",
        parameters: {
          type: "object",
          properties: {
            skillName: { type: "string" },
            scriptName: { type: "string" },
            argsJSON: { type: "string" },
          },
          required: ["skillName", "scriptName", "argsJSON"],
        },
      };
      this.functions.run_dynamic_script = (args) =>
        this._runDynamicScript(args.skillName, args.scriptName, args.argsJSON);

      this.functions.params_.invoke_agent = {
        description: "Delegates a sub-task to a specialized subagent.",
        parameters: {
          type: "object",
          properties: {
            agent_name: { type: "string" },
            prompt: { type: "string" },
          },
          required: ["agent_name", "prompt"],
        },
      };
      this.functions.invoke_agent = (args) =>
        this._invokeAgent(args.agent_name, args.prompt);

      let systemInstructionText = "";
      if (systemInstruction) {
        if (typeof systemInstruction === "string") {
          systemInstructionText = systemInstruction + "\n\n";
        } else if (
          systemInstruction.parts &&
          Array.isArray(systemInstruction.parts)
        ) {
          systemInstructionText =
            systemInstruction.parts.map((p) => p.text || "").join("\n") +
            "\n\n";
        }
      }

      const skills = this._discoverSkills();
      const skillList = Object.values(skills)
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n");
      systemInstructionText += `You are a highly capable AI agent. To solve the user's request, the following skills are available.\n\n[Available Skills]\n${skillList}\n\nCall 'activate_skill' if necessary to reveal detailed instructions for a skill. You can also use 'invoke_agent' to delegate sub-tasks to specialized subagents. Respond directly to the user after using tools.`;

      this.systemInstruction = {
        parts: [{ text: systemInstructionText.trim() }],
      };
    } else {
      this.systemInstruction = systemInstruction || null;
    }

    this.toolConfig = toolConfig ? JSON.parse(JSON.stringify(toolConfig)) : {};
    this.history = history || [];
    this.tools = tools || [];
    this.propertiesService = propertiesService;
    this.resumableUploadAsNewUpload = resumableUploadAsNewUpload;
    this.generationConfig = generationConfig || {};
  }

  setFileIds(fileIds, asImage = false) {
    this.fileIds.push(...fileIds);
    this.asImage = asImage;
    return this;
  }

  setBlobs(blobs) {
    this.blobs.push(...blobs);
    return this;
  }

  setFileIdsOrUrlsWithResumableUpload(array) {
    this.resumableUploads.push(...array);
    return this;
  }

  /**
   * Helper method to extract the original filename from a Gemini File API displayName.
   * Removes 'fileId@' or 'blobName@' prefixes and '$page@X$maxPage@Y' suffixes safely.
   */
  _extractOriginalFilename(displayName) {
    if (!displayName) return "unknown_file";
    const match = displayName.match(
      /^(?:fileId|blobName)@(.+?)(?:\$page@\d+\$maxPage@\d+)?$/,
    );
    return match && match[1] ? match[1] : displayName;
  }

  withUploadedFilesByGenerateContent(fileList = [], retry = 3) {
    if (!fileList.length) throw new Error("Given fileList is empty.");
    const checkState = fileList.filter(({ state }) => state === "PROCESSING");
    if (checkState.length > 0) {
      if (retry > 0) {
        Utilities.sleep(10000);
        const tempSet = new Set(fileList.map(({ name }) => name));
        const tempList = this.getFileList().filter(({ name }) =>
          tempSet.has(name),
        );
        return this.withUploadedFilesByGenerateContent(tempList, retry - 1);
      }
    }
    const obj = new Map();
    for (const e of fileList) {
      let k = this._extractOriginalFilename(e.displayName);
      if (obj.has(k)) obj.get(k).push(e);
      else obj.set(k, [e]);
    }
    this.fileList = Array.from(obj.values()).map((files) => {
      // Only sort if there are multiple parts matching the PDF page convention
      if (
        files.length > 1 &&
        files[0].displayName.match(/\$page@\d+\$maxPage@\d+$/)
      ) {
        files.sort((a, b) => {
          const getPage = (name) => {
            const m = name.match(/\$page@(\d+)/);
            return m ? Number(m[1]) : 0;
          };
          return getPage(a.displayName) - getPage(b.displayName);
        });
      }
      return { files };
    });
    return this;
  }

  uploadFiles(n = 50) {
    if (this.resumableUploads.length > 0)
      return this.resumableUploads.map((e) => this.uploadApp_(e));
    throw new Error("No upload items.");
  }

  getFileList() {
    const fileList = [];
    const q = { ...this.queryParameters, pageSize: 100 };
    let pageToken = "";
    do {
      if (pageToken) q.pageToken = pageToken;
      const url = this.addQueryParameters_(this.urlGetFileList, q);
      const res = this.fetch_({
        url,
        ...(this.queryParameters.key ? {} : { headers: this.headers }),
      });
      const obj = JSON.parse(res.getContentText());
      pageToken = obj.nextPageToken || "";
      if (obj.files && obj.files.length > 0) fileList.push(...obj.files);
    } while (pageToken);
    return fileList;
  }

  deleteFiles(names, n = 50) {
    if (!names.length) return [];
    const requests = names.map((name) => ({
      url:
        `${this.urlDeleteFile}${name}` +
        (this.queryParameters.key ? `?key=${this.queryParameters.key}` : ""),
      method: "delete",
      ...(this.queryParameters.key ? {} : { headers: this.headers }),
      muteHttpExceptions: true,
    }));
    const results = [];
    for (let i = 0; i < Math.ceil(requests.length / n); i++) {
      UrlFetchApp.fetchAll(requests.slice(i * n, (i + 1) * n)).forEach(
        (r) =>
          r.getContentText() && results.push(JSON.parse(r.getContentText())),
      );
    }
    return results;
  }

  generateContent(object, retry) {
    if (!object || typeof object !== "object")
      throw new Error("Please set object including question.");
    if (retry === undefined) retry = this.skillFolderId ? 15 : 5;

    let { q, jsonSchema, parts } = object;
    if (!q && !jsonSchema && (!parts || !Array.isArray(parts)))
      throw new Error("Please set a question.");
    if (!q && jsonSchema && !parts)
      q = `Follow JSON schema.<JSONSchema>${JSON.stringify(jsonSchema)}</JSONSchema>`;

    // Sanitize parameters to avoid INVALID_ARGUMENT crashes caused by empty required arrays.
    const function_declarations = Object.entries(this.functions).reduce(
      (acc, [k, v]) => {
        if (k !== "params_") {
          let parameters = this.functions.params_[k]?.parameters;
          if (
            parameters &&
            Array.isArray(parameters.required) &&
            parameters.required.length === 0
          ) {
            parameters = { ...parameters };
            delete parameters.required;
          }
          acc.push({
            name: k,
            description: this.functions.params_[k]?.description,
            parameters: parameters,
          });
        }
        return acc;
      },
      [],
    );

    const files = this.fileList.flatMap(({ files, mimeType, uri, name }) => {
      if (files && Array.isArray(files)) {
        let fileName = this._extractOriginalFilename(files[0].displayName);
        return [
          {
            text: `[Filename of the following file is ${fileName}. Total pages are ${files.length}.]`,
          },
          ...files.map((f) => ({
            fileData: { fileUri: f.uri, mimeType: f.mimeType },
          })),
        ];
      }
      return [
        {
          text: `[Filename of the following file is ${name}. Total pages are 1.]`,
        },
        { fileData: { fileUri: uri, mimeType } },
      ];
    });

    const contents = [...this.history];
    if (!q && !jsonSchema && parts)
      contents.push({ parts: [...parts, ...files], role: "user" });
    else contents.push({ parts: [{ text: q }, ...files], role: "user" });

    let check = [];
    let usageMetadataObj;
    let results = [];
    let rawResult = {};
    let multipleResults = false;
    let continueLoop = false;
    let toolCallHistory = new Set();
    let forceHaltResult = null;

    const url = this.addQueryParameters_(
      this.urlGenerateContent,
      this.queryParameters,
    );
    const requestHeaders = this.queryParameters.key
      ? {}
      : { headers: this.headers };

    const formatReturnValue = (val) => {
      if (!this.exportTotalTokens) return val;
      return {
        returnValue: val,
        usageMetadata: usageMetadataObj,
        inputTokenCount: usageMetadataObj?.promptTokenCount || 0,
        outputTokenCount: usageMetadataObj?.candidatesTokenCount || 0,
        totalTokenCount: usageMetadataObj?.totalTokenCount || 0,
      };
    };

    do {
      retry--;
      const payload = { contents };
      const toolsArray = [];

      if (function_declarations.length > 0)
        toolsArray.push({ function_declarations });
      if (this.tools && this.tools.length > 0) toolsArray.push(...this.tools);
      if (toolsArray.length > 0) payload.tools = toolsArray;

      payload.generationConfig = { ...this.generationConfig };
      if (this.response_mime_type)
        payload.generationConfig.response_mime_type = this.response_mime_type;
      if (this.response_schema) {
        payload.generationConfig.response_schema = this.response_schema;
        payload.generationConfig.response_mime_type = "application/json";
      }
      if (this.temperature !== null)
        payload.generationConfig.temperature = this.temperature;
      if (this.systemInstruction)
        payload.systemInstruction = this.systemInstruction;

      let currentToolConfig = { ...this.toolConfig };
      if (
        function_declarations.length > 0 ||
        (this.tools && this.tools.length > 0)
      ) {
        currentToolConfig.functionCallingConfig =
          currentToolConfig.functionCallingConfig || { mode: "AUTO" };
        if (
          function_declarations.length > 0 &&
          this.tools &&
          this.tools.length > 0
        ) {
          currentToolConfig.includeServerSideToolInvocations = true;
          currentToolConfig.include_server_side_tool_invocations = true;
        }
      }
      if (Object.keys(currentToolConfig).length > 0)
        payload.toolConfig = currentToolConfig;

      const res = this.fetch_(
        {
          url,
          method: "post",
          payload: JSON.stringify(payload),
          contentType: "application/json",
          ...requestHeaders,
          muteHttpExceptions: true,
        },
        false,
      );
      const code = res.getResponseCode();

      if ([500, 502, 503, 429].includes(code) && retry > 0) {
        console.warn(
          `[GeminiWithFiles] Caught HTTP ${code}. Retrying in 3 seconds...`,
        );
        Utilities.sleep(3000);
        return this.generateContent({ q, jsonSchema, parts }, retry);
      } else if (code !== 200) {
        throw new Error(`[Gemini API Error] ${res.getContentText()}`);
      }

      const raw = JSON.parse(res.getContentText());
      rawResult = raw;
      const { candidates, usageMetadata } = raw;
      usageMetadataObj = usageMetadata;

      if (!candidates || candidates.length === 0) break;
      const candidate = candidates[0];

      // === SMART RECOVERY & HALLUCINATION PREVENTION ===
      if (
        candidate.finishReason === "MALFORMED_FUNCTION_CALL" &&
        candidate.finishMessage
      ) {
        const msg = candidate.finishMessage;
        const match = msg.match(/([A-Za-z0-9_]+)\s*(\{(?:.|\n)*\})/);
        if (match) {
          let fnName = match[1];
          let argStr = match[2];
          argStr = argStr.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
          argStr = argStr.replace(/'/g, '"');

          try {
            const argsObj = JSON.parse(argStr);
            console.warn(
              `[GeminiWithFiles] Recovered from MALFORMED_FUNCTION_CALL. Attempting implicit execution of ${fnName}...`,
            );

            if (fnName.startsWith("google_interpreter_"))
              fnName = fnName.replace("google_interpreter_", "");
            const sig = `${fnName}::${JSON.stringify(argsObj)}`;
            let res2;

            if (toolCallHistory.has(sig)) {
              res2 = `[System Intervention] You have already executed '${fnName}' with these exact arguments. Do not repeat. Provide your final answer.`;
            } else if (typeof this.functions[fnName] !== "function") {
              const available = Object.keys(this.functions)
                .filter((k) => k !== "params_")
                .join(", ");
              res2 = `[System Intervention] The tool '${fnName}' does not exist. Available tools are: [${available}]. DO NOT hallucinate or invent function names. Please select a valid tool from the list or respond directly if no tool is applicable.`;
            } else {
              toolCallHistory.add(sig);
              try {
                res2 = this.functions[fnName](argsObj);
              } catch (err) {
                res2 = `[System Intervention] Error: ${err.message}`;
              }
            }

            contents.push({
              parts: [
                {
                  text: `[System Recovery] Attempted to implicitly execute function '${fnName}'. Result:\n${res2}`,
                },
              ],
              role: "user",
            });
            this.history = contents;
            continueLoop = true;

            if (this.toolConfig?.functionCallingConfig?.mode === "any") {
              this.toolConfig.functionCallingConfig.mode = "AUTO";
              delete this.toolConfig.functionCallingConfig.allowedFunctionNames;
            }
            continue;
          } catch (e) {
            console.warn(
              `[GeminiWithFiles] Failed to recover malformed arguments: ${e.message}`,
            );
          }
        }
      }

      if (!candidate.content?.parts) {
        results.push(candidate);
        break;
      }

      const partsAr = candidate.content.parts;
      results.push(...partsAr);
      contents.push({ parts: [...partsAr], role: "model" });

      check = partsAr.filter((pp) => pp.functionCall?.name);
      continueLoop = false;
      let hasCodeExecutionResult = partsAr.some((pp) => pp.codeExecutionResult);
      let hasText = partsAr.some((pp) => pp.text);

      if (check.length > 0) {
        if (check.length > 1) multipleResults = true;

        let hallucinationOccurred = false;
        for (const chk of check) {
          let functionName = chk.functionCall.name;
          if (functionName.includes(":"))
            functionName = functionName.split(":").pop();
          if (functionName.startsWith("google_interpreter_"))
            functionName = functionName.replace("google_interpreter_", "");

          if (typeof this.functions[functionName] !== "function") {
            hallucinationOccurred = true;
          }
        }

        if (hallucinationOccurred) {
          console.warn(
            "[GeminiWithFiles] Hallucination detected. A requested function does not exist.",
          );
          const available = Object.keys(this.functions)
            .filter((k) => k !== "params_")
            .join(", ");

          const lastModelMsg = contents[contents.length - 1];
          if (lastModelMsg && lastModelMsg.role === "model") {
            lastModelMsg.parts = lastModelMsg.parts.map((p) => {
              if (p.functionCall) {
                let fName = p.functionCall.name;
                if (fName.includes(":")) fName = fName.split(":").pop();
                if (fName.startsWith("google_interpreter_"))
                  fName = fName.replace("google_interpreter_", "");
                if (typeof this.functions[fName] !== "function") {
                  return {
                    text: `[Model attempted to call non-existent function: ${fName}]`,
                  };
                }
              }
              return p;
            });
          }

          contents.push({
            role: "user",
            parts: [
              {
                text: `[System Intervention] You attempted to use a function that does not exist. Available tools are: [${available}]. DO NOT hallucinate or invent function names. Try again.`,
              },
            ],
          });

          this.history = contents;
          continueLoop = true;

          if (this.toolConfig?.functionCallingConfig?.mode === "any") {
            this.toolConfig.functionCallingConfig.mode = "AUTO";
            delete this.toolConfig.functionCallingConfig.allowedFunctionNames;
          }
          continue;
        }

        const partss = [];
        for (const chk of check) {
          let functionName = chk.functionCall.name;
          if (functionName.includes(":"))
            functionName = functionName.split(":").pop();
          if (functionName.startsWith("google_interpreter_"))
            functionName = functionName.replace("google_interpreter_", "");

          const argsObj = chk.functionCall.args || null;
          const sig = `${functionName}::${JSON.stringify(argsObj)}`;
          let res2;

          if (toolCallHistory.has(sig)) {
            console.warn(
              `[GeminiWithFiles] Loop detected. Prevented duplicate call to '${functionName}'.`,
            );
            res2 = `[System Intervention] You have already executed '${functionName}' with these exact arguments. Do not repeat this action. Please synthesize and provide your final answer immediately.`;
          } else {
            toolCallHistory.add(sig);
            try {
              res2 = this.functions[functionName](argsObj);
            } catch (err) {
              res2 = `[System Intervention] The tool '${functionName}' encountered an execution error: ${err.message}.`;
            }
          }

          // === DYNAMIC HALT SIGNAL ===
          if (res2 && typeof res2 === "object" && res2._gemini_halt) {
            forceHaltResult = res2;
            partss.push({
              functionResponse: {
                name: functionName,
                response: { name: functionName, content: res2 },
                ...(chk.functionCall.id ? { id: chk.functionCall.id } : {}),
              },
            });
            break;
          }

          if (
            functionName.startsWith("customType_") &&
            typeof this.functions[functionName] === "function"
          ) {
            if (res2?.items && Object.keys(res2).length === 1)
              return res2.items;
            if (
              Array.isArray(res2) &&
              res2.every((e) => e?.items && Object.keys(e).length === 1)
            )
              return res2.map((e) => e.items);
            return res2;
          }

          partss.push({
            functionResponse: {
              name: functionName,
              response: { name: functionName, content: res2 },
              ...(chk.functionCall.id ? { id: chk.functionCall.id } : {}),
            },
          });
        }

        contents.push({ parts: partss, role: "function" });
        this.history = contents;

        if (forceHaltResult) {
          continueLoop = false;
        } else {
          continueLoop = true;
          if (this.toolConfig?.functionCallingConfig?.mode === "any") {
            this.toolConfig.functionCallingConfig.mode = "AUTO";
            delete this.toolConfig.functionCallingConfig.allowedFunctionNames;
          }
        }
      } else if (hasCodeExecutionResult && !hasText) {
        this.history = contents;
        contents.push({
          role: "user",
          parts: [
            {
              text: "Please provide the final answer based on the code execution result.",
            },
          ],
        });
        continueLoop = true;
      } else {
        this.history = contents;
        continueLoop = false;
      }
    } while (continueLoop && retry > 0);

    if (this.exportRawData) return rawResult;
    if (continueLoop && retry <= 0)
      throw new Error(
        "[GeminiWithFiles Error] Maximum retry limit exceeded. The model got stuck in an unresolvable loop.",
      );

    if (forceHaltResult) {
      return formatReturnValue(forceHaltResult);
    }

    const output = results[results.length - 1];
    if (
      !output ||
      (output.finishReason &&
        ["OTHER", "RECITATION"].includes(output.finishReason))
    )
      return "No values.";

    let returnValue = multipleResults
      ? results.filter((pp) => pp.functionResponse)
      : output.text
        ? output.text.trim()
        : output;

    let parsedReturnValue;
    try {
      parsedReturnValue = JSON.parse(returnValue);
    } catch (stack) {
      parsedReturnValue = returnValue;
    }

    return formatReturnValue(parsedReturnValue);
  }

  chat(obj, options = {}) {
    this.exportRawData = true;
    for (const [k, v] of Object.entries(options)) {
      if (this[k] !== undefined) this[k] = v;
    }
    return this.generateContent(obj);
  }

  _discoverSkills() {
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(`agent_skills_${this.skillFolderId}`);
    if (cachedData) return JSON.parse(cachedData);
    const folder = DriveApp.getFolderById(this.skillFolderId);
    const folders = folder.getFolders();
    const skills = {};
    while (folders.hasNext()) {
      const subFolder = folders.next();
      const files = subFolder.getFilesByName("SKILL.md");
      if (files.hasNext()) {
        const content = files.next().getBlob().getDataAsString();
        const parsed = this._parseSkillMd(content);
        if (parsed)
          skills[parsed.name] = {
            name: parsed.name,
            description: parsed.description,
            instructions: parsed.instructions,
            folderId: subFolder.getId(),
          };
      }
    }
    const txtFiles = folder.getFilesByType(MimeType.PLAIN_TEXT);
    while (txtFiles.hasNext()) {
      const txtFile = txtFiles.next();
      if (txtFile.getName().endsWith(".txt")) {
        const name = txtFile.getName().replace(".txt", "");
        const content = txtFile.getBlob().getDataAsString();
        skills[name] = {
          name: name,
          description: content.substring(0, 150),
          instructions: content,
          folderId: folder.getId(),
        };
      }
    }
    cache.put(
      `agent_skills_${this.skillFolderId}`,
      JSON.stringify(skills),
      3600,
    );
    return skills;
  }

  _activateSkill(skillName) {
    const skills = this._discoverSkills();
    const skill = skills[skillName];
    if (!skill) return `[Error] Skill '${skillName}' not found.`;
    const files = DriveApp.getFolderById(skill.folderId).getFiles();
    const fileNames = [];
    while (files.hasNext()) fileNames.push(files.next().getName());
    return `[System: Skill Activated]\nInstructions:\n${skill.instructions}\n\nAvailable Resources (Files):\n${fileNames.join(", ")}`;
  }

  _readSkillResource(skillName, fileName) {
    const skills = this._discoverSkills();
    const skill = skills[skillName];
    if (!skill) return `[Error] Skill '${skillName}' not found.`;
    const files = DriveApp.getFolderById(skill.folderId).getFilesByName(
      fileName,
    );
    if (!files.hasNext())
      return `[Error] File '${fileName}' not found in skill '${skillName}'.`;
    return files.next().getBlob().getDataAsString();
  }

  _runDynamicScript(skillName, scriptName, argsJSON) {
    const scriptContent = this._readSkillResource(skillName, scriptName);
    if (scriptContent.startsWith("[Error]")) return scriptContent;
    try {
      const parsedArgs =
        typeof argsJSON === "string" ? JSON.parse(argsJSON) : argsJSON;
      const executableFunc = new Function("args", scriptContent);
      return executableFunc(parsedArgs);
    } catch (e) {
      return `Script Execution Error: ${e.message}`;
    }
  }

  _invokeAgent(agentName, prompt) {
    const skills = this._discoverSkills();
    const subSkill = skills[agentName];
    if (!subSkill) return `[Error] Subagent skill '${agentName}' not found.`;
    try {
      const subagentSystemInstruction = `[SUBAGENT ROLE: ${agentName}]\nInstructions for this role:\n${subSkill.instructions}\n\n`;
      const options = {
        model: this.model,
        version: this.version,
        systemInstruction: subagentSystemInstruction,
        skillFolderId: this.skillFolderId,
        propertiesService: this.propertiesService,
        temperature: this.temperature,
        generationConfig: this.generationConfig,
      };
      if (this.queryParameters.key) options.apiKey = this.queryParameters.key;
      if (this.accessToken && !this.queryParameters.key)
        options.accessToken = this.accessToken;
      const subagent = new GeminiWithFiles(options);
      const res = subagent.generateContent({ q: prompt });
      return typeof res === "string" ? res : JSON.stringify(res);
    } catch (e) {
      return `[Error] Subagent execution failed: ${e.message}`;
    }
  }

  _parseSkillMd(content) {
    const normalized = content.replace(/\r\n/g, "\n");
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;
    const yaml = match[1];
    const nameMatch = yaml.match(/name:\s*(.+)/);
    const descMatch = yaml.match(/description:\s*(.+)/);
    return {
      name: nameMatch ? nameMatch[1].trim() : "unknown",
      description: descMatch ? descMatch[1].trim() : "",
      instructions: match[2].trim(),
    };
  }

  addQueryParameters_(url, obj) {
    if (!url) return "";
    const params = Object.entries(obj)
      .flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((e) => `${k}=${encodeURIComponent(e)}`)
          : `${k}=${encodeURIComponent(v)}`,
      )
      .join("&");
    return params ? `${url}?${params}` : url;
  }

  fetch_(obj, checkError = true) {
    obj.muteHttpExceptions = true;
    const res = UrlFetchApp.fetchAll([obj])[0];
    if (checkError && res.getResponseCode() !== 200)
      throw new Error(res.getContentText());
    return res;
  }
};


/**
 * This is for debug.
 */
const forDebug = false; // If this is true, a log is output.
const toLog_ = (kind, text) => {
  const spreadsheetId = "###";
  const sheetName = "rawA2AAppLog";
  const sheet =
    SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (sheet) {
    sheet.appendRow([new Date(), kind, text]);
  }
};

/**
 * Class object for A2AApp.
 * This is used for building both an Agent2Agent (A2A) server and an A2A client with Google Apps Script.
 *
 * ### Usage Example
 * ```javascript
 * const agentCardUrls = [
 *   "https://public.agent.com",
 *   { "secure-agent": { "httpUrl": "https://secure.agent.com", "headers": { "X-Agent-Key": "my-secret" } } }
 * ];
 *
 * const app = new A2AApp({ model: "models/gemini-3-flash-preview" });
 * app.setServices({ lock: LockService.getScriptLock() });
 *
 * // --- Chat History Example ---
 * app.setHistory([
 *   { role: "user", parts: [{ text: "Hello, remember that I like apples." }] },
 *   { role: "model", parts: [{ text: "I will remember that you like apples." }] }
 * ]);
 *
 * const response = app.client({
 *   apiKey: "YOUR_GEMINI_API_KEY",
 *   prompt: "Ask the agent what my favorite fruit is.",
 *   agentCardUrls: agentCardUrls
 * });
 * console.log(response.result);
 * ```
 *
 * ### Important Note
 * If this script is used as a server (Web App), you MUST create a "New Deployment"
 * after updating the code. Otherwise, the old cached script will be executed.
 *
 * ### Execution Phases Logged:
 * - [Phase 1: Concurrency Control] LockService limits concurrent overlaps.
 * - [Phase 2: Agent Discovery] Retrieving `.well-known/agent-card.json`.
 * - [Phase 3: Tool Proxying] Dynamic schema conversion to Function Calling formats.
 * - [Phase 4: Planning] Gemini acts as a delegator to determine sequential routing.
 * - [Phase 5: Sequential Execution] Executing functions sequentially with forced routing.
 * - [Phase 6: Data Materialization] Isolating textual output from file blobs.
 * - [Phase 7: Final Synthesis] Generating the ultimate summarized response and Clean History.
 *
 * Author: Kanshi Tanaike
 * Refactored by: Senior Generative AI & MCP Expert
 * Version: 2.7.0 (Direct JSON-RPC Bypass Optimization)
 * GitHub: https://github.com/tanaikech/A2AApp
 * @class
 */
var A2AApp = class A2AApp {
  /**
   * @param {Object} object Configuration object.
   * @param {String} [object.accessKey] Access key for A2A server (optional).
   * @param {Boolean} [object.log] Enable logging to Google Sheets (default: false).
   * @param {String} [object.spreadsheetId] Spreadsheet ID for logs.
   * @param {String} [object.model] Model name (default: "models/gemini-3-flash-preview").
   */
  constructor(object = {}) {
    const { accessKey = null, log = false, spreadsheetId, model } = object;

    /** @private */
    this.accessKey = accessKey;

    /** @private */
    this.model = model || "models/gemini-3-flash-preview";

    /** @private */
    this.jsonrpc = "2.0";

    /** @private */
    this.date = new Date();

    /** @private */
    this.timezone = Session.getScriptTimeZone();

    /** @private */
    this.log = log;

    /** @private Context flag to dynamically adjust log direction values ("server" or "client") */
    this.contextType = "unknown";

    /** @private Chat history initialized array */
    this.history = [];

    if (this.log) {
      const ss = spreadsheetId
        ? SpreadsheetApp.openById(spreadsheetId)
        : SpreadsheetApp.create("Log_A2AApp");
      /** @private */
      this.sheet = ss.getSheetByName("log") || ss.insertSheet("log");
    }

    /** @private */
    this.values = [];

    /** @private */
    this.headers = { authorization: `Bearer ${ScriptApp.getOAuthToken()}` };

    /**
     * TaskState Enum
     * Ref: https://google.github.io/A2A/specification/#63-taskstate-enum
     * @private
     */
    this.TaskState = {
      submitted: "submitted",
      working: "working",
      input_required: "input-required",
      completed: "completed",
      canceled: "canceled",
      failed: "failed",
      unknown: "unknown",
    };

    /**
     * Error codes.
     * Ref: https://google.github.io/A2A/specification/#8-error-handling
     * @private
     */
    this.ErrorCode = {
      "Invalid JSON payload": -32700,
      "Invalid JSON-RPC Request": -32600,
      "Method not found": -32601,
      "Invalid method parameters": -32602,
      "Internal server error": -32603,
      "(Server-defined)": -32000,
      "Task not found": -32001,
      "Task cannot be canceled": -32002,
      "Push Notification is not supported": -32003,
      "This operation is not supported": -32004,
      "Incompatible content types": -32005,
      "Streaming is not supported": -32006,
      "Authentication required": -32007,
      "Authorization failed": -32008,
      "Invalid task state for operation": -32009,
      "Rate limit exceeded": -32010,
      "A required resource is unavailable": -32011,
    };

    // Initialize lock service (can be overridden by setServices)
    this.lock = this.lock || LockService.getScriptLock();
    this.properties =
      this.properties || PropertiesService.getScriptProperties();
  }

  /**
   * Set services dependent on each script.
   *
   * @param {Object} services Object containing services.
   * @param {GoogleAppsScript.Lock.Lock} services.lock Lock service instance.
   * @param {GoogleAppsScript.Properties.Properties} services.properties Properties service instance.
   * @return {A2AApp}
   */
  setServices(services) {
    const { lock, properties } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    if (properties && properties.toString() === "Properties") {
      this.properties = properties;
    }
    return this;
  }

  /**
   * Sets the conversation history for the agent.
   * This allows the agent to maintain context across multiple interactions in a chat environment.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {A2AApp} This agent instance for chaining.
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
    return this.history || [];
  }

  /**
   * Method for the A2A server side logic.
   *
   * @param {Object} object Parameters object.
   * @param {Object} object.eventObject Event object from doPost/doGet.
   * @param {String} object.apiKey API key for Gemini.
   * @param {Function} object.agentCard Getter function for agent card object.
   * @param {Function} object.functions Getter function for functions object.
   * @return {GoogleAppsScript.Content.TextOutput}
   */
  server(object = {}) {
    this.contextType = "server";
    console.log("--- Server side initialized");
    this.errorProcess_(object);
    let id = "No ID";
    const lock = this.lock;

    // [Phase 1: Concurrency Control] Server-side locking to prevent race conditions
    if (!lock.tryLock(350000)) {
      const msg =
        "[Phase 1: Concurrency Control] Timeout. Lock could not be acquired.";
      console.error(msg);
      return this.createErrorResponse_(
        `Internal server error. Error message: ${msg}`,
        id,
        "[Phase 1: Concurrency Control]",
      );
    }
    this.addLog_(
      new Date(),
      "[Phase 1: Concurrency Control]",
      id,
      "server internal",
      "Lock acquired successfully.",
    );

    try {
      const { eventObject, agentCardUrls = [], agentCards = [] } = object;
      const obj = eventObject.postData ? this.parseObj_(eventObject) : {};
      id = obj.id || "No ID";

      // [Phase 2: Agent Discovery] Handle Agent Card retrieval logic internally if URLs provided
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      const res = this.createResponse_({ ...object, obj, id });
      this.log_();
      return res;
    } catch (err) {
      console.error(err.stack);
      return this.createErrorResponse_(
        `Internal server error. Error message: ${err.stack}`,
        id,
        "Server Main Process",
      );
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Method for the A2A client side logic.
   *
   * @param {Object} object Parameters object.
   * @return {Object} Result object including result, history, and agentCards.
   */
  client(object = {}) {
    this.contextType = "client";
    console.log("--- Client side initialized");
    const lock = this.lock;

    // [Phase 1: Concurrency Control] Client-side locking
    if (!lock.tryLock(350000)) {
      const msg =
        "[Phase 1: Concurrency Control] Timeout. Lock could not be acquired.";
      console.error(msg);
      const errObj = {
        error: { message: `Internal server error. Error message: ${msg}` },
      };
      this.addLog_(
        new Date(),
        "[Phase 1: Concurrency Control]",
        null,
        "client internal",
        JSON.stringify(errObj),
      );
      this.log_();
      return errObj;
    }
    this.addLog_(
      new Date(),
      "[Phase 1: Concurrency Control]",
      null,
      "client internal",
      "Lock acquired successfully.",
    );

    try {
      // [Phase 2: Agent Discovery] Fetch Agent Cards
      const {
        agentCardUrls = [],
        agentCards = [],
        history = this.history || [],
        directRouting = false,
      } = object;
      object.history = history;
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      let res;
      // [Optimization v2.7.0]: If directRouting is flagged (via LlmAgent), cleanly bypass ALL LLM Mock Orchestration
      // and directly dispatch the JSON-RPC to the network layer.
      if (
        directRouting &&
        object.agentCards &&
        object.agentCards.length === 1
      ) {
        res = this.dispatchDirectRPC_(object);
      } else {
        res = this.processAgents_(object);
      }

      // Safe History Updating
      if (res && res.history) {
        this.history = res.history;
      }
      this.log_();
      return res;
    } catch (err) {
      console.error(err.stack);
      const errObj = {
        error: {
          message: `Internal server error. Error message: ${err.stack}`,
        },
      };
      this.addLog_(
        new Date(),
        "Client Main Process",
        null,
        "client internal",
        JSON.stringify(errObj),
      );
      this.log_();
      return errObj;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Validate required parameters.
   * @private
   */
  errorProcess_(object) {
    if (!object.eventObject) {
      throw new Error("Please set event object from doPost and doGet.");
    }
    if (!object.apiKey) {
      throw new Error("Please set your API key for using Gemini API.");
    }
  }

  /**
   * Helper: Add log entries to the queue seamlessly.
   * @private
   */
  addLog_(date, phaseOrMethod, id, direction, message) {
    if (this.log) {
      this.values.push([
        date,
        phaseOrMethod || "",
        id || "",
        direction || "",
        message,
      ]);
    }
  }

  /**
   * Helper: Create formatted Server Error Response.
   * @private
   */
  createErrorResponse_(message, id, phaseOrMethod) {
    const errObj = {
      jsonrpc: this.jsonrpc,
      error: { code: this.ErrorCode["Internal server error"], message },
      id,
    };
    this.addLog_(
      new Date(),
      phaseOrMethod || "Error Response",
      id,
      "server --> client",
      JSON.stringify(errObj),
    );
    this.log_();
    return this.createContent_(errObj);
  }

  /**
   * Create response for the server operations.
   * @private
   */
  createResponse_(object) {
    const {
      eventObject,
      apiKey,
      agentCard,
      functions,
      agentCards = [],
      obj,
      id,
    } = object;
    const { pathInfo, parameter } = eventObject;

    // [Phase 2: Agent Discovery] Handle Discovery (Agent Card request from client)
    if (
      pathInfo === ".well-known/agent.json" ||
      pathInfo === ".well-known/agent-card.json"
    ) {
      this.addLog_(
        new Date(),
        "[Phase 2: Agent Discovery]",
        id,
        "client --> server",
        "Received request for Agent Card.",
      );
      if (typeof agentCard !== "function") {
        throw new Error("Agent card was not found or is not a function.");
      }
      const agentCardObj = agentCard();

      agentCards.forEach(
        ({
          description = "",
          skills = [],
          defaultInputModes = [],
          defaultOutputModes = [],
        }) => {
          if (description) agentCardObj.description += `\n${description}`;
          agentCardObj.skills.push(...skills);
          agentCardObj.defaultInputModes.push(...defaultInputModes);
          agentCardObj.defaultOutputModes.push(...defaultOutputModes);
        },
      );

      // De-duplicate using stringified comparisons for deep objects and Sets for primitives
      const uniqueSkills = new Map(
        agentCardObj.skills.map((s) => [JSON.stringify(s), s]),
      );
      agentCardObj.skills = Array.from(uniqueSkills.values());
      agentCardObj.defaultInputModes = [
        ...new Set(agentCardObj.defaultInputModes),
      ];
      agentCardObj.defaultOutputModes = [
        ...new Set(agentCardObj.defaultOutputModes),
      ];

      this.addLog_(
        new Date(),
        "[Phase 2: Agent Discovery]",
        id,
        "server --> client",
        JSON.stringify(agentCardObj),
      );
      return this.createContent_(agentCardObj);
    }

    if (!obj.method) return null;
    const method = obj.method.toLowerCase();

    // Log incoming payload as client --> server
    this.addLog_(
      new Date(),
      `RPC Method: ${method}`,
      id,
      "client --> server",
      JSON.stringify(obj),
    );

    // 2. Authentication Check
    if (this.accessKey && parameter.accessKey !== this.accessKey) {
      const errMsg = "Invalid accessKey.";
      console.warn(`--- Server Auth Error: ${errMsg}`);
      this.addLog_(new Date(), "Authentication", id, "server internal", errMsg);
      const errObj = {
        jsonrpc: this.jsonrpc,
        error: {
          code: this.ErrorCode["Authorization failed"],
          message: `Authorization failed. ${errMsg}`,
        },
        id,
      };
      this.addLog_(
        new Date(),
        "Authentication",
        id,
        "server --> client",
        JSON.stringify(errObj),
      );
      return this.createContent_(errObj);
    }

    // [Phases 3-7 triggered via processAgents_] Handle 'message/send' and 'tasks/send' seamlessly
    if ((method === "message/send" || method === "tasks/send") && functions) {
      if (typeof functions !== "function") {
        return this.createErrorResponse_(
          "Internal server error. Invalid functions.",
          id,
          method,
        );
      }

      try {
        const { params } = obj;
        const { message, history: clientHistory = [] } = params;
        const prompt = message?.parts?.[0]?.text || "";

        // Trigger the internal orchestration logic on the server side
        const orchestrationRes = this.processAgents_({
          apiKey,
          prompt,
          history: clientHistory,
          functions: functions(),
          fileAsBlob: true,
          agentCards,
        });

        // Guard against internal orchestration failures (e.g., LLM planning crash)
        if (orchestrationRes.error) {
          const errMsg =
            orchestrationRes.error.message ||
            "Internal server orchestration error.";
          console.error(`--- Server Process Error: ${errMsg}`);
          return this.createErrorResponse_(errMsg, id, method);
        }

        const { result, history } = orchestrationRes;
        const artifacts = [];
        const messageParts = [];

        // Distribute generated textual components and file references
        for (let i = 0; i < result.length; i++) {
          const e =
            typeof result[i] === "string"
              ? { type: "text", kind: "text", text: result[i] }
              : result[i];
          const type = e.type;

          if (type === "text") {
            const textPart = {
              type: "text",
              kind: "text",
              text: e[type] || e.text,
            };
            messageParts.push(textPart);
            artifacts.push({ name: "Answer", index: i, parts: [textPart] });
          } else {
            if (type !== "file" && type !== "data") {
              messageParts.push(e);
            } else {
              messageParts.push({
                type: "text",
                kind: "text",
                text: `The data "${e[type]?.name || "file"}" was downloaded.`,
              });
            }
            artifacts.push({ name: "Answer", index: i, parts: [e] });
          }
        }

        const resObj =
          method === "message/send"
            ? {
                jsonrpc: this.jsonrpc,
                result: {
                  kind: "message",
                  messageId: params.messageId,
                  parts: messageParts,
                  role: "agent",
                  history: history, // Provide updated CLEAN history state back to client
                },
                id,
              }
            : {
                jsonrpc: this.jsonrpc,
                result: {
                  kind: "task",
                  id: params.id,
                  sessionId: params.sessionId,
                  status: {
                    state: this.TaskState.completed,
                    message: { role: "agent", parts: messageParts },
                    timestamp: new Date().toISOString(),
                  },
                  artifacts,
                  history: history, // Provide updated CLEAN history state back to client
                },
                id,
              };

        // [Phase 7: Final Synthesis] Returning the final response structure to the calling client.
        this.addLog_(
          new Date(),
          "[Phase 7: Final Synthesis]",
          id,
          "server --> client",
          JSON.stringify(resObj),
        );
        return this.createContent_(resObj);
      } catch (err) {
        console.error(`--- Server Process Error: ${err.stack}`);
        return this.createErrorResponse_(
          `Internal server error. Error message: ${err.stack}`,
          id,
          method,
        );
      }
    }

    return null;
  }

  /**
   * Parse postData contents gracefully.
   * @private
   */
  parseObj_(e) {
    if (e?.postData?.contents) {
      try {
        return JSON.parse(e.postData.contents);
      } catch (err) {
        console.warn("--- Failed to parse postData contents.", err);
      }
    }
    return {};
  }

  /**
   * Create JSON TextOutput context.
   * @private
   */
  createContent_(data) {
    const d = typeof data === "object" ? JSON.stringify(data) : data;
    return ContentService.createTextOutput(d).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  /**
   * Persist queue logs to Google Spreadsheet en-masse.
   * @private
   */
  log_() {
    if (!this.log || !this.sheet || this.values.length === 0) return;
    try {
      const rows = this.values.map((r) =>
        r.map((c) => (typeof c === "string" ? c.substring(0, 40000) : c)),
      );
      this.sheet
        .getRange(this.sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
        .setValues(rows);
      this.values = [];
    } catch (err) {
      console.error("--- Failed to write to log sheet.", err);
    }
  }

  /**
   * [Direct Routing: Fast-Track JSON-RPC Dispatcher]
   * Radically optimized pipeline for execution when an Orchestrator explicitly assigns a specific target card.
   * Discards the massive overhead of Phase 3 to 7 LLM proxy emulation logic.
   * @private
   */
  dispatchDirectRPC_(object) {
    const { apiKey, prompt, agentCards, history = [] } = object;
    const targetAgent = agentCards[0];

    const phaseTag = "[Direct Routing: Fast-Track JSON-RPC]";
    console.log(
      `${phaseTag} Bypassing internal LLM orchestration to dispatch natively.`,
    );
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "client internal",
      `Target Agent Resolved: ${targetAgent.name || "Unknown Agent"}`,
    );

    const id1 = Utilities.newBlob(new Date().getTime().toString())
      .getBytes()
      .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
      .join("");
    const id2 = Utilities.getUuid();
    const id3 = Utilities.getUuid();

    const resObj = {
      jsonrpc: this.jsonrpc,
      id: id1,
      method: "tasks/send",
      params: {
        id: id2,
        sessionId: id3,
        message: {
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
        acceptedOutputModes: ["text", "text/plain"],
        history: history,
      },
    };

    const combinedHeaders = {
      ...this.headers,
      ...(targetAgent.customHeaders || {}),
    };

    const req = {
      url: targetAgent.url,
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(resObj),
      headers: combinedHeaders,
      muteHttpExceptions: true,
    };

    console.log(`${phaseTag} Dispatching request to: ${req.url}`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "client --> server",
      `JSON-RPC Payload dispatched.`,
    );

    const re = UrlFetchApp.fetch(req.url, req);
    const code = re.getResponseCode();
    const body = re.getContentText();

    console.log(`${phaseTag} Remote agent responded with HTTP Code: ${code}`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "server --> client",
      `Code: ${code}, Body: ${body.substring(0, 1500)}`,
    );

    let results = [];
    if (code === 200) {
      try {
        const oo = JSON.parse(body);
        if (oo.result && oo.result.status?.state === "completed") {
          const sArtifacts = (oo.result.artifacts || []).flatMap(
            ({ parts }) => parts,
          );
          const messageParts = oo.result.status.message?.parts || [];

          const uniqueTexts = new Set();
          const m = [...messageParts, ...sArtifacts].filter((part) => {
            if (part.type === "text") {
              const txt = part.text || "";
              if (uniqueTexts.has(txt)) return false;
              uniqueTexts.add(txt);
            }
            return true;
          });

          results = m.map((part) => part.text || part);
        } else if (oo.error) {
          results.push(
            `Error: Remote agent returned error: ${JSON.stringify(oo.error)}`,
          );
        } else {
          results.push(`Error: Invalid response structure. Body: ${body}`);
        }
      } catch (e) {
        results.push(`Error: Failed to parse JSON response. Body: ${body}`);
      }
    } else {
      results.push(`Error: Remote agent returned HTTP ${code}. Body: ${body}`);
    }

    const historyAnswerText = results
      .map((e) => (typeof e === "string" ? e : "[Binary Data]"))
      .join("\n");
    const cleanHistory = [...history];
    if (prompt) cleanHistory.push({ role: "user", parts: [{ text: prompt }] });
    if (historyAnswerText)
      cleanHistory.push({
        role: "model",
        parts: [{ text: historyAnswerText }],
      });

    console.log(`${phaseTag} Sequence completed successfully.`);
    return { result: results, history: cleanHistory, agentCards };
  }

  /**
   * [Phase 3: Tool Proxying] Prepare client-side functions inclusive of remote agents.
   * Incorporates detailed logging wrappers for introspection and injects custom headers for authenticated routing.
   * @private
   */
  getClientFunctions_(agentCards, addedFunctions, history = []) {
    const phaseTag = "[Phase 3: Tool Proxying]";
    console.log(`${phaseTag} Initiated capabilities mapping.`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      `${this.contextType} internal`,
      "Mapping capabilities into Function Calling schemas.",
    );

    let funcs = {
      params_: {
        without_agent: {
          description:
            "Use this, if the agent and other functions cannot resolve the tasks.",
          parameters: {
            type: "object",
            properties: {
              task: { type: "string", description: "Details of task." },
              response: {
                type: "string",
                description: "Response to the task.",
              },
            },
            required: ["task", "response"],
          },
        },
      },
      without_agent: ({ task, response }) => {
        const msgCall = `--- without_agent invoked. Prompt: ${task}`;
        console.log(msgCall);
        this.addLog_(
          new Date(),
          "[Phase 5: Sequential Execution]",
          null,
          `${this.contextType} internal`,
          msgCall,
        );
        return { task, result: response };
      },
    };

    // Integrate Discovered AI agents via dynamic schema proxying
    if (agentCards.length > 0) {
      agentCards.forEach(
        ({ name, description, url, provider, skills, customHeaders = {} }) => {
          // Add 'customType_' prefix to intentionally bypass GeminiWithFiles automatic loop execution.
          const safeName = "customType_" + name.replace(/ /g, "_");
          const skillStr = skills
            .map((o) => {
              const name = o.name || "no name";
              const description = o.description || "no description";
              const examples =
                o.examples && o.examples.length > 0
                  ? o.examples.join(", ")
                  : "no examples";

              return `id: ${o.id}, name: ${name}, description: ${description}, examples: ${examples}`;
            })
            .join(" | ");

          funcs.params_[safeName] = {
            description: [
              `Agent name: ${safeName}`,
              `Description: ${description}`,
              `URL: ${url}`,
              `Skills: ${skillStr}`,
              provider
                ? `Provider: ${provider.organization}, ${provider.url}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: {
              type: "object",
              properties: {
                agent_name: {
                  type: "string",
                  description: "Agent name you selected.",
                },
                agent_url: { type: "string", description: "URL of the agent." },
                task: {
                  type: "string",
                  description:
                    "Details of task. Give the suitable task to this agent.",
                },
              },
              required: ["agent_name", "agent_url", "task"],
            },
          };

          // Define proxy facade to safely remote trigger specific capabilities
          funcs[safeName] = (args) => {
            const { agent_name, agent_url, task } = args;
            const msgCall = `Agent Call proxy invoked: "${agent_name}" | Assigned Task: "${task}" | URL: ${agent_url}`;
            console.log(`[Phase 5: Sequential Execution] ${msgCall}`);
            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              `${this.contextType} internal`,
              msgCall,
            );

            const id1 = Utilities.newBlob(new Date().getTime().toString())
              .getBytes()
              .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
              .join("");
            const id2 = Utilities.getUuid();
            const id3 = Utilities.getUuid();

            const resObj = {
              jsonrpc: this.jsonrpc,
              id: id1,
              method: "tasks/send",
              params: {
                id: id2,
                sessionId: id3,
                message: {
                  role: "user",
                  parts: [{ type: "text", text: task }],
                },
                acceptedOutputModes: ["text", "text/plain"],
                history: history, // Injects context state natively into remote protocol requests
              },
            };

            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              "client --> server",
              `JSON-RPC Payload created: ${JSON.stringify(resObj)}`,
            );

            // Apply specific custom headers dynamically extracted from the normalization sequence
            const combinedHeaders = { ...this.headers, ...customHeaders };

            // Wrap response in 'items' pattern to enforce the immediate bypass strategy
            // and forcefully specify 'method' and 'contentType' to avoid invalid generic GET requests.
            return {
              items: {
                functionResponse: {
                  request: {
                    url: agent_url,
                    method: "post",
                    contentType: "application/json",
                    payload: JSON.stringify(resObj),
                    headers: combinedHeaders,
                    muteHttpExceptions: true,
                  },
                  resObj,
                  name: safeName,
                  argsObj: args,
                },
              },
            };
          };
        },
      );
    }

    // Merge User's custom defined implementations with interceptors for granular logging
    if (addedFunctions?.params_) {
      funcs.params_ = { ...funcs.params_, ...addedFunctions.params_ };
      Object.keys(addedFunctions).forEach((k) => {
        if (k !== "params_") {
          const originalFunc = addedFunctions[k];
          funcs[k] = (args) => {
            const msgCall = `Local Function Executed: "${k}" | Args: ${JSON.stringify(args)}`;
            console.log(`[Phase 5: Sequential Execution] ${msgCall}`);
            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              "server internal",
              msgCall,
            );
            try {
              const res = originalFunc(args);
              const strRes = JSON.stringify(res) || "";
              const msgRet = `Function Returned: "${k}" | Data: ${strRes.substring(0, 1000)}`;
              console.log(`[Phase 5: Sequential Execution] ${msgRet}`);
              this.addLog_(
                new Date(),
                "[Phase 5: Sequential Execution]",
                null,
                "server internal",
                msgRet,
              );
              return res;
            } catch (err) {
              const msgErr = `Function Error: "${k}" | Stack: ${err.stack}`;
              console.error(`[Phase 5: Sequential Execution] ${msgErr}`);
              this.addLog_(
                new Date(),
                "[Phase 5: Sequential Execution]",
                null,
                "server internal",
                msgErr,
              );
              throw err;
            }
          };
        }
      });
    }

    return funcs;
  }

  /**
   * Fetch multiple URLs in chunks to avoid AppScript service limits.
   * @private
   */
  fetchAllWithLimitations_(requests, limit = 20) {
    const res = [];
    for (let i = 0; i < requests.length; i += limit) {
      res.push(...UrlFetchApp.fetchAll(requests.slice(i, i + limit)));
    }
    return res;
  }

  /**
   * [Phase 2: Agent Discovery] Retrieve and parse agent cards optimally from given URLs.
   * Handles string URLs as well as structured objects encapsulating custom headers.
   * @param {Array<String|Object>} agentCardUrls Array of strings or objects referring to remote card sources.
   * @return {Array<Object>} Array of sanitized agent card objects.
   */
  getAgentCards(agentCardUrls) {
    const phaseTag = "[Phase 2: Agent Discovery]";
    console.log(`${phaseTag} Initiating agent card retrieval.`);

    if (!agentCardUrls || agentCardUrls.length === 0) {
      console.warn(`${phaseTag} No agent cards URLs provided.`);
      return [];
    }

    // Normalize inputs separating clean string paths and embedded object configurations
    const normalizedUrls = agentCardUrls
      .map((item) => {
        if (typeof item === "string" && item.trim() !== "") {
          return { url: item.trim(), headers: {}, original: item };
        } else if (typeof item === "object" && item !== null) {
          const key = Object.keys(item)[0];
          const val = item[key];
          if (val && val.httpUrl) {
            return {
              url: val.httpUrl.trim(),
              headers: val.headers || {},
              original: item,
            };
          }
        }
        return null;
      })
      .filter(Boolean);

    if (normalizedUrls.length === 0) {
      console.warn(`${phaseTag} No valid agent cards configurations parsed.`);
      return [];
    }

    this.addLog_(
      new Date(),
      phaseTag,
      null,
      `${this.contextType} internal`,
      `Target URLs Processed: ${normalizedUrls.length}`,
    );

    const requests = normalizedUrls.map((norm) => {
      const { url, queryParameters } = this.parseQueryParameters_(norm.url);
      const path = url.split("/").pop();
      const targetUrl = ["exec", "dev"].includes(path)
        ? `${url.trim()}/.well-known/agent-card.json`
        : url.trim();

      // Merge native authentication scopes with the provided dynamic context headers
      const combinedHeaders = { ...this.headers, ...norm.headers };

      this.addLog_(
        new Date(),
        phaseTag,
        null,
        "client --> server",
        `Requesting well-known agent configuration from: ${targetUrl}`,
      );

      return {
        url: this.addQueryParameters_(targetUrl, queryParameters || {}),
        headers: combinedHeaders,
        muteHttpExceptions: true,
      };
    });

    const ress = this.fetchAllWithLimitations_(requests);
    const agentCards = ress.reduce((acc, res, i) => {
      if (res.getResponseCode() === 200) {
        try {
          const o = JSON.parse(res.getContentText());
          o.url = o.url || normalizedUrls[i].url;
          o.customHeaders = normalizedUrls[i].headers; // Inject mapping context downstream

          if (o.name) {
            o.name = o.name.replace(/ /g, "_");
          }
          acc.push(o);
          this.addLog_(
            new Date(),
            phaseTag,
            null,
            "server --> client",
            `Successfully retrieved card for agent: ${o.name}`,
          );
        } catch (e) {
          console.warn(
            `${phaseTag} Failed to parse agent card from "${normalizedUrls[i].url}".`,
          );
        }
      } else {
        console.warn(
          `${phaseTag} Didn't get agent card from "${normalizedUrls[i].url}". HTTP Status: ${res.getResponseCode()}`,
        );
      }
      return acc;
    }, []);

    if (agentCards.length === 0) {
      console.warn(`${phaseTag} No valid agent cards found.`);
    }

    console.log(`${phaseTag} Agent card retrieval complete.`);
    return agentCards;
  }

  /**
   * Core execution orchestration engine for handling prompt assignments dynamically.
   * Runs sequentially through Phase 4, 5, 6, 7.
   * @private
   */
  processAgents_(object) {
    const {
      apiKey,
      agentCards,
      prompt = "",
      history = [],
      fileAsBlob = false,
      functions,
    } = object;

    // [Phase 3: Tool Proxying]
    const addedFunctions = functions ? { ...functions } : null;
    const createdFunctions = this.getClientFunctions_(
      agentCards,
      addedFunctions,
      history,
    );

    // [Phase 4: Planning]
    const phase4Tag = "[Phase 4: Planning]";
    console.log(`${phase4Tag} Analyzing prompt and selecting optimal routing.`);

    let agents = agentCards.map(({ name, description, url, skills }) => {
      const skillStr = skills.map(
        (e) =>
          `Skill name: ${e.name || "no name"}, Description of skill: ${e.description || "no description"}, Examples: ${e.examples && e.examples.length ? e.examples.join(",") : "no examples"}`,
      );
      return `- Name: "${name}", Description: "${description}", URL: "${url}", skills: "${skillStr}"`;
    });
    if (agents.length === 0) agents = ["No agents."];

    let functionCallings = Object.entries(createdFunctions.params_).map(
      ([k, v]) => `- Name: "${k}", Details: ${JSON.stringify(v)}`,
    );
    if (functionCallings.length === 0) functionCallings = ["No functions."];

    const msgAnalyze = `Available Remote Agents: ${agentCards.length} | Available Local Functions/Proxies: ${Object.keys(createdFunctions.params_).length}`;
    console.log(`${phase4Tag} ${msgAnalyze}`);
    this.addLog_(
      new Date(),
      phase4Tag,
      null,
      `${this.contextType} internal`,
      msgAnalyze,
    );

    // Construct the guiding System Instruction layout dynamically
    const systemInstructionText = [
      "You are an expert delegator capable of assigning user requests to appropriate remote agents. You create the suitable order for processing agents and functions.",
      "<Agents>",
      "The following agents are the available agent list.",
      ...agents,
      "</Agents>",
      "<Functions>",
      "The following functions are the available function list. The JSON schema of the value of 'Details' is the same with the schema for the function calling. From 'Details', understand the functions.",
      ...functionCallings,
      "</Functions>",
      "<Mission>",
      "- Understand the agents and the tasks that the agents can do.",
      "- Understand the functions and the tasks that the functions can do.",
      "- Understand requests of the user's prompt.",
      "- For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions for accurately resolving requests of the user's prompt in the suitable order. Always include the remote agent's name and the function name when responding to the user.",
      "- If multiple processes can be run with a single agent or a function, create a suitable prompt including those processes in it.",
      "- If the suitable agent and functions cannot be found, directly answer without using them.",
      "</Mission>",
      "<Important>",
      "- Do not fabricate responses.",
      "- If you are unsure, ask the user for more details.",
      "- Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      "- When the requests include both the agent can resolve and the agent cannot resolve, suggest the order by including the agents, functions, and 'without_agent'.",
      "- Do not fabricate or invent any agent names or function names. Use ONLY the ones explicitly provided.",
      `- Don't include some code in the response value like "tool_code".`,
      `- Don't suggest some code in the response value like "tool_code".`,
      `- If you are required to know the current date time, it's "${Utilities.formatDate(this.date, this.timezone, "yyyy-MM-dd HH:mm:ss")}". And, timezone is ${this.timezone}.`,
      "</Important>",
    ].join("\n");

    const responseSchema = {
      title: "Order of agents and functions for resolving the user's prompt.",
      description:
        "Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { description: "Agent name or function name.", type: "string" },
          task: {
            description:
              "For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions to accurately resolve requests of the user's prompt in the suitable order. Here, don't include the agent URL.",
            type: "string",
          },
        },
      },
    };

    // Initial Orchestration invocation
    const g = new GeminiWithFiles({
      apiKey,
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
        role: "model",
      },
      model: this.model,
      responseMimeType: "application/json",
      responseSchema,
    });
    g.history = [...history, ...(g.history || [])];

    const textPrompt = `User's prompt is as follows.\n<UserPrompt>${prompt}</UserPrompt>`;
    const orderArTemp = g.generateContent({ q: textPrompt });
    const orderAr = Array.isArray(orderArTemp) ? orderArTemp : [];

    const msgOrder = `Determined Execution Order: ${JSON.stringify(orderAr)}`;
    console.log(`${phase4Tag} ${msgOrder}`);
    forDebug && toLog_("orderAr", JSON.stringify(orderAr));
    this.addLog_(
      new Date(),
      phase4Tag,
      null,
      `${this.contextType} internal`,
      msgOrder,
    );

    if (!Array.isArray(orderAr) || orderAr.length === 0) {
      const errObj = {
        error: {
          code: this.ErrorCode["Internal server error"],
          message: "Internal server error. Execution Order Generation Failed.",
        },
        jsonrpc: this.jsonrpc,
        id: null,
      };
      console.error(`${phase4Tag} Execution Order Generation Failed.`);
      this.addLog_(
        new Date(),
        phase4Tag,
        null,
        `${this.contextType} internal`,
        JSON.stringify(errObj),
      );
      return errObj;
    }

    // [Phase 5: Sequential Execution]
    const phase5Tag = "[Phase 5: Sequential Execution]";
    console.log(
      `${phase5Tag} Initiating sequential execution based on planning phase.`,
    );
    let tempHistory = [...g.history];
    const results = [];

    // Evaluate the sequential path sequentially
    for (const { name, task } of orderAr) {
      const msgExec = `Delegating to Tool/Agent: "${name}" | Task Details: "${task}"`;
      console.log(`${phase5Tag} ${msgExec}`);
      this.addLog_(
        new Date(),
        phase5Tag,
        null,
        `${this.contextType} internal`,
        msgExec,
      );

      const funcCall = {
        params_: { [name]: createdFunctions.params_[name] },
        [name]: createdFunctions[name],
      };

      const gg = new GeminiWithFiles({
        apiKey,
        model: this.model,
        functions: funcCall,
        history: tempHistory,
        toolConfig: {
          functionCallingConfig: { mode: "any", allowedFunctionNames: [name] },
        },
      });

      const q = [
        `Your task is as follows.`,
        `<Task>${task}</Task>`,
        `<Important>`,
        `- If you do not have enough information to resolve "Task", ask the user for more details without generating content forcefully.`,
        `</Important>`,
      ].join("\n");

      const res = gg.generateContent({ q });

      const msgResType = `Result received from Gemini node for "${name}" | Type: [${typeof res}] | Content preview: ${typeof res === "string" ? res : JSON.stringify(res).substring(0, 500)}`;
      console.log(`${phase5Tag} ${msgResType}`);
      this.addLog_(
        new Date(),
        phase5Tag,
        null,
        `${this.contextType} internal`,
        msgResType,
      );
      forDebug && toLog_("In task loop", JSON.stringify(res));

      // Check if bypassed via customType_ return mechanism
      const funcRes =
        res.functionResponse ||
        (res.items && res.items.functionResponse
          ? res.items.functionResponse
          : undefined);

      // Handle the resulting operation appropriately whether standard Function or A2A
      if (typeof res === "string") {
        results.push({ type: "text", text: res });
      } else if (res.text) {
        results.push({ type: "text", text: res.text });
      } else if (Array.isArray(res)) {
        // Handle array responses naturally
        const texts = res.map((r) =>
          typeof r === "string" ? r : r.text || JSON.stringify(r),
        );
        results.push({ type: "text", text: texts.join("\n") });
      } else if (funcRes?.request) {
        const req = funcRes.request;
        const msgReq = `Dispatching JSON-RPC request to remote agent: ${req.url}`;
        console.log(`${phase5Tag} ${msgReq}`);
        this.addLog_(new Date(), phase5Tag, null, "client --> server", msgReq);

        const re = UrlFetchApp.fetch(req.url, req);
        const code = re.getResponseCode();
        const body = re.getContentText();

        const msgRes = `Remote agent responded with HTTP Code: ${code}`;
        console.log(`${phase5Tag} ${msgRes}`);
        this.addLog_(
          new Date(),
          phase5Tag,
          null,
          "server --> client",
          `Code: ${code}, Body: ${body.substring(0, 1500)}`,
        );

        if (code === 200) {
          const oo = JSON.parse(body);
          if (oo.result) {
            const {
              id: id1,
              params: { id: id2, sessionId: id3 },
            } = funcRes.resObj;

            if (
              oo.result.status?.state === "completed" &&
              oo.id === id1 &&
              oo.result.id === id2 &&
              oo.result.sessionId === id3
            ) {
              const sArtifacts = (oo.result.artifacts || []).flatMap(
                ({ parts }) => parts,
              );
              const messageParts = oo.result.status.message?.parts || [];

              // Deduplicate redundant text blocks natively spawned from separate artifact schemas
              const uniqueTexts = new Set();
              const m = [...messageParts, ...sArtifacts].filter((part) => {
                if (part.type === "text") {
                  const txt = part.text || "";
                  if (uniqueTexts.has(txt)) return false;
                  uniqueTexts.add(txt);
                }
                return true;
              });

              results.push(...m);

              // Emulate structural knowledge block representation for tracking context effectively
              let bkHistory = m.filter((mm) => mm.type === "text");
              if (bkHistory.length === 0 && m.length > 0) {
                const sss = m
                  .map(
                    (mm) =>
                      `Name: ${mm[mm.type]?.name}, MimeType: ${mm[mm.type]?.mimeType}`,
                  )
                  .join("\n");
                bkHistory = [
                  { type: "text", text: `Data is as follows.\n${sss}` },
                ];
              }

              // Manually patch the history array as the loop bypass prevents GeminiWithFiles from appending the call details automatically.
              if (funcRes.name && funcRes.argsObj) {
                gg.history.push({
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: funcRes.name,
                        args: funcRes.argsObj,
                      },
                    },
                  ],
                });
                gg.history.push({
                  role: "function",
                  parts: [
                    {
                      functionResponse: {
                        name: funcRes.name,
                        response: { name: funcRes.name, content: bkHistory },
                      },
                    },
                  ],
                });
              } else {
                const lastHistory = gg.history[gg.history.length - 1];
                if (lastHistory?.parts?.[0]?.functionResponse?.response) {
                  lastHistory.parts[0].functionResponse.response.content =
                    bkHistory;
                }
              }
            } else {
              const errMsg = `Error: Remote agent ${name} did not complete successfully. Task: ${task}`;
              console.error(`${phase5Tag} ${errMsg}`);
              results.push({ type: "text", text: errMsg });
            }
          } else if (oo.error) {
            const errMsg = `Error: Remote agent ${name} returned error: ${JSON.stringify(oo.error)}`;
            console.error(`${phase5Tag} ${errMsg}`);
            results.push({ type: "text", text: errMsg });
          }
        } else {
          const errMsg = `Error: Remote agent ${name} returned HTTP ${code}. Task: ${task}`;
          console.error(`${phase5Tag} ${errMsg}`);
          results.push({ type: "text", text: errMsg });
        }
      } else if (funcRes?.result) {
        let text = funcRes.result;
        if (funcRes.result?.content?.[0]?.text) {
          text = funcRes.result.content[0].text;
        }
        results.push({ type: "text", text });
      } else if (funcRes?.a2a?.result) {
        results.push({ type: "text", text: funcRes.a2a.result });
      } else {
        // Enforce standard object output architecture so subsequent file evaluation map skips over this payload properly.
        const errMsg = `Error: Name: ${name}, Task: ${task}, Unhandled Result Type: ${JSON.stringify(res)}`;
        console.error(`${phase5Tag} ${errMsg}`);
        results.push({
          type: "text",
          text: errMsg,
        });
      }
      tempHistory = gg.history;
    }

    // [Phase 6: Data Materialization]
    const phase6Tag = "[Phase 6: Data Materialization]";
    console.log(
      `${phase6Tag} Isolating textual structural outcomes and physical blobs.`,
    );
    let finalResults = results.map((o) => {
      const type = o.type;
      if (type === "text") {
        this.addLog_(
          new Date(),
          phase6Tag,
          null,
          `${this.contextType} internal`,
          "Result materialized as pure text.",
        );
        return o[type] || o.text;
      }

      this.addLog_(
        new Date(),
        phase6Tag,
        null,
        `${this.contextType} internal`,
        "Result materialized as binary file content.",
      );
      const data = o[type];
      let fileBlob;
      if (data?.bytes) {
        fileBlob = Utilities.newBlob(
          Utilities.base64Decode(data.bytes),
          data.mimeType,
          data.name,
        );
      }

      if (fileBlob) {
        if (fileAsBlob) {
          return fileBlob;
        } else {
          let fileUrl = "";
          if (data.bytes) {
            const file = DriveApp.createFile(fileBlob);
            fileUrl = file.getUrl();
          }
          return `The file was created as an answer. The file URL is "${fileUrl}".`;
        }
      }
      return `The type of file was returned. But, the file content was not included in the response.`;
    });

    forDebug && toLog_("finalResults1", JSON.stringify(finalResults));

    // [Phase 7: Final Synthesis]
    const phase7Tag = "[Phase 7: Final Synthesis]";
    console.log(`${phase7Tag} Synthesizing final aggregate outputs.`);
    const strResults = finalResults.filter((e) => typeof e === "string");
    if (strResults.length > 0) {
      if (strResults.length === 1 && finalResults.length === 1) {
        // Optimization: Skip unnecessary summarization if only one string outcome exists
        this.addLog_(
          new Date(),
          phase7Tag,
          null,
          `${this.contextType} internal`,
          "Bypassing extra synthesis step due to singular text outcome.",
        );
      } else {
        this.addLog_(
          new Date(),
          phase7Tag,
          null,
          `${this.contextType} internal`,
          "Aggregating multiple textual blocks via LLM abstraction.",
        );
        const gg = new GeminiWithFiles({
          apiKey,
          model: this.model,
          history: tempHistory,
        });
        const res3 = gg.generateContent({
          parts: [
            { text: `Summarize answers by considering the question.` },
            { text: `<Question>${prompt}</Question>` },
            { text: `<Answers>${strResults.join("\n")}</Answers>` },
          ],
        });
        finalResults = [
          res3,
          ...finalResults.filter((e) => typeof e !== "string"),
        ];
      }
    } else {
      this.addLog_(
        new Date(),
        phase7Tag,
        null,
        `${this.contextType} internal`,
        "No string components required synthesis.",
      );
    }

    this.addLog_(
      new Date(),
      phase7Tag,
      null,
      `${this.contextType} internal`,
      `Finalized payload synthesis completed: ${JSON.stringify(finalResults).substring(0, 1000)}`,
    );

    console.log(`${phase7Tag} Completed.`);
    forDebug && toLog_("finalResults2", JSON.stringify(finalResults));

    // [Refactoring: Clean History Construction]
    // Eliminate massive internal intermediate LLM reasoning steps (functionCall, thoughtSignature, etc.) from the propagated history.
    this.addLog_(
      new Date(),
      phase7Tag,
      null,
      `${this.contextType} internal`,
      "Constructing clean history to prevent token bloat.",
    );

    const historyAnswerText = finalResults
      .map((e) => (typeof e === "string" ? e : "[Binary Data]"))
      .join("\n");

    const cleanHistory = [...history];
    if (prompt) {
      cleanHistory.push({ role: "user", parts: [{ text: prompt }] });
    }
    if (historyAnswerText) {
      cleanHistory.push({
        role: "model",
        parts: [{ text: historyAnswerText }],
      });
    }

    return { result: finalResults, history: cleanHistory, agentCards };
  }

  /**
   * Helper: Parse URL query parameters recursively dynamically.
   * @private
   */
  parseQueryParameters_(url) {
    if (typeof url !== "string") {
      throw new Error(
        "Please provide a valid URL (String) including query parameters.",
      );
    }
    const [baseUrl, query] = url.split("?");
    if (!query) {
      return { url: baseUrl, queryParameters: null };
    }
    const queryParameters = query.split("&").reduce((acc, param) => {
      const [key, rawValue] = param.split("=");
      if (!key) return acc;
      const k = key.trim();
      let v = rawValue ? rawValue.trim() : "";
      v = isNaN(Number(v)) || v === "" ? v : Number(v);
      if (acc[k]) {
        acc[k].push(v);
      } else {
        acc[k] = [v];
      }
      return acc;
    }, {});
    return { url: baseUrl, queryParameters };
  }

  /**
   * Helper: Map JSON definitions as parameter endpoints uniformly.
   * @private
   */
  addQueryParameters_(url, obj) {
    if (typeof url !== "string" || typeof obj !== "object" || obj === null) {
      throw new Error(
        "Please provide a valid URL (String) and query parameter object.",
      );
    }
    const entries = Object.entries(obj);
    if (entries.length === 0) return url;

    const queryString = entries
      .flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((e) => `${encodeURIComponent(k)}=${encodeURIComponent(e)}`)
          : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
      )
      .join("&");

    return url.includes("?")
      ? `${url}&${queryString}`
      : `${url}?${queryString}`;
  }
};


/**
 * Class object for MCP (Model Context Protocol).
 * Author: Kanshi Tanaike
 * Refactored by: Senior Generative AI & MCP Expert
 * Version: 2.2.0
 * Date: 2026-05-19
 * GitHub: https://github.com/tanaikech/MCPApp
 * @class
 */
var MCPApp = class MCPApp {
  /**
   * @param {Object} object - Object used to initialize this script.
   * @param {string} [object.accessKey=null] - Default is null. Used for accessing the Web Apps.
   * @param {boolean}[object.log=false] - Default is false. When true, the log between the MCP client and server is stored in Google Sheets.
   * @param {string} [object.spreadsheetId] - Spreadsheet ID. Logs are stored in the "log" sheet of this spreadsheet.
   * @param {boolean} [object.lock=true] - Default is true. By default, the script runs with LockService to prevent concurrency issues.
   * @return {MCPApp}
   */
  constructor(object = {}) {
    const {
      accessKey = null,
      log = false,
      spreadsheetId = null,
      lock = true,
    } = object;

    /** @private */
    this.accessKey = accessKey;

    /**
     * Standard JSON-RPC error codes.
     * @see https://modelcontextprotocol.io/docs/concepts/architecture#error-handling
     * @private
     */
    this.ErrorCode = {
      ParseError: -32700,
      InvalidRequest: -32600,
      MethodNotFound: -32601,
      InvalidParams: -32602,
      InternalError: -32603,
    };

    /** @private */
    this.protocolVersion = "2024-11-05";

    /** @private */
    this.jsonrpc = "2.0";

    /** @private */
    this.date = new Date();

    /** @private */
    this.timezone = Session.getScriptTimeZone();

    /** @private */
    this.log = log;

    if (this.log) {
      const ss = spreadsheetId
        ? SpreadsheetApp.openById(spreadsheetId)
        : SpreadsheetApp.create("Log_MCPApp");

      /** @private */
      this.sheet = ss.getSheetByName("log") || ss.insertSheet("log");
    }

    /** @private */
    this.values = [];

    /** @private */
    this.useLock = lock;

    this.lock = LockService.getScriptLock();

    /** @private */
    this.clientObject = {};
  }

  /**
   * ### Description
   * Sets services dependent on each script environment, such as LockService and PropertiesService.
   * Set these services if utilizing MCPApp as a library.
   *
   * @param {Object} services - Object containing the services you want to use.
   * @param {GoogleAppsScript.Lock.Lock} [services.lock] - Instance of LockService (e.g., getScriptLock()).
   * @param {GoogleAppsScript.Properties.Properties}[services.properties] - Instance of PropertiesService.
   * @return {MCPApp}
   */
  setServices(services = {}) {
    const { lock, properties } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    if (properties && properties.toString() === "Properties") {
      this.properties = properties;
    }
    return this;
  }

  /*****************************************************************************************************
   * SERVER METHODS
   *****************************************************************************************************/

  /**
   * ### Description
   * Main entry method for the MCP server.
   *
   * @param {Object} object - Execution object.
   * @param {Object} object.eventObject - Event object from the doPost function.
   * @param {Object} [object.serverResponse] - Object structured for the server response.
   * @param {Object} [object.functions] - Functions mapped for usage via tools/call.
   * @param {Array}  [object.items] - Items including server responses and functions.
   * @return {GoogleAppsScript.Content.TextOutput}
   */
  server(object = {}) {
    this.errorProcessForServer_(object);

    const obj = this.parseObj_(object.eventObject);
    const lockedMethods = [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "prompts/list",
      "resources/list",
    ];

    if (
      (obj?.method && lockedMethods.includes(obj.method)) ||
      this.useLock === true
    ) {
      return this.lockedMethod_(object);
    }

    try {
      return this.serverMain_(object);
    } catch (error) {
      throw new Error(
        `Server Execution Error: ${error.stack || String(error)}`,
      );
    }
  }

  /**
   * ### Description
   * Core server logic execution.
   *
   * @param {Object} object
   * @return {GoogleAppsScript.Content.TextOutput}
   * @private
   */
  serverMain_(object) {
    const res = this.createResponse_(object);
    if (this.log) {
      this.log_();
    }
    return res;
  }

  /**
   * ### Description
   * Executes the server logic under a lock state to prevent concurrency overlaps.
   *
   * @param {Object} object
   * @return {GoogleAppsScript.Content.TextOutput}
   * @private
   */
  lockedMethod_(object) {
    const lock = this.lock;
    if (!lock.tryLock(350000)) {
      throw new Error("Timeout: Could not acquire lock.");
    }
    try {
      return this.serverMain_(object);
    } catch (error) {
      throw new Error(
        `Locked Execution Error: ${error.stack || String(error)}`,
      );
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * ### Description
   * Validates the initialization parameters for the server.
   *
   * @param {Object} object
   * @return {void}
   * @private
   */
  errorProcessForServer_(object) {
    if (!object.eventObject) {
      throw new Error(
        "Missing 'eventObject'. Please pass the event object from doPost().",
      );
    }
    if (!object.serverResponse && !object.items) {
      throw new Error(
        "Missing 'serverResponse' or 'items'. Please set your server object configurations.",
      );
    }
  }

  /**
   * ### Description
   * Replaces variables mapped in arguments into the target message content.
   *
   * @param {Array} messages - Message array to modify.
   * @param {Object} args - Arguments dictionary containing keys and replacement values.
   * @private
   */
  replaceTemplateVariables_(messages, args) {
    if (!messages || !args) return;
    Object.entries(args).forEach(([key, value]) => {
      messages.forEach((msg) => {
        if (msg.content?.text) {
          msg.content.text = msg.content.text.replaceAll(
            `{{${key}}}`,
            String(value),
          );
        }
      });
    });
  }

  /**
   * ### Description
   * Handles batch processing of individual JSON-RPC calls.
   *
   * @param {Object} object
   * @return {Object|null}
   * @private
   */
  batchProcess_(object) {
    const { obj, serverResponse, functions } = object;
    if (!obj || !("method" in obj)) return null;

    const method = obj.method.toLowerCase();
    const id = obj.id ?? "No ID";
    this.values.push([
      this.date,
      method,
      id,
      "client --> server",
      JSON.stringify(obj),
    ]);

    let retObj;

    // Handle standard server responses
    if (serverResponse && method in serverResponse) {
      if (serverResponse[method].result) {
        try {
          retObj = serverResponse[method];
          this.replaceTemplateVariables_(
            retObj.result?.messages,
            obj.params?.arguments,
          );
        } catch (error) {
          retObj = {
            error: {
              code: this.ErrorCode.InternalError,
              message: error.stack || String(error),
            },
            jsonrpc: this.jsonrpc,
          };
        }
        retObj.id = id;
        this.values.push([
          this.date,
          method,
          id,
          "server --> client",
          JSON.stringify(retObj),
        ]);
        return retObj;
      }

      // Handle named prompt execution
      const resName = obj.params?.name;
      if (resName && serverResponse[method][resName]) {
        retObj = serverResponse[method][resName];
        retObj.id = id;
        this.replaceTemplateVariables_(
          retObj.result?.messages,
          obj.params?.arguments,
        );
      } else {
        retObj = {
          error: {
            code: this.ErrorCode.InvalidParams,
            message: `No prompt found with name "${resName}".`,
          },
          jsonrpc: this.jsonrpc,
          id,
        };
      }

      this.values.push([
        this.date,
        method,
        id,
        "server --> client",
        JSON.stringify(retObj),
      ]);
      return retObj;
    }

    // Handle function executions via Tools
    if (functions && method in functions) {
      const funcGroup = functions[method];
      try {
        const paramName = obj.params?.name;
        const paramUri = obj.params?.uri;

        if (paramName && funcGroup[paramName]) {
          retObj = funcGroup[paramName](obj.params?.arguments || null);

          // --- Smart response wrapper ---
          if (typeof retObj === "string") {
            retObj = {
              jsonrpc: this.jsonrpc,
              result: {
                content: [{ type: "text", text: retObj }],
                isError: false,
              },
            };
          } else if (
            retObj?.result &&
            typeof retObj.result === "string" &&
            Object.keys(retObj).length === 1
          ) {
            retObj = {
              jsonrpc: this.jsonrpc,
              result: {
                content: [{ type: "text", text: retObj.result }],
                isError: false,
              },
            };
          } else if (retObj?.mcp) {
            retObj = retObj.mcp;
          } else if (retObj && !retObj.jsonrpc && !retObj.error) {
            retObj = { jsonrpc: this.jsonrpc, result: retObj };
          }
        } else if (paramUri && funcGroup[paramUri]) {
          retObj = funcGroup[paramUri]();
        } else {
          retObj = {
            error: {
              code: this.ErrorCode.MethodNotFound,
              message: `Method or Function "${method}" could not be executed.`,
            },
            jsonrpc: this.jsonrpc,
          };
        }
      } catch (error) {
        retObj = {
          error: {
            code: this.ErrorCode.InternalError,
            message: error.stack || String(error),
          },
          jsonrpc: this.jsonrpc,
        };
      }

      retObj.id = id;
      this.values.push([
        this.date,
        method,
        id,
        "server --> client",
        JSON.stringify(retObj),
      ]);
      return retObj;
    }

    // Fallback if no processor found
    this.values.push([
      this.date,
      method,
      id,
      "server --> client",
      `No return value mapped for ID ${id}.`,
    ]);
    return null;
  }

  /**
   * ### Description
   * Helper to evaluate and return the larger JSON object string, preventing overwrites of expanded data.
   *
   * @param {Object} currentObj
   * @param {Object} newObj
   * @return {Object}
   * @private
   */
  updateResultIfLarger_(currentObj, newObj) {
    if (!currentObj) return newObj;
    return JSON.stringify(currentObj).length < JSON.stringify(newObj).length
      ? newObj
      : currentObj;
  }

  /**
   * ### Description
   * Constructs the text output response for the MCP client.
   *
   * @param {Object} object
   * @return {GoogleAppsScript.Content.TextOutput|null}
   * @private
   */
  createResponse_(object) {
    let {
      eventObject,
      serverResponse = null,
      functions = {},
      items = [],
    } = object;

    // Access Key Validation
    const reqAccessKey = eventObject.parameter?.accessKey;
    if (this.accessKey && reqAccessKey !== this.accessKey) {
      const errMsg = "Invalid accessKey provided.";
      this.values.push([this.date, null, null, "At server", errMsg]);
      const retObj = {
        error: { code: this.ErrorCode.InvalidRequest, message: errMsg },
        jsonrpc: this.jsonrpc,
      };
      return ContentService.createTextOutput(
        JSON.stringify(retObj),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Dynamic Items Construction
    if (
      items.length > 0 &&
      !serverResponse &&
      Object.keys(functions).length === 0
    ) {
      const lockedTypes = [
        "initialize",
        "prompts/list",
        "prompts/get",
        "resources/list",
      ];
      const duplicateChecked = [];
      const itemSet = new Set();

      // Deduplicate items
      items.forEach((e) => {
        const type = e.type;
        const name = e.value?.name;
        if (!lockedTypes.includes(type) && name && itemSet.has(name)) {
          console.warn(
            `System warning: Item "${name}" is duplicated and will be ignored.`,
          );
        } else {
          if (name) itemSet.add(name);
          duplicateChecked.push(e);
        }
      });

      // Construct maps
      const generated = duplicateChecked.reduce(
        (acc, e) => {
          const type = e.type;
          const rootKey = type.split("/")[0];

          if (!lockedTypes.includes(type) && acc.serverResponse[type]) {
            acc.serverResponse[type].result[rootKey].push(e.value);
          } else {
            let tempObj = {};
            if (type === "initialize" || type === "resources/list") {
              const existingRes = acc.serverResponse[type]?.result;
              tempObj = {
                jsonrpc: this.jsonrpc,
                result: this.updateResultIfLarger_(existingRes, e.value),
              };
            } else if (type === "prompts/list") {
              let resultObj = acc.serverResponse[type]?.result || {
                prompts: [],
              };
              if (e.value.prompts && Array.isArray(e.value.prompts)) {
                resultObj.prompts.push(...e.value.prompts);
                resultObj.prompts.sort((a, b) => (a.name > b.name ? 1 : -1));
              }
              tempObj = { jsonrpc: this.jsonrpc, result: resultObj };
            } else if (type === "prompts/get") {
              if (acc.serverResponse[type]) {
                if (acc.serverResponse[type].result) {
                  const existingRes = acc.serverResponse[type].result;
                  tempObj = {
                    jsonrpc: this.jsonrpc,
                    result: this.updateResultIfLarger_(existingRes, e.value),
                  };
                } else {
                  Object.entries(e.value).forEach(([k, v]) => {
                    acc.serverResponse[type][k] = {
                      jsonrpc: this.jsonrpc,
                      result: v,
                    };
                  });
                  tempObj = acc.serverResponse[type];
                }
              } else {
                if (e.value.messages) {
                  tempObj = { jsonrpc: this.jsonrpc, result: e.value };
                } else {
                  Object.entries(e.value).forEach(([k, v]) => {
                    tempObj[k] = { jsonrpc: this.jsonrpc, result: v };
                  });
                }
              }
            } else {
              tempObj = {
                jsonrpc: this.jsonrpc,
                result: { [rootKey]: [e.value] },
              };
            }
            acc.serverResponse[type] = tempObj;
          }

          // Functions injection
          if ("function" in e) {
            const callKey = `${rootKey}/call`;
            acc.functions[callKey] = acc.functions[callKey] || {};

            // Safely extract function name
            const funcName = e.value?.name || e.function?.name;
            if (funcName) {
              acc.functions[callKey][funcName] = e.function;
            } else {
              console.warn(
                `System warning: Function name could not be resolved for type ${type}.`,
              );
            }
          }
          return acc;
        },
        { serverResponse: {}, functions: {} },
      );

      serverResponse = generated.serverResponse;
      functions = generated.functions;
    }

    // Evaluate parsed request bodies
    const reqObj = this.parseObj_(eventObject);
    let finalResponse = null;

    if (Array.isArray(reqObj)) {
      finalResponse = reqObj
        .map((o) => this.batchProcess_({ obj: o, serverResponse, functions }))
        .filter(Boolean);
      if (finalResponse.length === 0) return null;
    } else {
      finalResponse = this.batchProcess_({
        obj: reqObj,
        serverResponse,
        functions,
      });
    }

    if (finalResponse) {
      const dataStr = JSON.stringify(finalResponse);
      if (Array.isArray(finalResponse)) {
        this.values.push([
          this.date,
          "batch process",
          null,
          "server --> client",
          dataStr,
        ]);
      }
      return ContentService.createTextOutput(dataStr).setMimeType(
        ContentService.MimeType.JSON,
      );
    }

    return null;
  }

  /*****************************************************************************************************
   * CLIENT METHODS
   *****************************************************************************************************/

  /**
   * ### Description
   * Prepares the MCP client environment and internal configuration.
   *
   * @param {Object} object - Configuration parameters.
   * @param {string} object.apiKey - API key for the Gemini API.
   * @param {string} object.prompt - Input prompt targeting the agent.
   * @param {Array<string|Object>} [object.mcpServerUrls=[]] - Valid URLs or custom Header objects targeting MCP servers.
   * @param {boolean}[object.batchProcess=false] - If true, enables high-speed concurrent network requests bypassing JSON-RPC array routing limitations.
   * @param {Object}[object.functions] - Custom client-side tools/functions.
   * @param {Array} [object.history] - Chat history array for continuous conversation.
   * @param {Array} [object.mcpServerObj] - MCP Servers installed directly as libraries.
   * @return {MCPApp}
   */
  client(object = {}) {
    this.errorProcessForClient_(object);
    if (!Array.isArray(object.mcpServerUrls)) {
      object.mcpServerUrls = [];
    }

    this.clientInfo = { name: "MCPApp_client", version: "1.0.0" };

    /** @private */
    this.model = "models/gemini-3-flash-preview";

    /** @private */
    this.id = 0;

    /** @private */
    this.headers = { authorization: `Bearer ${ScriptApp.getOAuthToken()}` };

    this.prepareClient_(object);
    return this;
  }

  /**
   * ### Description
   * Main execution sequence for communicating with the configured MCP servers and local logic.
   * It analyzes the user prompt using the Gemini model to decide tool ordering and sequential execution.
   *
   * @return {Object} An object containing the final results array and generation history.
   */
  callMCPServers() {
    console.log("--- start: Call MCP servers or functions (client --> server)");

    if (!this.functions?.params_) {
      this.functions = { params_: {} };
    }

    let functionCallings = Object.entries(this.functions.params_).map(
      ([key, val]) => `- Name: "${key}", Details: ${JSON.stringify(val)}`,
    );
    if (functionCallings.length === 0) {
      functionCallings = ["No accessible functions currently available."];
    }

    const serverInfoArr = (this.mcpServerObj || []).reduce((acc, obj) => {
      const serverInfo = obj.initialize?.result?.serverInfo;
      if (serverInfo)
        acc.push(`Name: ${serverInfo.name}, Version: ${serverInfo.version}`);
      return acc;
    }, []);

    const mcpServerDescriptions = [
      "The available connected MCP servers are listed below:",
      ...serverInfoArr,
    ];

    const currentTimestamp = Utilities.formatDate(
      this.date,
      this.timezone,
      "yyyy-MM-dd HH:mm:ss",
    );

    const systemInstructionText = [
      "You are an expert autonomous delegator capable of assigning user requests to appropriate Model Context Protocol (MCP) server functions.",
      "You construct the optimal logical order for processing tasks leveraging available functions.",
      "<Functions>",
      "The functions available are listed below. The JSON schema defining 'Details' reflects standard function-calling schemas.",
      ...functionCallings,
      "</Functions>",
      "<Mission>",
      "- Fully analyze the purpose and utility of the provided functions.",
      "- Comprehend the nuanced requirements within the user's prompt.",
      "- Assign tasks accurately to appropriate functions in sequential execution order.",
      "- If multiple independent actions map to a single function, merge the logic within the prompt configuration for that function.",
      "- If no combination of functions can fulfill the user's prompt, resolve using your intrinsic knowledge.",
      `- Fall back to the "without_function" action exclusively to provide the final conversational response.`,
      `- If a task requires conditional halting verification between execution steps, inject the "check_process" function following that step.`,
      "</Mission>",
      "<Important>",
      "- Never fabricate responses. Output strictly factual resolutions based on functions or core knowledge.",
      "- DO NOT invent or hallucinate function names. Use EXACTLY the names provided in the <Functions> list.",
      "- Ask the user for clarification if the request is irreconcilably vague.",
      "- Do NOT output or suggest executable code (e.g., 'tool_code' blocks). Only provide the requested format.",
      `- Ensure all allocated tasks are terminal. Do not instruct the model to verify task completion or delivery status.`,
      `- If you require the current datetime context, use: "${currentTimestamp}" operating within timezone ${this.timezone}.`,
      "</Important>",
    ].join("\n");

    const responseSchema = {
      title: "Function Execution Ordering Strategy",
      description:
        "Define the ordered list of functions needed to resolve the task.",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            description: "Exact name of the selected function.",
            type: "string",
          },
          task: {
            description:
              "The specific sub-task or instruction allocated to this function.",
            type: "string",
          },
        },
      },
    };

    const setupObj = {
      apiKey: this.clientObject.apiKey,
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
        role: "model",
      },
      model: this.model,
      responseMimeType: "application/json",
      responseSchema,
    };

    const geminiOrchestrator = new GeminiWithFiles(setupObj);
    const orchestratorPrompt = `User's input prompt:\n<UserPrompt>${this.clientObject.prompt}</UserPrompt>`;
    const executedOrders = geminiOrchestrator.generateContent({
      q: orchestratorPrompt,
    });

    if (!Array.isArray(executedOrders) || executedOrders.length === 0) {
      const errObj = {
        error: {
          code: this.ErrorCode.InternalError,
          message:
            "Internal planning error. The model returned no execution strategy.",
        },
        jsonrpc: this.jsonrpc,
        id: this.id,
      };
      this.values.push([
        this.date,
        null,
        null,
        "Client side",
        JSON.stringify(errObj),
      ]);
      return errObj;
    }

    const orderLog = executedOrders
      .map((e, i) => `${i + 1}: [${e.name}] -> ${e.task}`)
      .join("\n");
    console.log(`Planned Execution Pipeline:\n${orderLog}`);
    console.log("--- start: Sequence Execution.");

    let conversationHistory = this.clientObject.history || [];

    const executionSystemInstruction = [
      "You are an expert executor responsible for completing a SINGLE step within a larger orchestration pipeline.",
      "<Mission>",
      "- Evaluate the required function syntax and current objective.",
      "- Construct appropriate function arguments extrapolating from the specific task instructions.",
      `- You must ONLY focus on the "Current execution objective". Do not attempt to complete the entire user request unless your specific objective tells you to do so.`,
      `- If your specific objective requires generating the final text response to the user, invoke "without_function" exclusively.`,
      `- Once you have generated a response using "without_function", finish the process immediately.`,
      `- If executing "check_process", thoroughly evaluate previous results to determine whether processing should halt or proceed.`,
      "</Mission>",
      "<Important>",
      "- Maintain strict adherence to factual outputs.",
      `- The current operating datetime is "${currentTimestamp}" (Timezone: ${this.timezone}).`,
      "- Readily utilize information from these available server pools:",
      "<MCPServers>",
      ...mcpServerDescriptions,
      "</MCPServers>",
      "</Important>",
    ].join("\n");

    const generationResults = [];

    for (const step of executedOrders) {
      const { name, task } = step;
      console.log(`--- Executing function: "${name}" | Objective: "${task}"`);

      const funcCallWrapper = {
        params_: {
          [name]: this.functions.params_[name],
        },
        [name]: this.functions[name],
      };

      if (
        name !== "without_function" &&
        this.functions.params_["without_function"]
      ) {
        funcCallWrapper.params_["without_function"] =
          this.functions.params_["without_function"];
        funcCallWrapper["without_function"] =
          this.functions["without_function"];
      }

      if (name !== "check_process" && this.functions.params_["check_process"]) {
        funcCallWrapper.params_["check_process"] =
          this.functions.params_["check_process"];
        funcCallWrapper["check_process"] = this.functions["check_process"];
      }

      const allowedTools = Array.from(
        new Set([name, "without_function", "check_process"]),
      );

      const executeObj = {
        apiKey: this.clientObject.apiKey,
        model: this.model,
        functions: funcCallWrapper,
        systemInstruction: {
          parts: [{ text: executionSystemInstruction }],
          role: "model",
        },
        history: conversationHistory,
        toolConfig: {
          functionCallingConfig: {
            mode: "any",
            allowedFunctionNames: allowedTools,
          },
        },
      };

      const geminiExecutor = new GeminiWithFiles(executeObj);
      const executionPrompt = `Current execution objective:\n<Task>${task}</Task>`;

      // Execute inner sequence. Returns standard text OR intercepts _gemini_halt signals safely.
      const res = geminiExecutor.generateContent({ q: executionPrompt });

      // Cleaned up, robust Halt Signal evaluation
      if (res && typeof res === "object" && res._gemini_halt) {
        if (res.handler === "check_process" && res.result?.stopProcess) {
          const compiledMessage = `Process Halted. Task: ${res.task || task}. Reason: ${res.result.reason}`;
          generationResults.push(compiledMessage);
          console.log(compiledMessage);
          break; // Stop sequential pipeline entirely
        } else if (res.handler === "without_function") {
          const compiledMessage =
            typeof res.result === "string"
              ? res.result
              : JSON.stringify(res.result);
          generationResults.push(compiledMessage);
          break; // Stop sequential pipeline entirely
        }
      } else if (res) {
        console.log(
          `Execution Info: Model resolved task to standard conversational text (No further function calls).`,
        );
        const fallbackText =
          typeof res === "string" ? res : res.text || JSON.stringify(res);
        generationResults.push(fallbackText);

        const lastHistoryPart =
          geminiExecutor.history[geminiExecutor.history.length - 1]?.parts?.[0];
        if (lastHistoryPart && !lastHistoryPart.functionResponse) {
          lastHistoryPart.text = fallbackText;
        }
      } else {
        generationResults.push(
          "System warning: Received completely empty response from the executor.",
        );
      }

      conversationHistory = geminiExecutor.history;
    }

    let finalOutputs = generationResults.flatMap((output) => {
      if (output?.type === "text") return output.text;
      if (typeof output === "string") return output;
      if (output?.data) {
        const fileBlob = Utilities.newBlob(
          Utilities.base64Decode(output.data),
          output.mimeType || "application/octet-stream",
          "downloaded_file",
        );
        return [
          fileBlob,
          `Attachment payload successfully loaded (MIME type: ${output.mimeType}).`,
        ];
      }
      return [
        "System Warning: Received a file attachment signature, but content payload was missing.",
      ];
    });

    const standardTextResults = finalOutputs.filter(
      (e) => typeof e === "string",
    );

    // Final summarization phase if text results exist
    if (standardTextResults.length > 0) {
      const geminiSummarizer = new GeminiWithFiles({
        apiKey: this.clientObject.apiKey,
        model: this.model,
        history: conversationHistory,
      });
      const finalSummary = geminiSummarizer.generateContent({
        parts: [
          {
            text: "Synthesize the results strictly answering the user's initial prompt.",
          },
          { text: `<Question>${this.clientObject.prompt}</Question>` },
          { text: `<Answers>\n${standardTextResults.join("\n")}\n</Answers>` },
        ],
      });
      geminiOrchestrator.history = geminiSummarizer.history;
      finalOutputs = [
        finalSummary,
        ...finalOutputs.filter((e) => typeof e !== "string"),
      ];
    }

    this.values.push([
      this.date,
      null,
      null,
      "Client side",
      JSON.stringify(finalOutputs),
    ]);
    console.log("--- end: Sequence Execution completed.");

    return { result: finalOutputs, history: geminiOrchestrator.history };
  }

  /**
   * ### Description
   * Validates core properties required for MCP Client execution.
   *
   * @param {Object} object
   * @private
   */
  errorProcessForClient_(object) {
    if (!object.apiKey) {
      throw new Error(
        "Missing requirement: Gemini API Key configuration is necessary.",
      );
    }
    if (!object.prompt) {
      throw new Error(
        "Missing requirement: An operational Prompt string must be provided.",
      );
    }
  }

  /**
   * ### Description
   * Utility to safely merge function parameter dictionaries without overwriting core states.
   *
   * @param {Object} funcDictA
   * @param {Object} funcDictB
   * @return {Object} Merged function object mapping.
   * @private
   */
  mergeFunctions_(funcDictA, funcDictB) {
    const mergedParams = { ...funcDictA.params_, ...funcDictB.params_ };
    const extractFuncs = Object.keys(funcDictB.params_).reduce((acc, k) => {
      acc[k] = funcDictB[k];
      return acc;
    }, {});

    return { ...funcDictA, ...extractFuncs, params_: mergedParams };
  }

  /**
   * ### Description
   * Instantiates fundamental tools and orchestrates them alongside user-configured and server-provided tools.
   *
   * @param {Object} serverProvidedFuncs
   * @param {Object} userCustomFuncs
   * @return {Object} Unified toolkit.
   * @private
   */
  getClientFunctions_(serverProvidedFuncs, userCustomFuncs) {
    let baseToolkit = {
      params_: {
        without_function: {
          description:
            "Use this exclusively to provide the final conversational response to the user when other tools cannot resolve the task. Do NOT use this to confirm task completion. Output only the final answer.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "Detailed description of the task requirements.",
              },
              response: {
                type: "string",
                description:
                  "The final answer or conversational response to the user.",
              },
            },
            required: ["task", "response"],
          },
        },
        check_process: {
          description:
            "Inspect conversational history logs and decide whether the orchestration must halt prematurely due to errors or achieved states.",
          parameters: {
            type: "object",
            properties: {
              stopProcess: {
                type: "boolean",
                description:
                  "Return True to entirely halt processing, False to proceed to the next operation.",
              },
              task: {
                type: "string",
                description: "The task being evaluated.",
              },
              reason: {
                type: "string",
                description:
                  "The descriptive cause backing the halt or continuation decision.",
              },
            },
            required: ["stopProcess", "task", "reason"],
          },
        },
      },
      // INJECTS: _gemini_halt to force GeminiWithFiles loop break cleanly.
      without_function: ({ task, response }) => {
        console.log(
          `--- Executing intrinsic handler: without_function | Prompt: ${task}`,
        );
        return {
          _gemini_halt: true,
          handler: "without_function",
          task,
          result: response,
        };
      },
      check_process: ({ stopProcess, task, reason }) => {
        console.log(
          `--- Check Process Triggered | Task: ${task} | Halting: ${stopProcess} | Reason: ${reason}`,
        );
        return {
          _gemini_halt: stopProcess,
          handler: "check_process",
          task,
          result: { stopProcess, reason },
        };
      },
    };

    if (
      serverProvidedFuncs?.params_ &&
      Object.keys(serverProvidedFuncs).length > 1
    ) {
      baseToolkit = this.mergeFunctions_(baseToolkit, serverProvidedFuncs);
    }

    if (userCustomFuncs?.params_ && Object.keys(userCustomFuncs).length > 1) {
      baseToolkit = this.mergeFunctions_(baseToolkit, userCustomFuncs);
    }

    return baseToolkit;
  }

  /**
   * ### Description
   * Constructs network requests properly routing standard URLs vs GAS Web Apps with customizable headers.
   *
   * @param {Object} object
   * @param {string} object.u - URL to request.
   * @param {Object|string} object.obj - JSON payload to send.
   * @param {Object} [object.customHeaders={}] - Specific headers bound to the MCP server.
   * @return {Object} Valid configurations for UrlFetchApp.
   * @private
   */
  createRequest_({ u, obj, customHeaders = {} }) {
    const rawUrl = u.trim();
    const { url, queryParameters } = this.parseQueryParameters_(rawUrl);
    const urlSegment = url.split("/").pop();
    const fullUrl = this.addQueryParameters_(url.trim(), queryParameters || {});

    const requestConfig = {
      url: fullUrl,
      payload: obj,
      muteHttpExceptions: true,
      contentType: "application/json",
    };

    let activeHeaders = {};

    // Authenticate if connecting to GAS-deployed executions
    if (["exec", "dev"].includes(urlSegment)) {
      activeHeaders = { ...this.headers };
    }

    // Merge explicitly provided custom server headers
    if (customHeaders && Object.keys(customHeaders).length > 0) {
      activeHeaders = { ...activeHeaders, ...customHeaders };
    }

    if (Object.keys(activeHeaders).length > 0) {
      requestConfig.headers = activeHeaders;
    }

    return requestConfig;
  }

  /**
   * ### Description
   * Dispatches targeted capability requests to all bound MCP Servers.
   *
   * @param {string} method - Request capability standard method (e.g., resources/list).
   * @return {Object[]} List of crafted Request Objects.
   * @private
   */
  getRequest_(method) {
    this.id++;
    const payloadStr = JSON.stringify({
      method,
      params: {},
      jsonrpc: this.jsonrpc,
      id: this.id,
    });
    return this.mcpServerObj.map(({ serverUrl, headers }) =>
      this.createRequest_({ u: serverUrl, obj: payloadStr, customHeaders: headers }),
    );
  }

  /**
   * ### Description
   * Executes network fetches to synchronize capability lists from bound MCP Servers.
   *
   * @param {Object} object
   * @private
   */
  getLists_({ method, requests }) {
    this.fetch_(requests).forEach((response, index) => {
      if (response.getResponseCode() === 200) {
        try {
          const parsedRes = JSON.parse(response.getContentText());
          if (parsedRes?.result) {
            this.mcpServerObj[index][method] = parsedRes;
          }
        } catch (error) {
          // Silent catch to continue loop resilience
        }
      }
    });
  }

  /**
   * ### Description
   * Parses server arrays dynamically using high-speed concurrent processing for execution efficiency.
   * Modified to use independent requests instead of JSON-RPC arrays to ensure stable routing compatibility.
   *
   * @param {Object} object
   * @private
   */
  parseBatchProcess_({ mcpServerUrls, reqs }) {
    const requestPool = [];
    const metadata = [];

    reqs.forEach(({ method, requests }) => {
      requests.forEach((reqConfig, serverIndex) => {
        requestPool.push(reqConfig);
        metadata.push({ method, serverIndex });
      });
    });

    if (requestPool.length > 0) {
      this.fetch_(requestPool).forEach((response, i) => {
        if (response.getResponseCode() === 200) {
          try {
            const { method, serverIndex } = metadata[i];
            const parsedObj = JSON.parse(response.getContentText());
            if (parsedObj?.result) {
              this.mcpServerObj[serverIndex][method] = parsedObj;
            }
          } catch (error) {
            // Processing failure intentionally omitted for stability.
          }
        }
      });
    }
  }

  /**
   * ### Description
   * Converts MCP Server resources and tools into dynamically bound JavaScript functions executable by Gemini API.
   * Ensures function contexts correctly align back to the server requests.
   *
   * @private
   */
  createFunctions_() {
    const routingMap = {
      "resources/list": "resources/read",
      "prompts/list": "prompts/get",
      "tools/list": "tools/call",
    };
    const validEndpoints = Object.keys(routingMap);

    const fetchWrapper = ({ payload, serverUrl, customHeaders }) => {
      const responseArray = this.fetch_([
        this.createRequest_({ u: serverUrl, obj: JSON.stringify(payload), customHeaders }),
      ]);
      return responseArray[0].getContentText();
    };

    const aggregatedServerTools = this.mcpServerObj.reduce(
      (accumulator, serverEntry) => {
        const { serverUrl, headers } = serverEntry;

        validEndpoints.forEach((endpointKey) => {
          const subKey = endpointKey.split("/")[0];
          const resourceResult =
            serverEntry[endpointKey]?.result ?? serverEntry[endpointKey];
          const toolArray = resourceResult?.[subKey] ?? [];

          toolArray.forEach((definition) => {
            const { name, description, uri, inputSchema } = definition;
            const cleanName = name.replaceAll(" ", "_").trim();
            let toolMetadata = null;
            let executionCallback = null;

            if (subKey === "resources") {
              toolMetadata = { title: name, description };
              executionCallback = () => {
                console.log(`--- Fetching Resource Execution: ${cleanName}`);
                const dispatchPayload = {
                  method: routingMap[endpointKey],
                  params: { uri },
                  jsonrpc: this.jsonrpc,
                  id: this.id++,
                };
                return fetchWrapper({ payload: dispatchPayload, serverUrl, customHeaders: headers });
              };
            } else if (subKey === "prompts") {
              const propMap = (definition.arguments || []).reduce(
                (mapAcc, argObj) => {
                  mapAcc[argObj.name.replaceAll(" ", "_").trim()] = {
                    type: "string",
                    description: argObj.description,
                  };
                  return mapAcc;
                },
                {},
              );

              toolMetadata = {
                title: name,
                description,
                parameters: {
                  type: "object",
                  properties: propMap,
                  required: Object.keys(propMap),
                },
              };
              executionCallback = (params) => {
                console.log(`--- Generating Prompt Logic: ${cleanName}`);
                const dispatchPayload = {
                  method: routingMap[endpointKey],
                  params: { name: cleanName, arguments: params },
                  jsonrpc: this.jsonrpc,
                  id: this.id++,
                };
                return fetchWrapper({ payload: dispatchPayload, serverUrl, customHeaders: headers });
              };
            } else if (subKey === "tools") {
              toolMetadata = {
                title: name,
                description,
                parameters: inputSchema,
              };
              executionCallback = (params) => {
                console.log(`--- Activating Tool Service: ${cleanName}`);
                const dispatchPayload = {
                  method: routingMap[endpointKey],
                  params: { name: cleanName, arguments: params },
                  jsonrpc: this.jsonrpc,
                  id: this.id++,
                };
                return fetchWrapper({ payload: dispatchPayload, serverUrl, customHeaders: headers });
              };
            }

            if (toolMetadata && executionCallback) {
              accumulator.params_[cleanName] = {
                title: name,
                description,
                ...toolMetadata,
              };
              accumulator[cleanName] = executionCallback;
            }
          });
        });
        return accumulator;
      },
      { params_: {} },
    );

    let finalUserTools = null;
    if (
      this.clientObject.functions?.params_ &&
      Object.keys(this.clientObject.functions).length > 1
    ) {
      finalUserTools = { ...this.clientObject.functions };
    }

    const integratedToolkit = this.getClientFunctions_(
      aggregatedServerTools,
      finalUserTools,
    );

    if (integratedToolkit.params_) {
      console.log(
        `Capabilities mapped: ${Object.keys(integratedToolkit.params_).length} distinct operations loaded.`,
      );
    }

    /** @private */
    this.functions = integratedToolkit;
  }

  /**
   * ### Description
   * Initiates the protocol handshakes for server discovery, caching supported models, tools, and capabilities.
   *
   * @param {Object} object
   * @return {MCPApp}
   * @private
   */
  prepareClient_(object) {
    this.clientObject = object;
    const {
      mcpServerUrls,
      batchProcess = false,
      mcpServerObj,
    } = this.clientObject;

    // Load pre-installed Server Object library boundaries
    if (Array.isArray(mcpServerObj) && mcpServerObj.length > 0) {
      const flatLibTools = mcpServerObj.flat().reduce(
        (acc, entry) => {
          if (entry.type === "tools/list") {
            const schemaKey = entry.value.name;
            acc[schemaKey] = entry.function;
            acc.params_[schemaKey] = {
              name: schemaKey,
              description: entry.value.description,
              parameters: entry.value.inputSchema,
            };
          }
          return acc;
        },
        { params_: {} },
      );

      if (
        this.clientObject.functions?.params_ &&
        Object.keys(this.clientObject.functions).length > 1
      ) {
        this.clientObject.functions = this.mergeFunctions_(
          this.clientObject.functions,
          flatLibTools,
        );
      } else {
        this.clientObject.functions = flatLibTools;
      }
    }

    // Dynamic normalization validating both traditional raw strings and object configurations
    const validServers = (mcpServerUrls || []).reduce((acc, item) => {
      if (typeof item === 'string' && item.trim() !== '') {
        acc.push({ serverUrl: item.trim(), headers: {}, original: item });
      } else if (typeof item === 'object' && item !== null) {
        const key = Object.keys(item)[0];
        const val = item[key];
        if (val && val.httpUrl) {
          acc.push({ serverUrl: val.httpUrl.trim(), headers: val.headers || {}, original: item });
        }
      }
      return acc;
    }, []);

    if (validServers.length > 0) {
      // Execute Protocol Initializations
      const methodInit = "initialize";
      console.log(`--- Executing Handshake: ${methodInit} (Client --> Server)`);

      const payloadInit = {
        method: methodInit,
        params: {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: this.clientInfo,
        },
        jsonrpc: this.jsonrpc,
        id: ++this.id,
      };

      const requestsInit = validServers.map((n) =>
        this.createRequest_({ u: n.serverUrl, obj: JSON.stringify(payloadInit), customHeaders: n.headers }),
      );

      this.mcpServerObj = this.fetch_(requestsInit).reduce(
        (acc, response, idx) => {
          if (response.getResponseCode() === 200) {
            const bodyText = response.getContentText();
            this.values.push([
              this.date,
              methodInit,
              this.id,
              "server --> client",
              bodyText,
            ]);
            try {
              acc.push({
                serverUrl: validServers[idx].serverUrl,
                headers: validServers[idx].headers,
                original: validServers[idx].original,
                [methodInit]: JSON.parse(bodyText),
              });
            } catch (e) {
              console.warn(
                `Critical Format Error. Payload from "${validServers[idx].serverUrl}" is not standard MCP JSON. Snippet: ${bodyText.substring(0, 50)}...`,
              );
              acc.push({
                serverUrl: validServers[idx].serverUrl,
                headers: validServers[idx].headers,
                original: validServers[idx].original,
                [methodInit]: null,
              });
            }
          }
          return acc;
        },
        [],
      );

      // Commit Connection Registrations
      const methodNotifyInit = "notifications/initialized";
      const methodNotifyCancel = "notifications/cancelled";
      console.log(
        `--- Confirming Connections: ${methodNotifyInit} / ${methodNotifyCancel}`,
      );

      const payloadNotifyInit = {
        method: methodNotifyInit,
        jsonrpc: this.jsonrpc,
      };
      const payloadNotifyCancel = {
        method: methodNotifyCancel,
        params: {
          requestId: this.id,
          reason: `Halted: Integration failure. InternalError code ${this.ErrorCode.InternalError}`,
          jsonrpc: this.jsonrpc,
        },
      };

      const categorizedReqs = this.mcpServerObj.reduce(
        (acc, serverObj) => {
          const payloadStr = JSON.stringify(
            serverObj[methodInit] ? payloadNotifyInit : payloadNotifyCancel,
          );
          const configTarget = serverObj[methodInit]
            ? acc.notifiedReqs
            : acc.canceledReqs;
          configTarget.push(
            this.createRequest_({ u: serverObj.serverUrl, obj: payloadStr, customHeaders: serverObj.headers }),
          );
          return acc;
        },
        { notifiedReqs: [], canceledReqs: [] },
      );

      if (categorizedReqs.notifiedReqs.length === 0) {
        this.values.push([
          this.date,
          methodNotifyInit,
          this.id,
          "At client",
          "Fatal: No servers responded to initialized capability.",
        ]);
        return this;
      }

      if (categorizedReqs.canceledReqs.length > 0) {
        const cancelledLogs = this.fetch_(categorizedReqs.canceledReqs).map(
          (res) => res.getContentText(),
        );
        console.log(`Connection Removals Triggered:`, cancelledLogs);
      }

      this.fetch_(categorizedReqs.notifiedReqs);

      // Mapping Server Tool Capabilities
      const resourceMethods = ["resources/list", "prompts/list", "tools/list"];
      const capabilityJobs = resourceMethods.map((m) => ({
        method: m,
        requests: this.getRequest_(m),
      }));

      if (batchProcess) {
        console.log(
          "--- Extracting Tool Lists (Concurrent Transmission Protocol)",
        );
        this.parseBatchProcess_({ mcpServerUrls, reqs: capabilityJobs });
      } else {
        console.log("--- Extracting Tool Lists (Linear Transmission Protocol)");
        capabilityJobs.forEach((job) => this.getLists_(job));
      }

      this.createFunctions_();
    } else {
      console.log("--- Status Warning: No remote MCP Server URLs assigned.");
      this.values.push([
        this.date,
        null,
        null,
        "At client",
        "No MCP Server URLs provided.",
      ]);

      let manualFunctions = null;
      if (
        this.clientObject.functions?.params_ &&
        Object.keys(this.clientObject.functions).length > 1
      ) {
        manualFunctions = { ...this.clientObject.functions };
      }

      const localToolkit = this.getClientFunctions_(null, manualFunctions);
      if (localToolkit.params_) {
        console.log(
          `Locally executing capabilities. Distinct operations mapped: ${Object.keys(localToolkit.params_).length}`,
        );
      }

      /** @private */
      this.functions = localToolkit;
    }

    return this;
  }

  /*****************************************************************************************************
   * TOOLS & UTILITIES
   *****************************************************************************************************/

  /**
   * ### Description
   * Exposes configured and dynamically imported tools configured in the agent network.
   *
   * @return {Object} Dictionary mappings containing tool executors.
   */
  get getFunctions() {
    return this.functions;
  }

  /**
   * ### Description
   * Bulk execution framework wrapping GAS UrlFetchApp mechanism.
   *
   * @param {Object[]} requests - UrlFetchApp payload configuration objects.
   * @return {GoogleAppsScript.URL_Fetch.HTTPResponse[]}
   * @private
   */
  fetch_(requests) {
    return UrlFetchApp.fetchAll(requests);
  }

  /**
   * ### Description
   * Extrapolates request mapping content correctly, accounting for raw text parsing.
   *
   * @param {Object} e - DoPost Google Event payload.
   * @return {Object|null}
   * @private
   */
  parseObj_(e) {
    if (e?.postData?.contents) {
      return JSON.parse(e.postData.contents);
    }
    return null;
  }

  /**
   * ### Description
   * Analyzes an endpoint path returning distinct query object separations.
   *
   * @param {string} url - Valid string path.
   * @return {Object|null}
   * @private
   */
  parseQueryParameters_(url) {
    if (typeof url !== "string") {
      throw new Error(
        "Invalid format. Provided URL definition must be a string format.",
      );
    }

    const parts = url.split("?");
    if (parts.length === 1) return { url: parts[0], queryParameters: null };

    const [baseUrl, query] = parts;
    if (query) {
      const queryParameters = query.split("&").reduce((acc, paramBlock) => {
        const [keyRaw, valRaw] = paramBlock.split("=");
        const key = keyRaw.trim();
        const valueStr = valRaw.trim();
        const valueDecoded = isNaN(valueStr) ? valueStr : Number(valueStr);

        if (acc[key]) acc[key].push(valueDecoded);
        else acc[key] = [valueDecoded];

        return acc;
      }, {});
      return { url: baseUrl, queryParameters };
    }
    return null;
  }

  /**
   * ### Description
   * Applies parameterized attributes sequentially building valid REST URLs.
   *
   * @param {string} url - Unformatted base endpoint.
   * @param {Object} obj - Parameters tree schema.
   * @return {string}
   * @private
   */
  addQueryParameters_(url, obj) {
    if (typeof url !== "string" || !obj) {
      throw new Error(
        "Validation mismatch. Valid string URL and object config must be supplied.",
      );
    }
    const params = Object.entries(obj);
    if (params.length === 0) return url;

    const queryString = params
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map(
              (entry) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(entry)}`,
            )
          : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");

    return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
  }

  /**
   * ### Description
   * Transmits generated diagnostic arrays effectively truncating data to enforce GAS row integrity limits (Max 50k chars).
   *
   * @return {void}
   * @private
   */
  log_() {
    if (!this.sheet || this.values.length === 0) return;
    const sanitizedData = this.values.map((row) =>
      row.map((cell) =>
        typeof cell === "string" ? cell.substring(0, 40000) : cell,
      ),
    );
    this.sheet
      .getRange(
        this.sheet.getLastRow() + 1,
        1,
        sanitizedData.length,
        sanitizedData[0].length,
      )
      .setValues(sanitizedData);
  }
};


/**
 * MCPA2Aserver: Class Object for Consolidating Generative AI Protocols
 * Author: Tanaike
 * v2.1.0 (History-Aware Update)
 * GitHub: https://github.com/tanaikech/MCPA2Aserver-GAS-Library
 *
 * Refactored Version with Explicit Override, Integrated Sheet Logging, Directional Traffic Tracking, 
 * and Seamless Server-Side Chat History Injection for A2A Protocols.
 *
 * ### Description
 * This class provides a consolidated server solution for Model Context Protocol (MCP) and Agent-to-Agent (A2A) communication directly within your Google Apps Script project.
 * It strictly tracks the flow of data: Client -> Server, Internal processing, and Server -> Client, ensuring high observability.
 *
 * ### Detailed Usage Instructions
 *
 * #### 1. Initialization
 * Instantiate the class and inject the `LockService` from your Google Apps Script environment.
 * ```javascript
 * const mcpA2A = new MCPA2Aserver();
 * mcpA2A.setServices({ lock: LockService.getScriptLock() });
 * ```
 *
 * #### 2. Configuration & History Injection (New)
 * Configure your server credentials. You can now inject a "Base History" (e.g., System Persona or absolute facts) 
 * that the remote A2A server will always prepend to the incoming client history.
 * ```javascript
 * mcpA2A.apiKey = "YOUR_GEMINI_API_KEY";
 * mcpA2A.model = "models/gemini-3-flash-preview";
 * mcpA2A.setHistory([
 *   { role: "user", parts: [{ text: "System Context: You are a financial expert." }] },
 *   { role: "model", parts: [{ text: "Understood. I will act as a financial expert." }] }
 * ]);
 * ```
 *
 * #### 3. Context Definition & Tool Routing
 * Create a `context` object containing `functions` (tool logic & schema) and `agentCard` (agent metadata for A2A).
 * The server intelligently routes tools based on the `type` property defined within `functions.params_[tool_name].type`:
 * - `type: "mcp"` (or "MCP"): The tool is exclusively bundled into the MCP Server payload.
 * - `type: "a2a"` (or "A2A"): The tool is exclusively bundled into the A2A Server payload.
 * - `type: undefined`: The tool is registered to BOTH servers automatically.
 *
 * #### 4. Manual Server Overrides (Optional)
 * You can bypass auto-detection and force the server behavior using explicit boolean flags:
 * ```javascript
 * mcpA2A.a2a = true;  // Force A2A server activation
 * mcpA2A.mcp = false; // Force MCP server deactivation
 * ```
 *
 * #### 5. Execution
 * Execute the main dispatcher within your `doGet` or `doPost` functions.
 * ```javascript
 * const response = mcpA2A.main(e, context, logCallback);
 * return response;
 * ```
 */
var MCPA2Aserver = class MCPA2Aserver {
  /**
   * Initializes the MCPA2Aserver properties.
   */
  constructor() {
    /** @type {String} API key for using Gemini API. */
    this.apiKey = "";

    /** @type {String} Model version to be used for generative AI. */
    this.model = "models/gemini-3-flash-preview";

    /** @type {String} Access key to restrict access to the Web Apps. */
    this.accessKey = "";

    /** @type {String} Google Sheets ID used for storing logs. */
    this.logSpreadsheetId = "";

    /** @type {Boolean} If true, tools from ToolsForMCPServer library are integrated automatically. */
    this.useToolsForMCPServer = false;

    /** @type {String} The URL of the deployed Web App. */
    this.webAppsUrl = "";

    /** @type {Boolean|null} Explicitly enable/disable MCP Server routing. Null implies auto-detection. */
    this.mcp = null;

    /** @type {Boolean|null} Explicitly enable/disable A2A Server routing. Null implies auto-detection. */
    this.a2a = null;

    /** @type {GoogleAppsScript.Lock.Lock|null} LockService instance injected from the executing environment. */
    this.lock = null;

    /** @type {Array<Object>} Base history array for A2A context injection. */
    this.history = [];

    /** @private @type {Array<Object>} Internal log storage */
    this.logs = [];

    /** @private @type {Function|null} Real-time logging callback */
    this.logCallback = null;

    /** @private @type {String} Unique execution identifier */
    this.execId = "";

    /** @private */
    this.CONFIG = {
      API_KEY: this.apiKey,
      MODEL: this.model,
      WELL_KNOWN_PATHS: [
        ".well-known/agent-card.json",
        ".well-known/agent.json",
      ],
      METHODS: {
        A2A: ["tasks/send", "message/send"],
        MCP: [
          "initialize",
          "notifications/initialized",
          "notifications/cancelled",
          "resources/list",
          "prompts/list",
          "tools/list",
          "tools/call",
        ],
      },
    };
  }

  /**
   * Injects dependencies such as LockService from the calling context.
   *
   * @param {Object} services - Object containing the services.
   * @param {GoogleAppsScript.Lock.Lock} services.lock - The lock instance from the executing client context.
   * @return {MCPA2Aserver}
   */
  setServices(services = {}) {
    const { lock } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    return this;
  }

  /**
   * Sets the base conversation history for the server.
   * This history will be prepended to the client's history during A2A execution.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {MCPA2Aserver} This instance for chaining.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error("CRITICAL: History must be an array of objects compatible with GeminiWithFiles.");
    }
    this.history = history;
    return this;
  }

  /**
   * Retrieves the current base conversation history configured on the server.
   *
   * @returns {Array<Object>} The current base history array.
   */
  getHistory() {
    return this.history;
  }

  /**
   * Main Dispatcher Method
   * Analyzes context, routes the request, and flushes execution logs to the specified Google Sheet.
   *
   * @param {EventObject} e - The event object from doGet/doPost
   * @param {Object} context - Custom context containing { functions, agentCard }.
   * @param {Function} [callback=null] - Optional callback function for real-time logging.
   * @return {ContentService.TextOutput} The JSON response
   */
  main(e, context = null, callback = null) {
    this.execId = Utilities.getUuid();
    this.logs = [];
    this.logCallback = callback;

    this.addLog_("Main dispatcher initiated.", "INFO", "Internal");

    const incomingReqInfo = this.extractRequestInfo_(e);
    this.addLog_(
      `Incoming Request: ${incomingReqInfo}`,
      "INFO",
      "Client -> Server",
    );

    let response = null;

    try {
      if (!this.lock) {
        throw new Error(
          "Fatal: LockService is required. Set it using setServices({ lock: LockService.getScriptLock() }).",
        );
      }
      if (!this.apiKey) {
        throw new Error("Set your API key for using Gemini API.");
      }
      if (this.useToolsForMCPServer === true && !this.webAppsUrl) {
        throw new Error("When you use ToolsForMCPServer, set webAppsUrl.");
      }

      this.CONFIG.API_KEY = this.apiKey;
      this.CONFIG.MODEL = this.model;

      this.webAppsUrl =
        this.accessKey &&
        this.webAppsUrl &&
        !this.webAppsUrl.includes("accessKey=")
          ? `${this.webAppsUrl}?accessKey=${this.accessKey}`
          : this.webAppsUrl;

      let targetContext = context;
      if (this.useToolsForMCPServer === true) {
        this.addLog_(
          "Generating server context dynamically from ToolsForMCPServer.",
          "INFO",
          "Internal",
        );
        targetContext = this.createServerContext_();
      } else if (this.useToolsForMCPServer === false && !targetContext) {
        throw new Error("No context or tools provided.");
      }

      const processedServers = this.parseContext_(targetContext);
      const route = this.determineRoute_(e);
      this.addLog_(`Route determined as: ${route.type}`, "INFO", "Internal");

      let targetEvent = e;

      if (
        route.type === "A2A" &&
        this.a2a === true &&
        processedServers.processedA2AObj
      ) {
        // Safe History Injection for A2A payloads
        if (this.history && this.history.length > 0 && e.postData && e.postData.contents) {
          try {
            const postObj = JSON.parse(e.postData.contents);
            if (postObj.params && (postObj.method === "message/send" || postObj.method === "tasks/send")) {
              postObj.params.history = [...this.history, ...(postObj.params.history || [])];
              targetEvent = this.cloneEvent_(e);
              targetEvent.postData.contents = JSON.stringify(postObj);
              this.addLog_(`Injected ${this.history.length} base history elements into incoming A2A payload.`, "INFO", "Internal");
            }
          } catch(err) {
            this.addLog_(`Failed to inject history into payload: ${err.message}`, "WARN", "Internal");
          }
        }
        response = this.handleA2ARequest_(targetEvent, processedServers.processedA2AObj);
      } else if (
        route.type === "MCP" &&
        this.mcp === true &&
        processedServers.processedMCPObj
      ) {
        // MCP protocol is purely functional and operates without chat history context.
        response = this.handleMCPRequest_(targetEvent, processedServers.processedMCPObj);
      } else {
        this.addLog_(
          `Unhandled routing or disabled server. Route Type: ${route.type}, A2A Enabled: ${this.a2a}, MCP Enabled: ${this.mcp}`,
          "WARN",
          "Internal",
        );
        response = ContentService.createTextOutput("{}").setMimeType(
          ContentService.MimeType.JSON,
        );
      }
    } catch (err) {
      this.addLog_(`Execution Error: ${err.message}`, "ERROR", "Internal");
      response = ContentService.createTextOutput(
        JSON.stringify({ error: err.message }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    this.addLog_("Execution completed.", "INFO", "Internal");

    const outgoingResInfo =
      response && typeof response.getContent === "function"
        ? response.getContent()
        : "Unknown Content";
    this.addLog_(
      `Outgoing Response: ${outgoingResInfo}`,
      "INFO",
      "Server -> Client",
    );

    this.flushLogsToSheet_();

    return response;
  }

  /**
   * Safely clones the Google Apps Script Event Object to allow payload mutations.
   * GAS Event Objects are often read-only or contain prototype getters that fail standard destructuring.
   *
   * @private
   * @param {EventObject} e
   * @return {Object} Cloned Event Object
   */
  cloneEvent_(e) {
    if (!e) return e;
    return {
      queryString: e.queryString,
      parameter: e.parameter,
      parameters: e.parameters,
      contextPath: e.contextPath,
      contentLength: e.contentLength,
      pathInfo: e.pathInfo,
      postData: e.postData ? {
        length: e.postData.length,
        type: e.postData.type,
        contents: e.postData.contents,
        name: e.postData.name
      } : null
    };
  }

  /**
   * Helper to format incoming EventObject payload for clear logging.
   *
   * @private
   * @param {EventObject} e
   * @return {String}
   */
  extractRequestInfo_(e) {
    if (!e) return "No Event Object provided.";
    const method = e.postData ? "POST" : "GET";
    const path = e.pathInfo ? `/${e.pathInfo}` : "/";
    const payload =
      e.postData && e.postData.contents
        ? e.postData.contents
        : JSON.stringify(e.parameters || {});
    return `[${method}] Path: ${path} | Payload: ${payload}`;
  }

  /**
   * Retrieves the comprehensive execution logs.
   *
   * @return {Array<Object>} Array of log objects { timestamp, execId, direction, level, message }
   */
  getLogs() {
    return this.logs || [];
  }

  /**
   * Centralized internal logging utility with directional tracking.
   *
   * @private
   * @param {String} msg - Log message
   * @param {String} level - Log level (INFO, WARN, ERROR)
   * @param {String} direction - Data flow direction (Client -> Server, Server -> Client, Internal)
   */
  addLog_(msg, level = "INFO", direction = "Internal") {
    const logEntry = {
      timestamp: new Date().toISOString(),
      execId: this.execId,
      direction,
      level,
      message: msg,
    };
    this.logs.push(logEntry);
    if (typeof this.logCallback === "function") {
      try {
        this.logCallback(logEntry);
      } catch (err) {
        // Silently catch callback errors
      }
    }
  }

  /**
   * Flushes the accumulated execution logs to the designated Google Sheet via batch processing.
   *
   * @private
   */
  flushLogsToSheet_() {
    if (!this.logSpreadsheetId || this.logs.length === 0) return;

    let lockAcquired = false;
    try {
      if (this.lock) {
        this.lock.waitLock(10000);
        lockAcquired = true;
      }

      const ss = SpreadsheetApp.openById(this.logSpreadsheetId);
      const sheetName = "MCPA2Aserver_log";
      let sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }

      const headers = [
        "Timestamp",
        "Execution ID",
        "Direction",
        "Level",
        "Message",
      ];
      const lastRow = sheet.getLastRow();

      if (lastRow === 0) {
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      } else {
        const firstCell = sheet.getRange(1, 1).getValue();
        if (firstCell !== headers[0]) {
          sheet.insertRowBefore(1);
          sheet
            .getRange(1, 1, 1, headers.length)
            .setValues([headers])
            .setFontWeight("bold");
        }
      }

      const data = this.logs.map((log) => [
        log.timestamp,
        log.execId,
        log.direction,
        log.level,
        log.message,
      ]);

      const insertRow = sheet.getLastRow() + 1;
      sheet.getRange(insertRow, 1, data.length, data[0].length).setValues(data);
    } catch (err) {
      console.error(`Failed to flush logs to Google Sheet: ${err.stack}`);
    } finally {
      if (lockAcquired && this.lock) {
        this.lock.releaseLock();
      }
    }
  }

  /**
   * Parses the context to determine enabled servers and routes functions appropriately.
   * Respects explicit manual overrides if `this.a2a` or `this.mcp` are provided.
   *
   * @private
   * @param {Object} context - The context object containing { functions, agentCard }.
   * @return {Object} Parsed A2A and MCP objects ready for handlers.
   */
  parseContext_(context) {
    const { functions, agentCard } = context;
    const hasFunctions = !!functions;
    const hasAgentCard = !!agentCard;

    if (this.a2a === null) {
      this.a2a = hasFunctions && hasAgentCard;
      this.addLog_(`Auto-detected A2A status: ${this.a2a}`, "INFO", "Internal");
    } else {
      this.addLog_(
        `Explicit A2A override status: ${this.a2a}`,
        "INFO",
        "Internal",
      );
    }

    if (this.mcp === null) {
      this.mcp = hasFunctions;
      this.addLog_(`Auto-detected MCP status: ${this.mcp}`, "INFO", "Internal");
    } else {
      this.addLog_(
        `Explicit MCP override status: ${this.mcp}`,
        "INFO",
        "Internal",
      );
    }

    if (this.a2a && (!hasFunctions || !hasAgentCard)) {
      throw new Error(
        "Invalid Context: A2A server requires both 'functions' and 'agentCard'.",
      );
    }
    if (this.mcp && !hasFunctions) {
      this.addLog_(
        "MCP server enabled but no 'functions' provided. Running with empty tools.",
        "WARN",
        "Internal",
      );
    }

    const a2aFunctions = { params_: {} };
    const mcpTools = [];

    if (hasFunctions && functions.params_) {
      Object.keys(functions.params_).forEach((f) => {
        const typeRaw = functions.params_[f].type;
        const typeStr = typeRaw ? String(typeRaw).toLowerCase() : null;

        if (this.mcp && (!typeStr || typeStr === "mcp")) {
          mcpTools.push({
            type: "tools/list",
            function: functions[f],
            value: {
              name: f,
              description: functions.params_[f].description,
              inputSchema: functions.params_[f].parameters,
            },
          });
        }

        if (this.a2a && (!typeStr || typeStr === "a2a")) {
          a2aFunctions.params_[f] = functions.params_[f];
          a2aFunctions[f] = functions[f];
        }
      });
      this.addLog_(
        `Functions parsed efficiently. MCP tools: ${mcpTools.length}, A2A functions: ${Object.keys(a2aFunctions.params_).length}`,
        "INFO",
        "Internal",
      );
    }

    const serverInfo = agentCard
      ? {
          name: agentCard.name || "Server",
          version: agentCard.version || "1.0.0",
        }
      : { name: "MCP Server", version: "1.0.0" };

    const processedMCPObj = this.mcp
      ? [
          {
            type: "initialize",
            value: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: { listChanged: false } },
              serverInfo: serverInfo,
            },
          },
          ...mcpTools,
        ]
      : null;

    const processedA2AObj = this.a2a
      ? {
          functions: () => a2aFunctions,
          agentCard: () => agentCard,
        }
      : null;

    return { processedA2AObj, processedMCPObj };
  }

  /**
   * Creates the base context object using ToolsForMCPServer library logic.
   *
   * @private
   * @return {Object} The generic context object { functions, agentCard }.
   */
  createServerContext_() {
    try {
      const m = ToolsForMCPServer;
      m.apiKey = this.CONFIG.API_KEY;
      m.model = this.CONFIG.MODEL;

      const tools = m.getTools();
      const functions = [...tools]
        .filter((e) => e.type === "tools/list")
        .reduce(
          (acc, tool) => {
            const funcName = tool.value.name;
            acc.params_[funcName] = {
              description: tool.value.description,
              parameters: tool.value.inputSchema,
            };
            acc[funcName] = tool.function;
            return acc;
          },
          { params_: {} },
        );

      agentCard_ToolsForMCPServer.url = this.webAppsUrl;
      this.addLog_(
        "ToolsForMCPServer context generated successfully.",
        "INFO",
        "Internal",
      );

      return {
        functions: functions,
        agentCard: agentCard_ToolsForMCPServer,
      };
    } catch (err) {
      this.addLog_(
        `Error generating context from ToolsForMCPServer: ${err.stack}`,
        "ERROR",
        "Internal",
      );
      throw new Error("Failed to create context from ToolsForMCPServer.");
    }
  }

  /**
   * Determines the routing type based on the event object.
   *
   * @private
   * @param {EventObject} e - The event object from doGet/doPost
   * @return {Object} An object containing the route type ("A2A", "MCP", or "UNKNOWN").
   */
  determineRoute_(e) {
    if (e.pathInfo && this.CONFIG.WELL_KNOWN_PATHS.includes(e.pathInfo)) {
      return { type: "A2A" };
    }
    if (e.postData && e.postData.contents) {
      try {
        const obj = JSON.parse(e.postData.contents);
        if (obj.method) {
          if (this.CONFIG.METHODS.A2A.includes(obj.method)) {
            return { type: "A2A" };
          }
          if (this.CONFIG.METHODS.MCP.includes(obj.method)) {
            return { type: "MCP" };
          }
        }
      } catch (err) {
        this.addLog_(
          `Invalid JSON payload received: ${err.message}`,
          "WARN",
          "Internal",
        );
      }
    }
    return { type: "UNKNOWN" };
  }

  /**
   * Handles requests destined for the A2A Server.
   *
   * @private
   * @param {EventObject} e - The event object from doGet/doPost
   * @param {Object} A2AObj - The processed A2A context object.
   * @return {ContentService.TextOutput} The evaluated response.
   */
  handleA2ARequest_(e, A2AObj) {
    this.addLog_("Executing A2A Request Handler.", "INFO", "Internal");
    try {
      const { agentCard, functions } = A2AObj;
      const object = {
        eventObject: e,
        agentCard: agentCard,
        functions: functions,
        apiKey: this.apiKey,
        agentCardUrls: [],
      };

      const o = { model: this.CONFIG.MODEL };
      if (this.accessKey) o.accessKey = this.accessKey;
      if (this.logSpreadsheetId) {
        o.log = true;
        o.spreadsheetId = this.logSpreadsheetId;
      }
      const res = new A2AApp(o).setServices({ lock: this.lock }).server(object);
      this.addLog_("A2A Request handled successfully.", "INFO", "Internal");
      return res;
    } catch (err) {
      this.addLog_(`A2A Handle Error: ${err.stack}`, "ERROR", "Internal");
      return ContentService.createTextOutput(
        JSON.stringify({ error: err.message }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }

  /**
   * Handles requests destined for the MCP Server.
   *
   * @private
   * @param {EventObject} e - The event object from doGet/doPost
   * @param {Array<Object>} MCPObj - The processed MCP array object.
   * @return {ContentService.TextOutput} The evaluated response.
   */
  handleMCPRequest_(e, MCPObj) {
    this.addLog_("Executing MCP Request Handler.", "INFO", "Internal");
    try {
      const object = { eventObject: e, items: MCPObj };
      const o = {};
      if (this.accessKey) o.accessKey = this.accessKey;
      if (this.logSpreadsheetId) {
        o.log = true;
        o.spreadsheetId = this.logSpreadsheetId;
      }
      const res = new MCPApp(o).setServices({ lock: this.lock }).server(object);
      this.addLog_("MCP Request handled successfully.", "INFO", "Internal");
      return res;
    } catch (err) {
      this.addLog_(`MCP Handle Error: ${err.stack}`, "ERROR", "Internal");
      return ContentService.createTextOutput(
        JSON.stringify({ error: err.message }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }
};


/**
 * FileSearchApp: This is used with Gemini API.
 * (required) An API key for using the Gemini API
 * Author: Kanshi Tanaike
 * https://github.com/tanaikech/FileSearchApp
 *
 * Updated on 20251113 1048
 * version 1.0.0
 */

/**
 * Main entry point to interact with the FileSearch class.
 *
 * @param {object} options - The configuration object.
 * @param {string} options.method - The name of the FileSearch method to call (e.g., 'create', 'list', 'media_upload').
 * @param {string} options.apiKey - The Gemini API key.
 * @param {string} [options.model] - The Gemini model name.
 * @param {object} [options.config] - The configuration object specific to the method being called.
 * @returns {any} The result from the called method.
 */
function fileSearchEntryPoint(options = {}) {
  const { method, config = {}, ...constructorOptions } = options;
  if (!method) {
    throw new Error("A 'method' property must be specified in the options.");
  }

  const fileSearch = new FileSearch(constructorOptions);

  if (typeof fileSearch[method] !== "function") {
    throw new Error(
      `Method '${method}' does not exist on the FileSearch class.`
    );
  }

  return fileSearch[method](config);
}

/**
 * A class for interacting with the Google AI File Search API.
 */
class FileSearch {
  /**
   * @param {object} params - The parameters.
   * @param {string} params.apiKey - The Gemini API key.
   * @param {string} [params.model="models/gemini-2.5-flash"] - The Gemini model name.
   */
  constructor({
    apiKey,
    model = "models/gemini-2.5-flash" /** or models/gemini-2.5-pro */,
  }) {
    if (!apiKey) {
      throw new Error("API key is required.");
    }
    this.apiKey = apiKey;
    this.model = model;

    // Define base URLs as instance properties
    this.apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    this.uploadApiBaseUrl =
      "https://generativelanguage.googleapis.com/upload/v1beta";
  }

  // --- File Search Store Methods ---

  /**
   * Creates a new File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.displayName - The display name for the new store.
   * @returns {object} The created FileSearchStore object.
   */
  create({ displayName }) {
    const endpoint = "/fileSearchStores";
    const payload = {
      displayName: displayName || `sampleFileSearchStore-${Date.now()}`,
    };
    return this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
  }

  /**
   * Deletes a File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.fileSearchStoreName - The name of the store to delete.
   * @returns {string} A confirmation message.
   */
  remove({ fileSearchStoreName }) {
    if (!fileSearchStoreName) throw new Error("Provide fileSearchStoreName.");
    const endpoint = `/${fileSearchStoreName}`;
    const query = { force: "true" };
    this._request(endpoint, { method: "delete" }, query);
    return `"${fileSearchStoreName}" was successfully deleted.`;
  }

  /**
   * Gets information about a specific File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.fileSearchStoreName - The name of the store to retrieve.
   * @returns {object} The FileSearchStore object.
   */
  get({ fileSearchStoreName }) {
    if (!fileSearchStoreName) throw new Error("Provide fileSearchStoreName.");
    const endpoint = `/${fileSearchStoreName}`;
    return this._request(endpoint, {}, { fields: "*" });
  }

  /**
   * Lists all File Search Stores.
   * @returns {object[]} An array of all FileSearchStore objects.
   */
  list() {
    const endpoint = "/fileSearchStores";
    const results = [];
    let pageToken = "";
    do {
      const query = { pageSize: 20, pageToken };
      const response = this._request(endpoint, {}, query);
      if (response.fileSearchStores && response.fileSearchStores.length > 0) {
        results.push(...response.fileSearchStores);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    return results;
  }

  // --- Document Methods ---

  /**
   * Uploads files from various sources to a File Search Store.
   * @param {object} params - The parameters.
   * @returns {string} A confirmation message with the document name.
   */
  media_upload({
    fileSearchStoreName,
    displayName,
    text,
    mimeType,
    fileIds = [],
    folderId,
    urls = [],
    customMetadata = [],
    chunkingConfig = [],
  }) {
    // ref: https://ai.google.dev/gemini-api/docs/file-search#supported-files
    const supportedMimeTypes = [
      "application/dart",
      "application/ecmascript",
      "application/json",
      "application/ms-java",
      "application/msword",
      "application/pdf",
      "application/sql",
      "application/typescript",
      "application/vnd.curl",
      "application/vnd.dart",
      "application/vnd.ibm.secure-container",
      "application/vnd.jupyter",
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
      "application/x-csh",
      "application/x-hwp",
      "application/x-hwp-v5",
      "application/x-latex",
      "application/x-php",
      "application/x-powershell",
      "application/x-sh",
      "application/x-shellscript",
      "application/x-tex",
      "application/x-zsh",
      "application/xml",
      "application/zip",
      "text/1d-interleaved-parityfec",
      "text/RED",
      "text/SGML",
      "text/cache-manifest",
      "text/calendar",
      "text/cql",
      "text/cql-extension",
      "text/cql-identifier",
      "text/css",
      "text/csv",
      "text/csv-schema",
      "text/dns",
      "text/encaprtp",
      "text/enriched",
      "text/example",
      "text/fhirpath",
      "text/flexfec",
      "text/fwdred",
      "text/gff3",
      "text/grammar-ref-list",
      "text/hl7v2",
      "text/html",
      "text/javascript",
      "text/jcr-cnd",
      "text/jsx",
      "text/markdown",
      "text/mizar",
      "text/n3",
      "text/parameters",
      "text/parityfec",
      "text/php",
      "text/plain",
      "text/provenance-notation",
      "text/prs.fallenstein.rst",
      "text/prs.lines.tag",
      "text/prs.prop.logic",
      "text/raptorfec",
      "text/rfc822-headers",
      "text/rtf",
      "text/rtp-enc-aescm128",
      "text/rtploopback",
      "text/rtx",
      "text/sgml",
      "text/shaclc",
      "text/shex",
      "text/spdx",
      "text/strings",
      "text/t140",
      "text/tab-separated-values",
      "text/texmacs",
      "text/troff",
      "text/tsv",
      "text/tsx",
      "text/turtle",
      "text/ulpfec",
      "text/uri-list",
      "text/vcard",
      "text/vnd.DMClientScript",
      "text/vnd.IPTC.NITF",
      "text/vnd.IPTC.NewsML",
      "text/vnd.a",
      "text/vnd.abc",
      "text/vnd.ascii-art",
      "text/vnd.curl",
      "text/vnd.debian.copyright",
      "text/vnd.dvb.subtitle",
      "text/vnd.esmertec.theme-descriptor",
      "text/vnd.exchangeable",
      "text/vnd.familysearch.gedcom",
      "text/vnd.ficlab.flt",
      "text/vnd.fly",
      "text/vnd.fmi.flexstor",
      "text/vnd.gml",
      "text/vnd.graphviz",
      "text/vnd.hans",
      "text/vnd.hgl",
      "text/vnd.in3d.3dml",
      "text/vnd.in3d.spot",
      "text/vnd.latex-z",
      "text/vnd.motorola.reflex",
      "text/vnd.ms-mediapackage",
      "text/vnd.net2phone.commcenter.command",
      "text/vnd.radisys.msml-basic-layout",
      "text/vnd.senx.warpscript",
      "text/vnd.sosi",
      "text/vnd.sun.j2me.app-descriptor",
      "text/vnd.trolltech.linguist",
      "text/vnd.wap.si",
      "text/vnd.wap.sl",
      "text/vnd.wap.wml",
      "text/vnd.wap.wmlscript",
      "text/vtt",
      "text/wgsl",
      "text/x-asm",
      "text/x-bibtex",
      "text/x-boo",
      "text/x-c",
      "text/x-c++hdr",
      "text/x-c++src",
      "text/x-cassandra",
      "text/x-chdr",
      "text/x-coffeescript",
      "text/x-component",
      "text/x-csh",
      "text/x-csharp",
      "text/x-csrc",
      "text/x-cuda",
      "text/x-d",
      "text/x-diff",
      "text/x-dsrc",
      "text/x-emacs-lisp",
      "text/x-erlang",
      "text/x-gff3",
      "text/x-go",
      "text/x-haskell",
      "text/x-java",
      "text/x-java-properties",
      "text/x-java-source",
      "text/x-kotlin",
      "text/x-lilypond",
      "text/x-lisp",
      "text/x-literate-haskell",
      "text/x-lua",
      "text/x-moc",
      "text/x-objcsrc",
      "text/x-pascal",
      "text/x-pcs-gcd",
      "text/x-perl",
      "text/x-perl-script",
      "text/x-python",
      "text/x-python-script",
      "text/x-r-markdown",
      "text/x-rsrc",
      "text/x-rst",
      "text/x-ruby-script",
      "text/x-rust",
      "text/x-sass",
      "text/x-scala",
      "text/x-scheme",
      "text/x-script.python",
      "text/x-scss",
      "text/x-setext",
      "text/x-sfv",
      "text/x-sh",
      "text/x-siesta",
      "text/x-sos",
      "text/x-sql",
      "text/x-swift",
      "text/x-tcl",
      "text/x-tex",
      "text/x-vbasic",
      "text/x-vcalendar",
      "text/xml",
      "text/xml-dtd",
      "text/xml-external-parsed-entity",
      "text/yaml",
    ];

    const convMimeType_ = (fileBlob) => {
      if (!supportedMimeTypes.includes(fileBlob.getContentType())) {
        return UrlFetchApp.fetch(
          `https://drive.google.com/thumbnail?sz=w1000&id=${fileId}`,
          { headers: { authorization: "Bearer " + ScriptApp.getOAuthToken() } }
        ).getBlob();
      }
      return fileBlob;
    };

    const upload_ = ({ fileId, text, url }) => {
      let fileBlob;
      if (fileId) {
        fileBlob = DriveApp.getFileById(fileId).getBlob();
      } else if (text) {
        fileBlob = Utilities.newBlob(
          text,
          mimeType || MimeType.PLAIN_TEXT,
          displayName || `doc-${Date.now()}`
        );
      } else if (url) {
        fileBlob = UrlFetchApp.fetch(url).getBlob();
        if (fileBlob.getName().toLocaleLowerCase() == "undefined.html") {
          fileBlob.setName(`doc-${Date.now()}`);
        }
      } else {
        throw new Error("Provide one of 'text', 'fileId', or 'url'.");
      }
      const metadata = {
        displayName: fileBlob.getName(),
        mimeType: fileBlob.getContentType(),
        ...(customMetadata.length > 0 && { customMetadata }),
        ...(chunkingConfig.length > 0 && { chunkingConfig }),
      };
      const payload = {
        metadata: Utilities.newBlob(
          JSON.stringify(metadata),
          "application/json"
        ),
        file: convMimeType_(fileBlob),
      };
      const endpoint = `/${fileSearchStoreName}:uploadToFileSearchStore`;
      const operation = this._request(
        endpoint,
        { method: "post", payload },
        {},
        true
      );
      const finalOperation = this._pollOperation(operation);
      return `Processing complete for: ${metadata.displayName}\nDocument name is "${finalOperation.name}".`;
    };

    let res = [];
    if (text) {
      res.push(upload_({ text }));
    } else if (folderId) {
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      fileIds = [];
      while (files.hasNext()) {
        const file = files.next();
        fileIds.push(file.getId());
      }
      if (fileIds.length > 0) {
        res.push(...fileIds.map((fileId) => upload_({ fileId })));
      }
    } else if (fileIds && fileIds.length > 0) {
      res.push(...fileIds.map((fileId) => upload_({ fileId })));
    } else if (urls && urls.length > 0) {
      res.push(...urls.map((url) => upload_({ url })));
    }
    if (res.length > 0) {
      return res.join("\n");
    }
    return "No files were uploaded.";
  }

  /**
   * Imports a file from File Service to a FileSearchStore.
   * @param {object} params - The parameters.
   * @returns {object} The operation object.
   */
  import_file({
    fileSearchStoreName,
    fileName,
    customMetadata = [],
    chunkingConfig = [],
  }) {
    if (!fileName) throw new Error("Provide fileName.");
    const endpoint = `/${fileSearchStoreName}:importFile`;
    const payload = {
      fileName,
      ...(customMetadata.length > 0 && { customMetadata }),
      ...(chunkingConfig.length > 0 && { chunkingConfig }),
    };
    const operation = this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
    const finalOperation = this._pollOperation(operation);
    return `Processing complete for: ${fileName}\nDocument name is "${finalOperation.name}".`;
  }

  /**
   * Gets a specific document.
   * @param {object} params - The parameters.
   * @param {string} params.documentName - The name of the document to retrieve.
   * @returns {object} The Document object.
   */
  documents_get({ documentName }) {
    if (!documentName) throw new Error("Provide documentName.");
    const endpoint = `/${documentName}`;
    return this._request(endpoint, {}, { fields: "*" });
  }

  /**
   * Deletes a document.
   * @param {object} params - The parameters.
   * @param {string} params.documentName - The name of the document to delete.
   * @returns {string} A confirmation message.
   */
  documents_remove({ documentName }) {
    if (!documentName) throw new Error("Provide documentName.");
    const endpoint = `/${documentName}`;
    this._request(endpoint, { method: "delete" }, { force: "true" });
    return `"${documentName}" was successfully deleted.`;
  }

  /**
   * Lists all documents in a File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.fileSearchStoreName - The name of the store.
   * @returns {object[]} An array of Document objects.
   */
  documents_list({ fileSearchStoreName }) {
    if (!fileSearchStoreName) throw new Error("Provide fileSearchStoreName.");
    const endpoint = `/${fileSearchStoreName}/documents`;
    const results = [];
    let pageToken = "";
    do {
      const query = { pageSize: 20, pageToken };
      const response = this._request(endpoint, {}, query);
      if (response.documents && response.documents.length > 0) {
        results.push(...response.documents);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    return results;
  }

  /**
   * Performs semantic search over a Document.
   * @param {object} params - The parameters.
   * @param {string} params.name - The resource name of the document to search (e.g., 'fileSearchStores/my-store/documents/my-doc').
   * @param {string} params.query - The query to search for.
   * @param {number} [params.resultsCount] - The number of results to return.
   * @param {object[]} [params.metadataFilters] - Filters to apply to the search.
   * @returns {object} The search results.
   */
  documents_query({ name, query, resultsCount, metadataFilters = [] }) {
    if (!name || !query) {
      throw new Error(
        "Provide both 'name' (the document resource name) and 'query'."
      );
    }
    const endpoint = `/${name}:query`;
    const payload = { query };
    if (resultsCount) {
      payload.resultsCount = resultsCount;
    }
    if (metadataFilters && metadataFilters.length > 0) {
      payload.metadataFilters = metadataFilters;
    }
    return this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
  }

  // --- RAG Content Generation ---

  /**
   * Generates content using File Search Stores as a RAG tool.
   * @param {object} params - The parameters for content generation.
   * @returns {string} The generated text content.
   */
  generate_content({
    fileSearchStoreNames = [],
    prompt,
    metadataFilter = null,
  }) {
    const endpoint = `/${this.model}:generateContent`;
    const tools = [
      {
        fileSearch: {
          fileSearchStoreNames,
          ...(metadataFilter && { metadataFilter }),
        },
      },
    ];
    const payload = {
      contents: [{ parts: [{ text: prompt }], role: "user" }],
      ...(fileSearchStoreNames.length > 0 && { tools }),
    };
    const response = this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
    return response.candidates[0].content.parts.find((p) => p.text).text;
  }

  // --- Private Helper Methods ---

  /**
   * Polls a long-running operation until it's complete.
   * @param {object} operation - The initial operation object.
   * @returns {object} The completed operation object.
   */
  _pollOperation(operation) {
    let currentOperation = operation;
    while (!currentOperation.done) {
      Utilities.sleep(1500); // Wait before polling again
      const endpoint = `/${currentOperation.name}`;
      currentOperation = this._request(endpoint);
    }
    return currentOperation;
  }

  /**
   * Centralized method for making API requests.
   * @param {string} endpoint - The API endpoint path.
   * @param {object} options - The options for UrlFetchApp.
   * @param {object} queryParams - The query parameters.
   * @param {boolean} useUploadUrl - Whether to use the upload base URL.
   * @returns {object} The JSON response.
   */
  _request(endpoint, options = {}, queryParams = {}, useUploadUrl = false) {
    const baseUrl = useUploadUrl ? this.uploadApiBaseUrl : this.apiBaseUrl;
    const allQueryParams = { key: this.apiKey, ...queryParams };
    const queryString = Object.entries(allQueryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const url = `${baseUrl}${endpoint}?${queryString}`;
    const fetchOptions = {
      muteHttpExceptions: true,
      contentType: "application/json",
      ...options,
    };

    const response = UrlFetchApp.fetch(url, fetchOptions);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
      // For empty success responses (e.g., DELETE)
      if (responseBody === "") {
        return {};
      }
      return JSON.parse(responseBody);
    } else {
      throw new Error(`API Error: ${responseCode} - ${responseBody}`);
    }
  }
}
