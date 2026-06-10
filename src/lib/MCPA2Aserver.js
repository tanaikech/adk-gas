/**
 * MCPA2Aserver: Class Object for Consolidating Generative AI Protocols
 * Author: Tanaike
 * v2.2.0 (Multi-Channel Sheet Logging Update)
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
 * #### 2. Configuration & History Injection
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
      throw new Error(
        "CRITICAL: History must be an array of objects compatible with GeminiWithFiles.",
      );
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
   * Thread-safe helper to fetch or create a spreadsheet sheet with strict lock control.
   * Prevents parallel-process insertion failures in high-volume environments.
   *
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The targeted spreadsheet.
   * @param {String} name - Name of the required sheet.
   * @param {Array<String>} [headers] - Optional header array to inject if generating new.
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  _getOrCreateSheet(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      const lock = LockService.getScriptLock();
      let lockAcquired = false;
      try {
        lockAcquired = lock.tryLock(15000);
        sheet = ss.getSheetByName(name); // Double check inside the lock boundary
        if (!sheet) {
          sheet = ss.insertSheet(name);
          if (headers && headers.length > 0) {
            sheet.appendRow(headers);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
          }
        }
      } catch (e) {
        // Fallback gracefully in case of race condition or parallel writes
        sheet = ss.getSheetByName(name) || ss.getSheets()[0];
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
      }
    }
    return sheet;
  }

  /**
   * Serializes a generic Apps Script Event Object safely, stripping read-only properties
   * and cyclical references that trigger standard JSON.stringify errors.
   *
   * @private
   * @param {EventObject} e - Event object received from doGet/doPost.
   * @return {String} Serialized representation.
   */
  serializeEvent_(e) {
    if (!e) return "null";
    try {
      const clone = {
        queryString: e.queryString || "",
        parameter: e.parameter || {},
        parameters: e.parameters || {},
        contextPath: e.contextPath || "",
        contentLength: e.contentLength || -1,
        pathInfo: e.pathInfo || "",
        postData: e.postData
          ? {
              length: e.postData.length,
              type: e.postData.type,
              contents: e.postData.contents,
              name: e.postData.name,
            }
          : null,
      };
      return JSON.stringify(clone);
    } catch (err) {
      return "Error serializing event: " + err.message;
    }
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
    let route = null; // Declared early to avoid reference issues in catch block

    // Setup sheet requirements and log raw requests instantly to raw sheet
    if (this.logSpreadsheetId) {
      try {
        const ss = SpreadsheetApp.openById(this.logSpreadsheetId);
        this._getOrCreateSheet(ss, "raw", ["Timestamp", "Event Object"]);
        this._getOrCreateSheet(ss, "MCP", [
          "Date",
          "Method",
          "ID",
          "Direction",
          "Message",
        ]);
        this._getOrCreateSheet(ss, "A2A", [
          "Date",
          "Phase/Method",
          "ID",
          "Direction",
          "Message",
        ]);
        this._getOrCreateSheet(ss, "MCPA2Aserver_log", [
          "Timestamp",
          "Execution ID",
          "Direction",
          "Level",
          "Message",
        ]);

        const rawSheet = ss.getSheetByName("raw");
        const serializedEvent = this.serializeEvent_(e);
        rawSheet.appendRow([new Date().toISOString(), serializedEvent]);
      } catch (err) {
        console.error(
          "Failed to initialize multi-channel logging: " + err.stack,
        );
      }
    }

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
      route = this.determineRoute_(e);
      this.addLog_(`Route determined as: ${route.type}`, "INFO", "Internal");

      let targetEvent = e;

      if (
        route.type === "A2A" &&
        this.a2a === true &&
        processedServers.processedA2AObj
      ) {
        // Safe History Injection for A2A payloads
        if (
          this.history &&
          this.history.length > 0 &&
          e.postData &&
          e.postData.contents
        ) {
          try {
            const postObj = JSON.parse(e.postData.contents);
            if (
              postObj.params &&
              (postObj.method === "message/send" ||
                postObj.method === "tasks/send")
            ) {
              postObj.params.history = [
                ...this.history,
                ...(postObj.params.history || []),
              ];
              targetEvent = this.cloneEvent_(e);
              targetEvent.postData.contents = JSON.stringify(postObj);
              this.addLog_(
                `Injected ${this.history.length} base history elements into incoming A2A payload.`,
                "INFO",
                "Internal",
              );
            }
          } catch (err) {
            this.addLog_(
              `Failed to inject history into payload: ${err.message}`,
              "WARN",
              "Internal",
            );
          }
        }
        response = this.handleA2ARequest_(
          targetEvent,
          processedServers.processedA2AObj,
        );
      } else if (
        route.type === "MCP" &&
        this.mcp === true &&
        processedServers.processedMCPObj
      ) {
        // MCP protocol is purely functional and operates without chat history context.
        response = this.handleMCPRequest_(
          targetEvent,
          processedServers.processedMCPObj,
        );
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
      const processTag = route ? `[${route.type}]` : "[Routing]";
      this.addLog_(
        `Execution Error ${processTag}: ${err.message}`,
        "ERROR",
        "Internal",
      );
      response = ContentService.createTextOutput(
        JSON.stringify({ error: `[MCPA2Aserver Error] ${err.message}` }),
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
      postData: e.postData
        ? {
            length: e.postData.length,
            type: e.postData.type,
            contents: e.postData.contents,
            name: e.postData.name,
          }
        : null,
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
      const headers = [
        "Timestamp",
        "Execution ID",
        "Direction",
        "Level",
        "Message",
      ];
      const sheet = this._getOrCreateSheet(ss, sheetName, headers);

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
      this.addLog_(
        `[A2A Server Process Error] A2A Handle Error: ${err.stack}`,
        "ERROR",
        "Internal",
      );
      return ContentService.createTextOutput(
        JSON.stringify({ error: `[A2A Server Error] ${err.message}` }),
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
      this.addLog_(
        `[MCP Server Process Error] MCP Handle Error: ${err.stack}`,
        "ERROR",
        "Internal",
      );
      return ContentService.createTextOutput(
        JSON.stringify({ error: `[MCP Server Error] ${err.message}` }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }
};
