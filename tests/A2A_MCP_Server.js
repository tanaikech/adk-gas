/**
 * tests/A2A_MCP_Server.js
 * [Consolidated Generative AI Protocols Server - v1.3.3 Integration]
 *
 * @description
 * A unified server deployment for Google Apps Script handling both Model Context Protocol (MCP)
 * and Agent-to-Agent (A2A) communications.
 *
 * [Key Updates in v1.3.3]:
 * - Native Raw Event Logging: The server-side entry points 'doGet' and 'doPost' pass the event 'e'
 *   directly to MCPA2Aserver.main(), which automatically handles raw event serialization to the
 *   "raw" sheet. No duplicate manual logging code is required here.
 * - Auto-Sheet Initialization: All required tracking sheets ("raw", "MCP", "A2A", "MCPA2Aserver_log")
 *   are automatically validated and created by the library with double-locking protection.
 *
 * [Setup Instructions]:
 * 1. Deploy this script as a Web App:
 *    - Click "Deploy" > "New deployment".
 *    - Select type "Web app".
 *    - Set "Execute as" to "Me".
 *    - Set "Who has access" to "Anyone".
 *    - Copy the Web App URL and paste it into the WEB_APPS_URL variable below.
 * 2. Configure GEMINI_API_KEY:
 *    - Go to Project Settings (Gear icon) > Script Properties.
 *    - Add "GEMINI_API_KEY" with your actual Google AI Studio key.
 * 3. (Optional) Configure Log Spreadsheet:
 *    - Create a blank Google Spreadsheet.
 *    - Copy its ID and set it as `logSpreadsheetId` in the `object` configuration below.
 */

const { MCPA2Aserver } = GASADK;

const API_KEY =
  PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
const WEB_APPS_URL =
  "https://script.google.com/macros/s/{Your deployment ID}/exec"; // MUST match the deployed Web App URL.

// Unified Server Configuration Properties
const object = {
  apiKey: API_KEY,
  model: "models/gemini-3-flash-preview",
  accessKey: "sample",
  // logSpreadsheetId: "YOUR_SPREADSHEET_ID_HERE", // Set your Google Spreadsheet ID to activate multi-channel logging
};

// Web App entry point for HTTP GET requests
const doGet = (e) => main(e);

// Web App entry point for HTTP POST requests
const doPost = (e) => main(e);

/**
 * Main Dispatcher Entry Point
 * Decouples, routes, and processes incoming GET/POST transactions.
 *
 * @param {EventObject} e - The raw Google Apps Script Event Object.
 * @return {ContentService.TextOutput} The JSON-RPC or A2A output payload.
 */
function main(e) {
  const lock = LockService.getScriptLock();
  const context = createServerContext_();
  const m = new MCPA2Aserver();

  m.setServices({ lock: lock });
  m.apiKey = object.apiKey;
  m.model = object.model;

  // Forcefully enable both A2A and MCP routing protocols
  m.a2a = true;
  m.mcp = true;

  if (object.accessKey) m.accessKey = object.accessKey;
  if (object.logSpreadsheetId) m.logSpreadsheetId = object.logSpreadsheetId;

  // Inject Server-Side Base History for A2A protocols
  m.setHistory([
    {
      role: "user",
      parts: [
        {
          text: "System Context Override: You are an elite financial API node named OMEGA-SERVER, located securely in Tokyo.",
        },
      ],
    },
    {
      role: "model",
      parts: [
        {
          text: "Understood. I have internalized my persona as a Tokyo-based financial API node named OMEGA-SERVER. My secret access code is OMEGA-99.",
        },
      ],
    },
  ]);

  // Execution trace logging callback
  const logCallback = (log) => {
    console.log(
      `[${log.level}] ${log.timestamp} (ID: ${log.execId}) - ${log.message}`,
    );
  };

  // Dispatches the request through MCPA2Aserver's robust lifecycle loop
  const res = m.main(e, context, logCallback);
  return res;
}

/**
 * Prints the constructed Agent Card schema cleanly in the console for debug discovery.
 */
function getAgentCard() {
  const obj = createServerContext_();
  if (!obj.agentCard) {
    console.error("Error: Agent Card is not defined.");
    return;
  }
  const disp = JSON.stringify(obj.agentCard, null, 2)
    .split("\n")
    .map((e) => `  ${e}`)
    .join("\n");
  console.log(disp);
}

/**
 * Creates the unified context mapping defining native tools and server metadata.
 *
 * @return {Object} An object structure matching { functions, agentCard }.
 * @private
 */
function createServerContext_() {
  const functions = {
    params_: {
      get_exchange_rate: {
        description: "Use this to get current exchange rate.",
        parameters: {
          type: "object",
          properties: {
            currency_from: {
              type: "string",
              description: "Source currency (major currency). Default is USD.",
            },
            currency_to: {
              type: "string",
              description:
                "Destination currency (major currency). Default is EUR.",
            },
            currency_date: {
              type: "string",
              description:
                "Date of the currency. Default is latest. It should be ISO format (YYYY-MM-DD).",
            },
          },
          required: ["currency_from", "currency_to", "currency_date"],
        },
      },

      get_current_weather: {
        description: [
          "Use this to get the weather using the latitude and the longitude.",
          "At that time, convert the location to the latitude and the longitude and provide them to the function.",
          `The date is required to be included. The date format is "yyyy-MM-dd HH:mm"`,
          `If you cannot know the location, decide the location using the timezone.`,
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            latitude: {
              type: "number",
              description: "The latitude of the inputed location.",
            },
            longitude: {
              type: "number",
              description: "The longitude of the inputed location.",
            },
            date: {
              type: "string",
              description: `Date for searching the weather. The date format is "yyyy-MM-dd HH:mm"`,
            },
            timezone: {
              type: "string",
              description: `The timezone. In the case of Japan, "Asia/Tokyo" is used.`,
            },
          },
          required: ["latitude", "longitude", "date", "timezone"],
        },
      },

      chat_and_identity: {
        description:
          "Answer general conversation, identity, location, and secret code questions based on the chat history.",
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description:
                "The complete, detailed response message addressing all of the user's questions.",
            },
          },
          required: ["message"],
        },
      },
    },

    get_exchange_rate: (object) => {
      console.log("Executing get_exchange_rate tool...");
      const {
        currency_from = "USD",
        currency_to = "EUR",
        currency_date = "latest",
      } = object;
      let res;
      try {
        const resStr = UrlFetchApp.fetch(
          `https://api.frankfurter.app/${currency_date}?from=${currency_from}&to=${currency_to}`,
        ).getContentText();
        const obj = JSON.parse(resStr);
        res = [
          `The raw data from the API is ${resStr}. The detailed result is as follows.`,
          `The currency rate at ${currency_date} from "${currency_from}" to "${currency_to}" is ${obj.rates[currency_to]}.`,
        ].join("\n");
      } catch ({ stack }) {
        res = stack;
      }

      const returnObj = {
        mcp: {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: res }], isError: false },
        },
        a2a: { result: res },
      };

      // [Optimization]: Forcefully bypass the server-side LLM synthesis loop to prevent hallucination and save tokens.
      return {
        ...returnObj,
        _gemini_halt: true,
        items: { functionResponse: returnObj },
      };
    },

    get_current_weather: (object) => {
      console.log("Executing get_current_weather tool...");
      const {
        latitude = "35.681236",
        longitude = "139.767125",
        date = "2025-05-27 12:00",
        timezone = "Asia/Tokyo",
      } = object;
      let res;
      try {
        const code = {
          0: "Clear sky",
          1: "Mainly clear, partly cloudy, and overcast",
          2: "Mainly clear, partly cloudy, and overcast",
          3: "Mainly clear, partly cloudy, and overcast",
          45: "Fog and depositing rime fog",
          48: "Fog and depositing rime fog",
          51: "Drizzle: Light, moderate, and dense intensity",
          53: "Drizzle: Light, moderate, and dense intensity",
          55: "Drizzle: Light, moderate, and dense intensity",
          56: "Freezing Drizzle: Light and dense intensity",
          57: "Freezing Drizzle: Light and dense intensity",
          61: "Rain: Slight, moderate and heavy intensity",
          63: "Rain: Slight, moderate and heavy intensity",
          65: "Rain: Slight, moderate and heavy intensity",
          66: "Freezing Rain: Light and heavy intensity",
          67: "Freezing Rain: Light and heavy intensity",
          71: "Snow fall: Slight, moderate, and heavy intensity",
          73: "Snow fall: Slight, moderate, and heavy intensity",
          75: "Snow fall: Slight, moderate, and heavy intensity",
          77: "Snow grains",
          80: "Rain showers: Slight, moderate, and violent",
          81: "Rain showers: Slight, moderate, and violent",
          82: "Rain showers: Slight, moderate, and violent",
          85: "Snow showers slight and heavy",
          86: "Snow showers slight and heavy",
          95: "Thunderstorm: Slight or moderate",
          96: "Thunderstorm with slight and heavy hail",
          99: "Thunderstorm with slight and heavy hail",
        };
        const endpoint = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=weather_code&timezone=${encodeURIComponent(timezone)}`;
        const resObj = UrlFetchApp.fetch(endpoint, {
          muteHttpExceptions: true,
        });
        if (resObj.getResponseCode() == 200) {
          const obj = JSON.parse(resObj.getContentText());
          const {
            hourly: { time, weather_code },
          } = obj;
          const widx = time.indexOf(date.replace(" ", "T").trim());
          if (widx != -1) {
            res = code[weather_code[widx]];
          } else {
            res = "No value was returned. Please try again.";
          }
        } else {
          res = "No value was returned. Please try again.";
        }
      } catch ({ stack }) {
        res = stack;
      }

      const returnObj = {
        mcp: {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: res }], isError: false },
        },
        a2a: { result: res },
      };

      // [Optimization]: Forcefully bypass the server-side LLM synthesis loop.
      return {
        ...returnObj,
        _gemini_halt: true,
        items: { functionResponse: returnObj },
      };
    },

    chat_and_identity: (object) => {
      console.log("Executing chat_and_identity tool...");
      const res = object.message || "I have processed your chat request.";

      const returnObj = {
        mcp: {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: res }], isError: false },
        },
        a2a: { result: res },
      };

      // [Optimization]: Return immediately to the client to avoid endless generative loops and token bloat.
      return {
        ...returnObj,
        _gemini_halt: true,
        items: { functionResponse: returnObj },
      };
    },
  };

  const agentCard = {
    name: "API_Manager",
    description: [
      `Provide management for using various APIs and handle conversational queries.`,
      `- Run with exchange values between various currencies.`,
      `- Return the weather information.`,
      `- Answer questions about your own identity, location, access codes, and remember user details.`,
    ].join("\n"),
    provider: {
      organization: "Tanaike",
      url: "https://github.com/tanaikech",
    },
    version: "1.0.0",
    url:
      WEB_APPS_URL + (object.accessKey ? `?accessKey=${object.accessKey}` : ""),
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: "get_exchange_rate",
        name: "Currency Exchange Rates Tool",
        description: "Helps with exchange values between various currencies",
        tags: ["currency conversion", "currency exchange"],
        examples: ["What is exchange rate between USD and GBP?"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
      {
        id: "get_current_weather",
        name: "Get current weather",
        description:
          "This agent can return the weather information by providing the location and the date, and the time.",
        tags: ["weather"],
        examples: [
          "Return the weather in Tokyo for tomorrow's lunchtime.",
          "Return the weather in Tokyo for 9 AM on May 27, 2025.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
      {
        id: "chat_and_identity",
        name: "Chat and Identity",
        description:
          "Can converse naturally about the user's name, the agent's location, secret codes, and general context.",
        tags: ["chat", "identity"],
        examples: ["What is my name?", "Where are you located?"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
  };

  return { functions, agentCard };
}
