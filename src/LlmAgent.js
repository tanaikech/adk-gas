/**
 * LlmAgent.js
 * [Production Release v2.0.0] - The Ultimate Autonomous Orchestrator with Multi-Channel Logging
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
var gasGlobalContext = this;

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
    this.maxTokensPerSession = config.maxTokensPerSession || null;

    // Hooks System
    this.hookManager = new GasHookManager(config.hooks || []);
    this.sessionId = "session_" + (typeof Utilities !== "undefined" ? Utilities.getUuid() : Math.random().toString(36).substring(2));

    // Internal state
    this.history = [];
    this.logs = [];
    this.services = null;
    this.capabilities = [];
    this.accumulatedTokens = 0;
    this._capabilitiesInitialized = false;
  }

  /**
   * Helper to execute prompt against model, wrapped with BeforeModel and AfterModel hooks.
   *
   * @param {Object} config - Gemini configuration object.
   * @param {string} query - The prompt query.
   * @returns {string} The output text.
   * @private
   */
  _generateContent(config, query) {
    // Construct request metadata to pass to BeforeModel
    const beforeResult = this.hookManager.execute("BeforeModel", {
      config,
      query,
      history: this.history || [],
      model: this.model
    });

    if (beforeResult.decision === "deny") {
      throw new Error(`Model request blocked by BeforeModel hook.`);
    }

    const activeConfig = beforeResult.config || config;
    const activeQuery = beforeResult.query || query;

    let text;
    // Check if the hook returned a mocked llm_response (allowing API call skip)
    const mockedResponse = beforeResult.hookSpecificOutput?.llm_response || beforeResult.llm_response;
    if (mockedResponse && mockedResponse.text !== undefined) {
      text = mockedResponse.text;
    } else {
      // Force exportTotalTokens to capture token consumption
      const clientConfig = { ...activeConfig, exportTotalTokens: true };
      const rawRes = new GeminiWithFiles(clientConfig).generateContent({ q: activeQuery });
      
      if (rawRes && typeof rawRes === 'object' && rawRes.returnValue !== undefined) {
        text = typeof rawRes.returnValue === 'string' ? rawRes.returnValue : JSON.stringify(rawRes.returnValue);
        const tokens = rawRes.totalTokenCount || 0;
        this.accumulatedTokens = (this.accumulatedTokens || 0) + tokens;
        
        // Quota Safeguard check
        if (this.maxTokensPerSession && this.accumulatedTokens > this.maxTokensPerSession) {
          throw new Error(`CRITICAL: Session aborted. Accumulated token count (${this.accumulatedTokens}) exceeded limit (${this.maxTokensPerSession}).`);
        }
      } else {
        text = rawRes;
      }
    }

    // Call AfterModel with request and response details
    const afterResult = this.hookManager.execute("AfterModel", {
      config: activeConfig,
      query: activeQuery,
      history: this.history || [],
      model: this.model,
      text: text
    });

    if (afterResult.decision === "deny") {
      throw new Error(`Model response blocked and discarded by AfterModel hook.`);
    }

    const modifiedResponse = afterResult.hookSpecificOutput?.llm_response || afterResult.llm_response;
    if (modifiedResponse && modifiedResponse.text !== undefined) {
      return modifiedResponse.text;
    }
    return afterResult.text !== undefined ? afterResult.text : text;
  }

  setServices(services = {}) {
    this.services = services;
    if (this.services.globalContext && this.hookManager) {
      this.hookManager.setGlobalContext(this.services.globalContext);
    }
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
      this.hookManager.execute("Notification", { message, data, toolName: data?.capability_id || "" });
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

  _executeTask(cap, executionPrompt, task = null) {
    if (!cap) {
      const config = {
        apiKey: this.apiKey,
        model: this.model,
        history: [...this.history],
      };
      return this._generateContent(config, executionPrompt);
    }

    switch (cap.type) {
      case "Native Tool": {
        const self = this;
        const funcs = {
          params_: {
            [cap.name]: {
              description: cap.description?.description || "",
              parameters: cap._tool.parameters,
            },
          },
        };
        
        // Wrap the native function with BeforeTool/AfterTool hook handlers to catch actual arguments
        funcs[cap.name] = function(args) {
          // 1. EXECUTE BeforeTool Hook with actual LLM-generated arguments
          const beforeToolRes = self.hookManager.execute("BeforeTool", {
            prompt: self.currentPrompt || "",
            toolName: cap.name,
            tool_name: cap.name,
            tool_input: args,
            capabilityId: cap.id,
            capability: cap
          });
          
          if (beforeToolRes.decision === "deny" || beforeToolRes.continue === false) {
            throw new Error(`Execution blocked by BeforeTool hook: ${beforeToolRes.reason || "Denied tool execution"}`);
          } else if (beforeToolRes.decision === "suspend") {
            // Save state to PropertiesService for Human-in-the-Loop recovery
            self.suspendedTask = {
              task: task,
              args: args,
              capabilityId: cap.id,
              toolName: cap.name,
              executionPrompt: beforeToolRes.executionPrompt || executionPrompt
            };
            self.saveState();
            throw new Error(`SUSPENDED: Execution suspended for human approval. SessionId: ${self.sessionId}`);
          }
          
          // Apply modified arguments if hook returned them
          const activeArgs = beforeToolRes.hookSpecificOutput?.tool_input || beforeToolRes.tool_input || args;
          
          // Run the original function
          let result = cap._tool.function(activeArgs);
          
          // 2. EXECUTE AfterTool Hook with execution result
          const afterToolRes = self.hookManager.execute("AfterTool", {
            prompt: self.currentPrompt || "",
            toolName: cap.name,
            tool_name: cap.name,
            tool_input: activeArgs,
            tool_response: { result: result },
            result: result,
            capability: cap
          });
          
          if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
            return `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
          }
          
          let finalResult = afterToolRes.result !== undefined ? afterToolRes.result : result;
          const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
          if (additionalToolContext) {
            finalResult = finalResult + "\n\n[Hook Context]:\n" + additionalToolContext;
          }
          return finalResult;
        };

        const config = {
          apiKey: this.apiKey,
          model: this.model,
          functions: funcs,
          history: [...this.history],
        };
        return this._generateContent(config, executionPrompt);
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
        // Inherit parent hooks security context and limits
        if (cap._agent) {
          if (this.hookManager) {
            cap._agent.hookManager = this.hookManager;
            cap._agent.sessionId = this.sessionId;
          }
          cap._agent.maxTokensPerSession = this.maxTokensPerSession;
          cap._agent.accumulatedTokens = this.accumulatedTokens;
        }
        try {
          const subRes = cap._agent.run(executionPrompt);
          if (cap._agent) {
            this.accumulatedTokens = cap._agent.accumulatedTokens;
          }
          return subRes;
        } catch (err) {
          if (cap._agent) {
            this.accumulatedTokens = cap._agent.accumulatedTokens;
          }
          throw err;
        }
      case "Agent Skill": {
        const config = {
          apiKey: this.apiKey,
          model: this.model,
          systemInstruction: {
            parts: [{ text: `Strictly apply this skill:\n\n${cap.content}` }],
          },
          history: [...this.history],
        };
        return this._generateContent(config, executionPrompt);
      }
      case "Built-in Tool": {
        const config = {
          apiKey: this.apiKey,
          model: this.model,
          tools: [cap._tool],
          history: [...this.history],
        };
        return this._generateContent(config, executionPrompt);
      }
      default:
        throw new Error(`Unknown capability: ${cap.type}`);
    }
  }

  run(prompt, logCallback = null) {
    try {
      this.startTime = Date.now();
      this.currentPrompt = prompt;

      // Sync sessionId to hookManager
      if (this.hookManager) {
        this.hookManager.sessionId = this.sessionId || this.hookManager.sessionId;
      }

      // EXECUTE SessionStart Hook
      const sessionStartRes = this.hookManager.execute("SessionStart", { prompt, source: "startup" });
      prompt = sessionStartRes.prompt || prompt;
      const sessionContext = sessionStartRes.hookSpecificOutput?.additionalContext || sessionStartRes.additionalContext;
      if (sessionContext) {
        prompt = prompt + "\n\n[Session Start Context]:\n" + sessionContext;
      }

      const log = (message, data = null) => {
        const entry = { timestamp: new Date().toISOString(), message, data };
        this.logs.push(entry);
        
        const notifyRes = this.hookManager.execute("Notification", { 
          message, 
          data, 
          toolName: data?.capability_id || "",
          notification_type: "Log",
          details: data
        });
        
        if (notifyRes.systemMessage && typeof logCallback === "function") {
          logCallback({ timestamp: new Date().toISOString(), message: `[Hook Notification Message] ${notifyRes.systemMessage}`, data });
        }
        if (typeof logCallback === "function") logCallback(entry);
      };

      if (sessionStartRes.systemMessage) {
        log(`[SessionStart Hook Message] ${sessionStartRes.systemMessage}`);
      }

      if (!this._capabilitiesInitialized) this._initializeCapabilities(log);
      log("Agent run sequence initiated", { prompt });

      // EXECUTE PreCompress Hook (Standard lifecycle alignment)
      const preCompressRes = this.hookManager.execute("PreCompress", { trigger: "auto" });
      if (preCompressRes.systemMessage) {
        log(`[PreCompress Hook Message] ${preCompressRes.systemMessage}`);
      }

      // EXECUTE BeforeAgent Hook
      const beforeAgentRes = this.hookManager.execute("BeforeAgent", { prompt });
      if (beforeAgentRes.decision === "deny" || beforeAgentRes.continue === false) {
        throw new Error(`Execution blocked by BeforeAgent hook: ${beforeAgentRes.reason || "Denied"}`);
      }
      
      const agentContext = beforeAgentRes.hookSpecificOutput?.additionalContext || beforeAgentRes.additionalContext;
      if (agentContext) {
        prompt = prompt + "\n\n[Additional Context]:\n" + agentContext;
      } else if (beforeAgentRes.prompt) {
        prompt = beforeAgentRes.prompt;
      }

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

      // EXECUTE BeforeToolSelection Hook
      const beforeToolSelectionRes = this.hookManager.execute("BeforeToolSelection", { capabilities: plannerCapabilities });
      let activeCapabilities = beforeToolSelectionRes.capabilities || plannerCapabilities;
      
      const toolConfig = beforeToolSelectionRes.hookSpecificOutput?.toolConfig || beforeToolSelectionRes.toolConfig;
      if (toolConfig) {
        if (toolConfig.mode === "NONE") {
          activeCapabilities = [];
        } else if (Array.isArray(toolConfig.allowedFunctionNames)) {
          activeCapabilities = activeCapabilities.filter(c => 
            toolConfig.allowedFunctionNames.includes(c.name) || 
            toolConfig.allowedFunctionNames.includes(c.id)
          );
        }
      }
      const capabilityIds = activeCapabilities.map((c) => c.id);

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
${JSON.stringify(activeCapabilities, null, 2)}

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
        planResultText = this._generateContent(plannerConfig, plannerPromptStr);
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

      this.planQueue = [];
      this.taskResults = [];
      this.replanCount = 0;
      this.highestTaskId = 0;
      this.suspendedTask = null;

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
          this.taskResults.push({
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
          
          let agentResult = directAns;

          // EXECUTE AfterAgent Hook
          const afterAgentRes = this.hookManager.execute("AfterAgent", {
            finalAnswer: agentResult,
            prompt_response: agentResult,
            prompt: prompt,
            stop_hook_active: false
          });
          
          let forceRetry = (afterAgentRes.decision === "deny" || afterAgentRes.continue === false || afterAgentRes.retry === true);
          let retryPrompt = afterAgentRes.reason || afterAgentRes.retryPrompt || prompt;
          agentResult = afterAgentRes.prompt_response || afterAgentRes.finalAnswer || agentResult;

          if (afterAgentRes.clearContext === true) {
            log("AfterAgent hook requested clearContext: clearing history.");
            this.history = [];
          }

          this.history.push({ role: "user", parts: [{ text: prompt }] });
          this.history.push({ role: "model", parts: [{ text: agentResult }] });

          // EXECUTE SessionEnd Hook
          const sessionEndRes = this.hookManager.execute("SessionEnd", { 
            finalAnswer: agentResult, 
            error: null, 
            prompt: prompt,
            reason: "exit"
          });
          if (sessionEndRes.systemMessage) {
            log(`[SessionEnd Hook Message] ${sessionEndRes.systemMessage}`);
          }

          if (forceRetry && (!this._retryCount || this._retryCount < 2)) {
            this._retryCount = (this._retryCount || 0) + 1;
            log(`AfterAgent hook requested retry (decision: deny/retry). Initiating retry ${this._retryCount} with prompt/reason: ${retryPrompt}`);
            const retryResult = this.run(retryPrompt, logCallback);
            this._retryCount = 0; // reset
            return retryResult;
          }

          return agentResult;
        }
      } else {
        this.planQueue = planResult.plan || [];
        const planSummary = this.planQueue
          .map((t) => `Task [${t.task_id}]: '${t.capability_id}'`)
          .join("\n");
        log("Execution Plan Generated:\n" + planSummary, { plan: this.planQueue });
      }

      this.highestTaskId = Math.max(...this.planQueue.map((t) => t.task_id), 0);

      return this._runRemainingQueueAndSynthesize(logCallback);
    } catch (err) {
      if (err.message && err.message.startsWith("SUSPENDED")) {
        throw err;
      }
      // EXECUTE SessionEnd Hook on error
      try {
        const sessionEndRes = this.hookManager.execute("SessionEnd", { 
          finalAnswer: null, 
          error: err.message, 
          prompt: prompt,
          reason: "error"
        });
        if (sessionEndRes.systemMessage) {
          console.log(`[SessionEnd Hook Message on Error] ${sessionEndRes.systemMessage}`);
        }
      } catch (endErr) {
        console.error(`[HookManager Error] Failed executing SessionEnd hook on error: ${endErr.message}`);
      }
      throw err;
    }
  }

  saveState() {
    const stateData = {
      sessionId: this.sessionId,
      currentPrompt: this.currentPrompt,
      history: this.history,
      accumulatedTokens: this.accumulatedTokens,
      logs: this.logs,
      planQueue: this.planQueue || [],
      taskResults: this.taskResults || [],
      highestTaskId: this.highestTaskId || 0,
      replanCount: this.replanCount || 0,
      suspendedTask: this.suspendedTask || null
    };
    if (this.services && this.services.properties) {
      this.services.properties.setProperty("HITL_STATE_" + this.sessionId, JSON.stringify(stateData));
    }
    return stateData;
  }

  loadState(sessionId) {
    let stateData = null;
    if (this.services && this.services.properties) {
      const dataStr = this.services.properties.getProperty("HITL_STATE_" + sessionId);
      if (dataStr) {
        stateData = JSON.parse(dataStr);
      }
    }
    if (!stateData && this.sessionId === sessionId) {
      stateData = {
        sessionId: this.sessionId,
        currentPrompt: this.currentPrompt,
        history: this.history,
        accumulatedTokens: this.accumulatedTokens,
        logs: this.logs,
        planQueue: this.planQueue,
        taskResults: this.taskResults,
        highestTaskId: this.highestTaskId,
        replanCount: this.replanCount,
        suspendedTask: this.suspendedTask
      };
    }
    return stateData;
  }

  resume(sessionId, approvalDecision, approvedArgs = null, logCallback = null) {
    const stateData = this.loadState(sessionId);
    if (!stateData) {
      throw new Error(`CRITICAL: No suspended state found for sessionId: ${sessionId}`);
    }

    this.sessionId = stateData.sessionId;
    this.currentPrompt = stateData.currentPrompt;
    this.history = stateData.history || [];
    this.accumulatedTokens = stateData.accumulatedTokens || 0;
    this.logs = stateData.logs || [];
    this.planQueue = stateData.planQueue || [];
    this.taskResults = stateData.taskResults || [];
    this.highestTaskId = stateData.highestTaskId || 0;
    this.replanCount = stateData.replanCount || 0;
    this.suspendedTask = stateData.suspendedTask || null;

    if (this.hookManager) {
      this.hookManager.sessionId = this.sessionId;
    }

    const log = (message, data = null) => {
      const entry = { timestamp: new Date().toISOString(), message, data };
      this.logs.push(entry);
      if (typeof logCallback === "function") logCallback(entry);
    };

    log(`Resuming execution for session ${sessionId} with decision: ${approvalDecision}`);

    if (this.suspendedTask) {
      const susp = this.suspendedTask;
      this.suspendedTask = null;

      if (this.services && this.services.properties) {
        this.services.properties.deleteProperty("HITL_STATE_" + sessionId);
      }

      if (approvalDecision === "allow" || approvalDecision === "approve") {
        log(`Task [${susp.task ? susp.task.task_id : "unknown"}] approved by human. Executing...`);
        let finalArgs = approvedArgs !== null ? approvedArgs : susp.args;
        
        let rawResultData;
        let taskError = null;
        const taskStartTime = Date.now();
        const cap = this.capabilities.find((c) => c.id === susp.capabilityId);

        try {
          if (cap && cap.type === "Native Tool") {
            let result = cap._tool.function(finalArgs);
            const afterToolRes = this.hookManager.execute("AfterTool", {
              prompt: this.currentPrompt,
              toolName: cap.name,
              tool_name: cap.name,
              tool_input: finalArgs,
              tool_response: { result: result },
              result: result,
              capability: cap
            });
            
            if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
              rawResultData = `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
            } else {
              rawResultData = afterToolRes.result !== undefined ? afterToolRes.result : result;
              const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
              if (additionalToolContext) {
                rawResultData = rawResultData + "\n\n[Hook Context]:\n" + additionalToolContext;
              }
            }
          } else {
            rawResultData = this._executeTask(cap, susp.executionPrompt, susp.task);
            const afterToolRes = this.hookManager.execute("AfterTool", {
              prompt: this.currentPrompt,
              toolName: cap ? cap.name : susp.capabilityId,
              capabilityId: susp.capabilityId,
              result: rawResultData,
              task: susp.task,
              capability: cap
            });
            
            if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
              rawResultData = `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
            } else {
              rawResultData = afterToolRes.result !== undefined ? afterToolRes.result : rawResultData;
              const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
              if (additionalToolContext) {
                rawResultData = rawResultData + "\n\n[Hook Context]:\n" + additionalToolContext;
              }
            }
          }
        } catch (err) {
          taskError = err.message;
        }

        const durationMs = Date.now() - taskStartTime;

        if (!taskError) {
          let resultStr = typeof rawResultData === "object" ? JSON.stringify(rawResultData) : String(rawResultData);
          if (resultStr.length > this.maxResultLength) {
            log(`[PAYLOAD WARNING] Task result length exceeded limit. Truncating.`);
            resultStr = resultStr.substring(0, this.maxResultLength) + "\n\n...[TRUNCATED: Exceeds context limit]";
          }
          this.taskResults.push({
            task_id: susp.task ? susp.task.task_id : 0,
            capability_used: susp.capabilityId,
            capability_type: cap ? cap.type : "Unknown",
            prompt: susp.task ? susp.task.execution_prompt : susp.executionPrompt,
            result: resultStr,
            duration_ms: durationMs,
          });
          log(`Task completed successfully in resume phase.`);
        } else {
          this.taskResults.push({
            task_id: susp.task ? susp.task.task_id : 0,
            capability_used: susp.capabilityId,
            capability_type: cap ? cap.type : "Unknown",
            prompt: susp.task ? susp.task.execution_prompt : susp.executionPrompt,
            error: taskError,
            duration_ms: durationMs,
          });
          log(`Task failed in resume phase: ${taskError}`);
          
          if (this.replanCount < this.maxReplans) {
            this.replanCount++;
            log(`[DYNAMIC RE-PLANNING] Re-planning in resume phase...`);
            this.planQueue.length = 0;
            const activeCapabilities = this.capabilities.map((c) => ({
              id: c.id,
              type: c.type,
              name: c.name,
              description: c.description,
            }));
            const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to failure.
Original Prompt: "${this.currentPrompt}"
Capabilities: ${JSON.stringify(activeCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(this.taskResults.filter((t) => !t.error), null, 2)}

FAILURE REPORT:
Failed Capability: ${susp.capabilityId}
Error: ${taskError}

Instructions:
1. Bypass the error. Do NOT use the exact same capability/prompt combination.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${this.highestTaskId + 1}.
`;
            try {
              const taskArraySchema = {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    task_id: { type: "number" },
                    description: { type: "string" },
                    capability_id: { type: "string" },
                    execution_prompt: { type: "string" },
                    depends_on: { type: "array", items: { type: "number" } },
                  },
                  required: ["task_id", "description", "capability_id", "execution_prompt", "depends_on"],
                }
              };
              const replanConfig = {
                apiKey: this.apiKey,
                model: this.model,
                history: this.history,
                responseSchema: taskArraySchema,
              };
              const replanResText = this._generateContent(replanConfig, replanPromptStr);
              const newPlan = this._extractJson(replanResText);
              this.planQueue.push(...newPlan);
              this.highestTaskId = Math.max(this.highestTaskId, ...newPlan.map((t) => t.task_id));
            } catch (replanErr) {
              log(`Re-planning failed in resume phase: ${replanErr.message}`);
            }
          }
        }
      } else {
        log(`Task approved decision denied: ${approvalDecision}`);
        this.taskResults.push({
          task_id: susp.task ? susp.task.task_id : 0,
          capability_used: susp.capabilityId,
          capability_type: "Unknown",
          prompt: susp.task ? susp.task.execution_prompt : susp.executionPrompt,
          error: `Execution denied by human decision: ${approvalDecision}`,
          duration_ms: 0
        });

        if (this.replanCount < this.maxReplans) {
          this.replanCount++;
          log(`[DYNAMIC RE-PLANNING] Re-planning after human denial...`);
          this.planQueue.length = 0;
          const activeCapabilities = this.capabilities.map((c) => ({
            id: c.id,
            type: c.type,
            name: c.name,
            description: c.description,
          }));
          const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to human execution denial.
Original Prompt: "${this.currentPrompt}"
Capabilities: ${JSON.stringify(activeCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(this.taskResults.filter((t) => !t.error), null, 2)}

FAILURE REPORT:
Failed Capability: ${susp.capabilityId}
Error: Execution denied by human.

Instructions:
1. Do NOT use the denied capability/prompt combination. Try to find alternative capabilities.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${this.highestTaskId + 1}.
`;
          try {
            const taskArraySchema = {
              type: "array",
              items: {
                type: "object",
                properties: {
                  task_id: { type: "number" },
                  description: { type: "string" },
                  capability_id: { type: "string" },
                  execution_prompt: { type: "string" },
                  depends_on: { type: "array", items: { type: "number" } },
                },
                required: ["task_id", "description", "capability_id", "execution_prompt", "depends_on"],
              }
            };
            const replanConfig = {
              apiKey: this.apiKey,
              model: this.model,
              history: this.history,
              responseSchema: taskArraySchema,
            };
            const replanResText = this._generateContent(replanConfig, replanPromptStr);
            const newPlan = this._extractJson(replanResText);
            this.planQueue.push(...newPlan);
            this.highestTaskId = Math.max(this.highestTaskId, ...newPlan.map((t) => t.task_id));
          } catch (replanErr) {
            log(`Re-planning failed in resume phase after denial: ${replanErr.message}`);
          }
        }
      }
    }

    return this._runRemainingQueueAndSynthesize(logCallback);
  }

  _runRemainingQueueAndSynthesize(logCallback = null) {
    const log = (message, data = null) => {
      const entry = { timestamp: new Date().toISOString(), message, data };
      this.logs.push(entry);
      const notifyRes = this.hookManager.execute("Notification", { 
        message, 
        data, 
        toolName: data?.capability_id || "",
        notification_type: "Log",
        details: data
      });
      if (notifyRes.systemMessage && typeof logCallback === "function") {
        logCallback({ timestamp: new Date().toISOString(), message: `[Hook Notification Message] ${notifyRes.systemMessage}`, data });
      }
      if (typeof logCallback === "function") logCallback(entry);
    };

    const prompt = this.currentPrompt;

    try {
      while (this.planQueue.length > 0) {
        const timeElapsed = Date.now() - this.startTime;
        if (timeElapsed > this.timeoutMs) {
          log(`[TIMEOUT PREVENTION] Safe abort triggered. Elapsed: ${timeElapsed}ms exceeds ${this.timeoutMs}ms limit.`);
          break;
        }

        const task = this.planQueue.shift();
        log(`Executing Task [${task.task_id}] via [${task.capability_id}]`, {
          description: task.description,
        });

        const cap = this.capabilities.find((c) => c.id === task.capability_id);

        let contextStr = "";
        if (task.depends_on && task.depends_on.length > 0) {
          const dependentResults = this.taskResults.filter(
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

        // EXECUTE BeforeTool Hook (Skip for Native Tools to avoid early verification with missing args)
        const isNativeTool = cap && cap.type === "Native Tool";
        const beforeToolRes = isNativeTool ? { decision: "allow" } : this.hookManager.execute("BeforeTool", {
          prompt: prompt,
          toolName: cap ? cap.name : task.capability_id,
          capabilityId: task.capability_id,
          executionPrompt: finalExecutionPrompt,
          task: task,
          capability: cap
        });

        if (beforeToolRes.decision === "deny") {
          taskError = `Execution blocked by BeforeTool hook: ${beforeToolRes.reason || "Denied tool execution"}`;
          retries = -1; // Prevent retry loop
        } else if (beforeToolRes.decision === "suspend") {
          this.suspendedTask = {
            task: task,
            args: null,
            capabilityId: task.capability_id,
            executionPrompt: beforeToolRes.executionPrompt || finalExecutionPrompt
          };
          this.saveState();
          throw new Error(`SUSPENDED: Execution suspended for human approval. SessionId: ${this.sessionId}`);
        } else {
          const activeExecutionPrompt = beforeToolRes.executionPrompt || finalExecutionPrompt;

          while (retries >= 0) {
            try {
              rawResultData = this._executeTask(cap, activeExecutionPrompt, task);
              if (this.suspendedTask) {
                throw new Error(`SUSPENDED: Execution suspended for human approval. SessionId: ${this.sessionId}`);
              }
              taskError = null;
              break;
            } catch (err) {
              if (err.message && err.message.startsWith("SUSPENDED")) {
                throw err;
              }
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

          // EXECUTE AfterTool Hook (Skip for Native Tools to avoid double-firing)
          const afterToolRes = isNativeTool ? { result: finalResultData } : this.hookManager.execute("AfterTool", {
            prompt: prompt,
            toolName: cap ? cap.name : task.capability_id,
            capabilityId: task.capability_id,
            result: finalResultData,
            task: task,
            capability: cap
          });
          
          if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
            finalResultData = `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
          } else {
            finalResultData = afterToolRes.result !== undefined ? afterToolRes.result : finalResultData;
            const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
            if (additionalToolContext) {
              finalResultData = finalResultData + "\n\n[Hook Context]:\n" + additionalToolContext;
            }
          }
        }

        if (!taskError) {
          this.taskResults.push({
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
          this.taskResults.push({
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
          if (this.replanCount < this.maxReplans) {
            this.replanCount++;
            log(
              `[DYNAMIC RE-PLANNING] Attempt ${this.replanCount}/${this.maxReplans}. Discarding remaining queue and regenerating DAG...`,
            );
            this.planQueue.length = 0;

            const activeCapabilities = this.capabilities.map((c) => ({
              id: c.id,
              type: c.type,
              name: c.name,
              description: c.description,
            }));
            const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to failure.
Original Prompt: "${prompt}"
Capabilities: ${JSON.stringify(activeCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(
              this.taskResults.filter((t) => !t.error),
              null,
              2,
            )}

FAILURE REPORT:
Failed Capability: ${task.capability_id}
Error: ${taskError}

Instructions:
1. Bypass the error. Do NOT use the exact same capability/prompt combination.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${this.highestTaskId + 1}.
`;
            try {
              const taskArraySchema = {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    task_id: { type: "number" },
                    description: { type: "string" },
                    capability_id: { type: "string" },
                    execution_prompt: { type: "string" },
                    depends_on: {
                      type: "array",
                      items: { type: "number" },
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
              const replanConfig = {
                apiKey: this.apiKey,
                model: this.model,
                history: this.history,
                responseSchema: taskArraySchema,
              };
              const replanResText = this._generateContent(replanConfig, replanPromptStr);
              const newPlan = this._extractJson(replanResText);
              this.planQueue.push(...newPlan);
              this.highestTaskId = Math.max(
                this.highestTaskId,
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
${JSON.stringify(this.taskResults, null, 2)}
${timeWarning}

Objective:
1. Formulate a comprehensive, natural response to the user based exclusively on the gathered data.
2. If tasks partially failed, transparently state what succeeded and what could not be completed.
3. CRITICAL: Append an "Execution Summary" at the very end of your response detailing the capabilities used, execution order, duration (ms), and prompts. If no capabilities were used, explicitly state "NO capabilities were used".
`;

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

      const synthConfig = {
        apiKey: this.apiKey,
        model: this.model,
        history: this.history,
        systemInstruction: { parts: [{ text: globalInstruction }] },
      };
      if (this.outputSchema) synthConfig.responseSchema = this.outputSchema;
      if (this.generateContentConfig)
        synthConfig.generationConfig = this.generateContentConfig;

      const finalAnswer = this._generateContent(synthConfig, synthesizePrompt);

      log("Final synthesis complete.");

      let agentResult = finalAnswer;

      // EXECUTE AfterAgent Hook
      const afterAgentRes = this.hookManager.execute("AfterAgent", {
        finalAnswer: agentResult,
        prompt_response: agentResult,
        prompt: prompt,
        stop_hook_active: false
      });
      
      let forceRetry = (afterAgentRes.decision === "deny" || afterAgentRes.continue === false || afterAgentRes.retry === true);
      let retryPrompt = afterAgentRes.reason || afterAgentRes.retryPrompt || prompt;
      agentResult = afterAgentRes.prompt_response || afterAgentRes.finalAnswer || agentResult;

      if (afterAgentRes.clearContext === true) {
        log("AfterAgent hook requested clearContext: clearing history.");
        this.history = [];
      }

      this.history.push({ role: "user", parts: [{ text: prompt }] });
      this.history.push({
        role: "model",
        parts: [
          {
            text:
              typeof agentResult === "string"
                ? agentResult
                : JSON.stringify(agentResult),
          },
        ],
      });

      // EXECUTE SessionEnd Hook
      const sessionEndRes = this.hookManager.execute("SessionEnd", { 
        finalAnswer: agentResult, 
        error: null, 
        prompt: prompt,
        reason: "exit"
      });
      if (sessionEndRes.systemMessage) {
        log(`[SessionEnd Hook Message] ${sessionEndRes.systemMessage}`);
      }

      if (forceRetry && (!this._retryCount || this._retryCount < 2)) {
        this._retryCount = (this._retryCount || 0) + 1;
        log(`AfterAgent hook requested retry (decision: deny/retry). Initiating retry ${this._retryCount} with prompt/reason: ${retryPrompt}`);
        const retryResult = this.run(retryPrompt, logCallback);
        this._retryCount = 0; // reset
        return retryResult;
      }

      return agentResult;
    } catch (err) {
      if (err.message && err.message.startsWith("SUSPENDED")) {
        throw err;
      }
      // EXECUTE SessionEnd Hook on error
      try {
        const sessionEndRes = this.hookManager.execute("SessionEnd", { 
          finalAnswer: null, 
          error: err.message, 
          prompt: prompt,
          reason: "error"
        });
        if (sessionEndRes.systemMessage) {
          console.log(`[SessionEnd Hook Message on Error] ${sessionEndRes.systemMessage}`);
        }
      } catch (endErr) {
        console.error(`[HookManager Error] Failed executing SessionEnd hook on error: ${endErr.message}`);
      }
      throw err;
    }
  }
};
