/**
 * DeployMcpServer.js
 * Exposes GoogleApiApp as an Agent-less MCP/A2A Server with Dynamic Tool Mapping.
 *
 * Requirements:
 * 1. GASADK library (imported as GASADK)
 * 2. GoogleApiApp library (imported as GoogleApiApp)
 */


const { MCPA2Aserver } = GASADK;


// Configurations
const ACCESS_KEY = PropertiesService.getScriptProperties().getProperty("ACCESS_KEY") || "sample";
const WEB_APPS_URL = "https://script.google.com/macros/s/{deployment ID}/exec"; // Update with actual deployment URL
const LOG_SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty("LOG_SPREADSHEET_ID") || "";


// Fetch Gemini API Key (required by the MCPA2Aserver class validation check)
const API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "DUMMY_API_KEY";


// Default API Versions Map
const DEFAULT_API_VERSIONS = {
  sheets: "v4",
  drive: "v3",
  docs: "v1",
  documents: "v1",
  calendar: "v3",
  gmail: "v1",
  slides: "v1",
  script: "v1",
  classroom: "v1",
  analytics: "v1beta",
  analyticsdata: "v1beta",
  people: "v1",
  youtube: "v3"
};


// Web App GET/POST Entry Points
const doGet = (e) => main(e);
const doPost = (e) => main(e);


/**
 * Main Web App Handler
 */
function main(e) {
  const lock = LockService.getScriptLock();
  const context = createServerContext_();


  // 1. Inspect incoming JSON-RPC payload for dynamic tool execution
  let requestedToolName = "";
  if (e && e.postData && e.postData.contents) {
    try {
      const payload = JSON.parse(e.postData.contents);
      if (payload.method === "tools/call" && payload.params && payload.params.name) {
        requestedToolName = payload.params.name;
      }
    } catch (err) {
      console.warn("Payload parsing bypassed: " + err.message);
    }
  }


  // 2. Register requested tool dynamically on-the-fly
  if (requestedToolName && !context.functions.params_[requestedToolName]) {
    const parsed = parseToolName_(requestedToolName);
    if (parsed) {
      console.log(`[DYNAMIC REGISTRATION] Tool: ${requestedToolName} -> API: ${parsed.api}, Version: ${parsed.version}, Method: ${parsed.methodName}`);
     
      // Inject standard parameter schema dynamically
      context.functions.params_[requestedToolName] = {
        description: `Dynamic proxy tool for Google API ${parsed.api} (${parsed.version}) - ${parsed.methodName}`,
        parameters: { type: "object" }
      };


      // Inject execution proxy callback
      context.functions[requestedToolName] = (args) => {
        console.log(`[EXECUTION PROXY] Invoking dynamic tool: ${requestedToolName}`);
       
        // Consolidate parameters
        const path = args.path || {};
        const query = args.query || {};
        const requestBody = args.requestBody || null;
        const usePageToken = !!args.usePageToken;


        // Map flat arguments into path and query maps for robustness
        Object.keys(args).forEach(key => {
          if (["path", "query", "requestBody", "usePageToken"].includes(key)) return;
          if (path[key] === undefined) path[key] = args[key];
          if (query[key] === undefined) query[key] = args[key];
        });


        const params = {
          path: path,
          query: query,
          usePageToken: usePageToken
        };
        if (requestBody) {
          params.requestBody = requestBody;
        }


        let res;
        let isError = false;
        try {
          GoogleApiApp.setAPIInf({
            api: parsed.api,
            version: parsed.version,
            methodName: parsed.methodName
          });
          GoogleApiApp.setAPIParams(params);
         
          const response = GoogleApiApp.request();
         
          if (Array.isArray(response)) {
            res = JSON.stringify(response);
          } else if (response && typeof response.getContentText === "function") {
            res = response.getContentText();
          } else if (typeof response === "string") {
            res = response;
          } else {
            res = JSON.stringify(response);
          }
        } catch (error) {
          console.error(`[EXECUTION ERROR] Invocation failed: ${error.stack || error.message}`);
          res = `Error: ${error.message}`;
          isError = true;
        }


        const returnObj = {
          mcp: {
            jsonrpc: "2.0",
            result: {
              content: [{ type: "text", text: res }],
              isError: isError
            }
          },
          a2a: { result: res }
        };


        // Halt server-side LLM loop
        return {
          ...returnObj,
          _gemini_halt: true,
          items: { functionResponse: returnObj }
        };
      };
    }
  }


  // 3. Dispatch to MCPA2Aserver
  const server = new MCPA2Aserver();
  server.setServices({ lock: lock });
  server.apiKey = API_KEY;
  server.model = "models/gemini-3-flash-preview";
  server.a2a = true;
  server.mcp = true;


  if (ACCESS_KEY) server.accessKey = ACCESS_KEY;
  if (LOG_SPREADSHEET_ID) server.logSpreadsheetId = LOG_SPREADSHEET_ID;


  return server.main(e, context);
}


/**
 * Parses tool names formatting (e.g. 'sheets_spreadsheets_create') into API details.
 *
 * @param {string} name - The tool name
 * @return {Object|null} The parsed parameters { api, version, methodName }
 * @private
 */
function parseToolName_(name) {
  const parts = name.split("_");
  if (parts.length < 2) return null;
 
  const api = parts[0];
  const defaultVersion = DEFAULT_API_VERSIONS[api] || "v1";
  const methodName = parts.slice(1).join(".");
 
  return {
    api: api,
    version: defaultVersion,
    methodName: methodName
  };
}


/**
 * Creates static context mapping.
 *
 * @return {Object} Context mapping.
 * @private
 */
function createServerContext_() {
  const functions = {
    params_: {
      call_google_api: {
        description: [
          "Executes raw Google API dynamic calls via GoogleApiApp.",
          "Features automatic pagination aggregation and supports all standard Google Workspace REST services.",
          "Note: Method names must follow the fully qualified resource.method format (e.g., 'files.list')."
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            api: {
              type: "string",
              description: "The Google API name (e.g., 'docs', 'sheets', 'drive', 'calendar')."
            },
            version: {
              type: "string",
              description: "The API version (e.g., 'v1', 'v3')."
            },
            methodName: {
              type: "string",
              description: "The fully qualified API method name INCLUDING the resource prefix (e.g., 'documents.create', 'spreadsheets.values.update', 'files.list')."
            },
            method: {
              type: "string",
              description: "Alternative parameter for the fully qualified API method name (e.g., 'files.list')."
            },
            path: {
              type: "object",
              description: "Path parameters mapping (e.g., { fileId: '...' })."
            },
            query: {
              type: "object",
              description: "Query parameters mapping (e.g., { fields: 'id,name' })."
            },
            requestBody: {
              type: "object",
              description: "JSON request body payload."
            },
            usePageToken: {
              type: "boolean",
              description: "Set to true to aggregate paginated lists automatically."
            }
          },
          required: ["api", "version", "methodName"]
        }
      }
    },
    call_google_api: (args) => {
      // Static fallback implementation (can also be called directly)
      const api = args.api;
      const version = args.version;
      const methodName = args.method || args.methodName;


      if (!api || !version || !methodName) {
        throw new Error("Missing required parameters.");
      }


      const paramsObj = args.parameters || {};
      const params = {
        path: args.path || paramsObj.path || {},
        query: args.query || paramsObj.query || {},
        requestBody: args.requestBody || paramsObj.requestBody || null,
        usePageToken: args.usePageToken !== undefined ? !!args.usePageToken : !!paramsObj.usePageToken
      };


      let res;
      let isError = false;
      try {
        GoogleApiApp.setAPIInf({ api, version, methodName });
        GoogleApiApp.setAPIParams(params);
        const response = GoogleApiApp.request();
        if (response && typeof response.getContentText === "function") {
          res = response.getContentText();
        } else if (typeof response === "string") {
          res = response;
        } else {
          res = JSON.stringify(response);
        }
      } catch (error) {
        res = `Error: ${error.message}`;
        isError = true;
      }


      const returnObj = {
        mcp: {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: res }], isError: isError }
        },
        a2a: { result: res }
      };


      return {
        ...returnObj,
        _gemini_halt: true,
        items: { functionResponse: returnObj }
      };
    }
  };


  const agentCard = {
    name: "Google_API_MCP_Server",
    description: "Stateless deterministic proxy server to run arbitrary Google APIs.",
    provider: { organization: "Enterprise GAS Architecture", url: "https://github.com/tanaikech" },
    version: "1.0.0",
    url: WEB_APPS_URL + (ACCESS_KEY ? `?accessKey=${ACCESS_KEY}` : ""),
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    skills: []
  };


  return { functions, agentCard };
}
