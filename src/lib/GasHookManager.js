var gasGlobalContext = this;

/**
 * GasHookManager.js
 * [Production Release v1.4.3]
 *
 * @description
 * A robust, extensible Hooks System engine for GASADK to register, match, execute,
 * and merge lifecycle hooks under Google Apps Script constraints.
 * Resolves functions in the injected global context, local script scope, and globalThis.
 * All logs, error messages, and comments are written in English.
 */
var GasHookManager = class GasHookManager {
  /**
   * @param {Object|Array} hooksConfig - The hooks configuration.
   */
  constructor(hooksConfig = {}) {
    this.hooks = [];
    this.globalContext = null;
    // Generate a unique session ID for the hook context
    this.sessionId = "session_" + (typeof Utilities !== "undefined" ? Utilities.getUuid() : Math.random().toString(36).substring(2));
    this._parseHooksConfig(hooksConfig);
  }

  /**
   * Sets the user's runtime global context scope (to resolve hooks defined in the caller project).
   *
   * @param {Object} context - The runtime global scope (usually 'this' from the calling script).
   */
  setGlobalContext(context) {
    this.globalContext = context;
  }

  /**
   * Parses the hooks configuration object/array into an internalized flat array of hooks.
   * Supports both nested format (Format A) and flat format (Format B).
   *
   * @param {Object|Array} hooksConfig - The hooks configuration.
   * @private
   */
  _parseHooksConfig(hooksConfig) {
    if (!hooksConfig) return;

    if (Array.isArray(hooksConfig)) {
      this.hooks = hooksConfig;
      return;
    }

    if (typeof hooksConfig === 'object') {
      for (const event in hooksConfig) {
        if (!Object.prototype.hasOwnProperty.call(hooksConfig, event)) continue;
        const items = hooksConfig[event];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          // Format A: Nested hooks array
          if (item && Array.isArray(item.hooks)) {
            for (const nestedHook of item.hooks) {
              this.hooks.push({
                name: nestedHook.name || `${event}_hook`,
                description: nestedHook.description || item.description || "",
                event: event,
                type: nestedHook.type,
                functionName: nestedHook.functionName,
                url: nestedHook.url,
                command: nestedHook.command,
                matcher: item.matcher || nestedHook.matcher || "*",
                timeout: nestedHook.timeout || item.timeout || 10000,
                sequential: nestedHook.sequential !== undefined ? nestedHook.sequential : (item.sequential || false)
              });
            }
          } else if (item && typeof item === 'object') {
            // Format B: Flat hook object directly inside the event array
            this.hooks.push({
              name: item.name || `${event}_hook`,
              description: item.description || "",
              event: event,
              type: item.type,
              functionName: item.functionName,
              url: item.url,
              command: item.command,
              matcher: item.matcher || "*",
              timeout: item.timeout || 10000,
              sequential: item.sequential || false
            });
          }
        }
      }
    }
  }

  /**
   * Dynamically resolves a global function by string name (supporting dot notation)
   * across multiple scoped contexts.
   *
   * @param {string} functionName - Name of the global function (e.g. "myHook" or "MyNamespace.myHook").
   * @returns {Function|null} The resolved function, or null if not found.
   * @private
   */
  _resolveGlobalFunction(functionName) {
    if (!functionName) return null;

    // 1. Search in user-injected runtime globalContext
    if (this.globalContext) {
      const func = this._resolveInScope(this.globalContext, functionName);
      if (func) return func;
    }

    // 2. Fall back to script-level top-level context (captured at initialization)
    if (typeof gasGlobalContext !== 'undefined' && gasGlobalContext) {
      const func = this._resolveInScope(gasGlobalContext, functionName);
      if (func) return func;
    }

    // 3. Fall back to globalThis
    return this._resolveInScope(globalThis, functionName);
  }

  /**
   * Helper to resolve a dotted path string function within a specific scope object.
   *
   * @param {Object} scope - The parent scope object.
   * @param {string} path - Dotted path string.
   * @returns {Function|null} Resolved function or null.
   * @private
   */
  _resolveInScope(scope, path) {
    if (!scope) return null;
    const parts = path.split('.');
    let current = scope;
    for (const part of parts) {
      if (current[part] === undefined) {
        return null;
      }
      current = current[part];
    }
    return typeof current === 'function' ? current : null;
  }

  /**
   * Performs wildcard or RegExp matching against tool/capability names.
   * Supports regex expressions and wildcard symbols as defined in Gemini CLI hooks specs.
   *
   * @param {string|RegExp} matcher - RegExp or wildcard string pattern.
   * @param {string} toolName - The tool or capability name to match.
   * @returns {boolean} True if matched, false otherwise.
   * @private
   */
  _isMatch(matcher, toolName) {
    if (!matcher) return true;
    if (matcher === "*") return true;
    if (matcher instanceof RegExp) {
      return matcher.test(toolName);
    }
    if (typeof matcher === "string") {
      // Check if it's a regex literal string representation e.g. "/^tool_/i"
      if (matcher.startsWith("/") && matcher.lastIndexOf("/") > 0) {
        const lastSlashIdx = matcher.lastIndexOf("/");
        const pattern = matcher.substring(1, lastSlashIdx);
        const flags = matcher.substring(lastSlashIdx + 1);
        try {
          const regex = new RegExp(pattern, flags);
          return regex.test(toolName);
        } catch (e) {
          // Fall back
        }
      }
      // Gemini CLI BeforeTool/AfterTool matcher allows regex strings (like "write_.*" or "write_file|replace")
      // If the string contains regex metacharacters, compile as a RegExp
      try {
        let pattern = matcher;
        // Map wildcard "*" to ".*" if it is just a simple wildcard string, e.g., "write_*"
        if (pattern.includes("*") && !pattern.includes(".*")) {
          pattern = pattern.replace(/\*/g, ".*");
        }
        // Build regex to support piping (e.g. "write_file|replace") and other regex structures
        const regex = new RegExp("^(" + pattern + ")$", "i");
        return regex.test(toolName);
      } catch (e) {
        // Fall back to direct case-insensitive match
      }
      return matcher.toLowerCase() === toolName.toLowerCase();
    }
    return false;
  }

  /**
   * Executes a single hook configuration with the provided input payload.
   *
   * @param {Object} hook - The hook configuration object.
   * @param {Object} input - The input payload for the hook.
   * @returns {Object} The result returned by the hook function or webhook fetch.
   * @private
   */
  _executeSingleHook(hook, input) {
    if (hook.type === 'gas_function') {
      const func = this._resolveGlobalFunction(hook.functionName);
      if (!func) {
        throw new Error(`CRITICAL: Global function '${hook.functionName}' for hook '${hook.name}' was not found in the global scope.`);
      }
      return func(input);
    } else if (hook.type === 'webhook') {
      const fetchOptions = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(input),
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(hook.url, fetchOptions);
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error(`CRITICAL: Webhook '${hook.name}' failed with HTTP Status ${code}: ${response.getContentText()}`);
      }
      try {
        return JSON.parse(response.getContentText());
      } catch (e) {
        throw new Error(`CRITICAL: Webhook '${hook.name}' returned invalid JSON: ${response.getContentText()}`);
      }
    } else if (hook.type === 'command') {
      console.log(`[Command Hook executed] Bypassing command execution ('${hook.command}') in Google Apps Script. Input event: ${input.event}`);
      return { decision: "allow" };
    } else {
      throw new Error(`CRITICAL: Unsupported hook type '${hook.type}' for hook '${hook.name}'.`);
    }
  }

  /**
   * Merges fields from a hook result back into the current input for sequential chaining.
   * Support both Gemini CLI hookSpecificOutput namespaces and top-level fields.
   *
   * @param {Object} currentInput - The existing input state.
   * @param {Object} hookResult - The result returned from the hook execution.
   * @returns {Object} The updated input state.
   * @private
   */
  _mergeSequentialInput(currentInput, hookResult) {
    if (!hookResult || typeof hookResult !== 'object') {
      return currentInput;
    }
    const updated = { ...currentInput };

    // 1. Unwrap hookSpecificOutput (Gemini CLI namespace structure)
    if (hookResult.hookSpecificOutput && typeof hookResult.hookSpecificOutput === 'object') {
      const hso = hookResult.hookSpecificOutput;
      
      // BeforeTool.hookSpecificOutput.tool_input
      if (hso.tool_input !== undefined) {
        updated.tool_input = hso.tool_input;
        if (typeof hso.tool_input === 'object' && hso.tool_input.execution_prompt !== undefined) {
          updated.executionPrompt = hso.tool_input.execution_prompt;
        } else if (typeof hso.tool_input === 'string') {
          updated.executionPrompt = hso.tool_input;
        }
      }

      // BeforeModel.hookSpecificOutput.llm_request
      if (hso.llm_request !== undefined) {
        updated.llm_request = hso.llm_request;
        if (hso.llm_request.config !== undefined) updated.config = hso.llm_request.config;
        if (hso.llm_request.prompt !== undefined) updated.query = hso.llm_request.prompt;
      }

      // BeforeModel / AfterModel.hookSpecificOutput.llm_response
      if (hso.llm_response !== undefined) {
        updated.llm_response = hso.llm_response;
        if (hso.llm_response.text !== undefined) updated.text = hso.llm_response.text;
      }

      // BeforeToolSelection.hookSpecificOutput.toolConfig
      if (hso.toolConfig !== undefined) {
        updated.toolConfig = hso.toolConfig;
        if (Array.isArray(hso.toolConfig.allowedFunctionNames)) {
          if (updated.capabilities) {
            updated.capabilities = updated.capabilities.filter(c => 
              hso.toolConfig.allowedFunctionNames.includes(c.name) || 
              hso.toolConfig.allowedFunctionNames.includes(c.id)
            );
          }
        }
      }

      // SessionStart / BeforeAgent / AfterTool.hookSpecificOutput.additionalContext
      if (hso.additionalContext !== undefined) {
        updated.additionalContext = hso.additionalContext;
      }
    }

    // 2. Propagate top-level fields
    const checkFields = [
      'prompt',
      'capabilities',
      'config',
      'query',
      'text',
      'executionPrompt',
      'result',
      'finalAnswer',
      'decision',
      'reason',
      'continue',
      'clearContext',
      'systemMessage',
      'retry',
      'retryPrompt',
      'tool_input',
      'tool_response',
      'llm_request',
      'llm_response'
    ];
    for (const field of checkFields) {
      if (hookResult[field] !== undefined) {
        updated[field] = hookResult[field];
      }
    }

    // Direct mappings for Gemini CLI compatibility:
    // If continue is false, treat it as decision: "deny"
    if (hookResult.continue === false) {
      updated.decision = "deny";
      updated.reason = hookResult.reason || "Execution stopped by hook continue=false";
    }

    return updated;
  }

  /**
   * Executes all matching hooks for a specific lifecycle event.
   * Auto-injects standard environment and session metadata to align with Gemini CLI specs.
   *
   * @param {string} event - The lifecycle event name.
   * @param {Object} initialInput - The initial HookInput payload.
   * @returns {Object} The aggregated output/result of hook execution.
   */
  execute(event, initialInput) {
    // Construct normalized Gemini CLI payload containing the mandatory common properties
    const input = {
      session_id: initialInput.session_id || this.sessionId,
      transcript_path: initialInput.transcript_path || "/mock/transcript.jsonl",
      cwd: initialInput.cwd || "/mock/cwd",
      hook_event_name: event,
      timestamp: new Date().toISOString(),
      ...initialInput,
      event // Keep camelCase compatibility field
    };

    // Normalize event-specific payloads (mappings to standard Gemini CLI snake_case fields)
    if (event === "BeforeTool" || event === "AfterTool") {
      input.tool_name = input.tool_name || input.toolName || "";
      if (input.tool_input === undefined) {
        input.tool_input = {
          execution_prompt: input.executionPrompt || input.prompt || "",
          task: input.task || {}
        };
      }
      if (event === "AfterTool" && input.tool_response === undefined) {
        input.tool_response = {
          result: input.result || "",
          success: !input.error,
          error: input.error || null
        };
      }
    } else if (event === "BeforeModel" || event === "AfterModel") {
      if (input.llm_request === undefined) {
        input.llm_request = {
          model: input.config?.model || "",
          messages: input.history || [],
          config: input.config || {}
        };
      }
      if (event === "AfterModel" && input.llm_response === undefined) {
        input.llm_response = {
          text: input.text || ""
        };
      }
    } else if (event === "BeforeToolSelection") {
      if (input.llm_request === undefined) {
        input.llm_request = {
          capabilities: input.capabilities || []
        };
      }
    } else if (event === "AfterAgent") {
      input.prompt_response = input.prompt_response || input.finalAnswer || "";
      input.stop_hook_active = input.stop_hook_active !== undefined ? input.stop_hook_active : false;
    }

    // Find all hooks that target this lifecycle event
    const matchingHooks = this.hooks.filter(h => {
      const eventMatches = Array.isArray(h.event) ? h.event.includes(event) : (h.event === event);
      if (!eventMatches) return false;

      // Matcher filter (mostly used for BeforeTool, AfterTool, Notification matching)
      if (h.matcher) {
        const toolName = input.tool_name || input.toolName || input.capabilityId || "";
        if (!this._isMatch(h.matcher, toolName)) {
          return false;
        }
      }
      return true;
    });

    if (matchingHooks.length === 0) {
      return input;
    }

    let currentInput = { ...input };
    let decisions = [];
    let reasons = [];
    let contexts = [];
    
    for (const hook of matchingHooks) {
      // If sequential, pass the latest state; otherwise, pass the original input state.
      const hookInput = hook.sequential ? currentInput : { ...input };
      
      let result = null;
      try {
        result = this._executeSingleHook(hook, hookInput);
      } catch (err) {
        console.error(`[HookManager Error] Failed executing hook '${hook.name}': ${err.message}`);
        result = { decision: "deny", reason: `Execution failure in hook '${hook.name}': ${err.message}` };
      }

      if (!result) continue;

      if (result.decision) {
        decisions.push(result.decision);
      }
      if (result.reason) {
        reasons.push(result.reason);
      }
      
      // Keep namespace or top-level additionalContext / systemMessage
      const contextVal = result.hookSpecificOutput?.additionalContext || result.additionalContext;
      if (contextVal) {
        contexts.push(contextVal);
      }
      const sysMsg = result.systemMessage;
      if (sysMsg) {
        contexts.push(sysMsg);
      }

      // Propagate modified fields
      currentInput = this._mergeSequentialInput(currentInput, result);
    }

    // Merge & Aggregate:
    // - OR Decision: If any hook returns decision: "deny" or decision: "block", reject immediately. Combine reason strings.
    // - Concat Context: Concatenate additionalContext or systemMessage strings using newlines (\n).
    const finalResult = { ...currentInput };
    
    const hasDeny = decisions.some(d => d === "deny" || d === "block");
    if (hasDeny) {
      finalResult.decision = "deny";
      finalResult.reason = reasons.filter(r => r).join("\n");
    } else if (decisions.length > 0) {
      finalResult.decision = "allow";
    }

    if (contexts.length > 0) {
      finalResult.additionalContext = contexts.filter(c => c).join("\n");
    }

    return finalResult;
  }
};
