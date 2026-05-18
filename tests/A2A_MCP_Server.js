/**
 * Script for Consolidating Generative AI Protocols: A Single Server Solution for MCP and A2A
 * Author: Tanaike
 * Refactored Version with Explicit Override Support
 */

const { MCPA2Aserver } = GASADK;

const API_KEY =
  PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
const WEB_APPS_URL =
  "https://script.google.com/macros/s/{Your deployment ID}/exec"; // Please set your Web Apps URL.

// --- Your variables ---
const object = {
  apiKey: API_KEY,
  model: "models/gemini-3-flash-preview",
  accessKey: "sample",
  // logSpreadsheetId: "{Google Spreadsheet ID}", // Log is stored to this Google Spreadsheet.
};

// --- Entry Points ---
const doGet = (e) => main(e);
const doPost = (e) => main(e);

/**
 * Main Dispatcher Function
 * Handles the HTTP execution, configures the consolidated server, and routes the request.
 *
 * @param {EventObject} e - The event object from doGet/doPost
 * @return {ContentService.TextOutput} The JSON response
 */
function main(e) {
  const lock = LockService.getScriptLock();

  if (object.logSpreadsheetId) {
    try {
      lock.waitLock(10000);
      SpreadsheetApp.openById(object.logSpreadsheetId)
        .getSheetByName("raw")
        .appendRow([new Date(), JSON.stringify(e)]);
    } catch (err) {
      console.error("Lock timeout for raw logging", err);
    } finally {
      lock.releaseLock();
    }
  }

  const context = createServerContext_();
  const m = new MCPA2Aserver();

  m.setServices({ lock: lock });
  m.apiKey = object.apiKey;
  m.model = object.model;

  // --- Manual Server Overrides ---
  // Setting these to true/false forces the server configuration, bypassing automatic detection.
  // E.g., setting m.a2a = true and m.mcp = false runs exclusively as an A2A Server.
  // If omitted or set to null, the server intelligently detects configuration from 'context'.
  m.a2a = true;
  m.mcp = true;

  if (object.accessKey) m.accessKey = object.accessKey;
  if (object.logSpreadsheetId) m.logSpreadsheetId = object.logSpreadsheetId;

  // Real-time logging callback function
  const logCallback = (log) => {
    console.log(
      `[${log.level}] ${log.timestamp} (ID: ${log.execId}) - ${log.message}`,
    );
  };

  const res = m.main(e, context, logCallback);

  // Retrieve comprehensive logs post-execution
  const allLogs = m.getLogs();
  console.log("Execution Log Summary:", JSON.stringify(allLogs, null, 2));

  return res;
}

/**
 * Returns the Agent Card directly for discovery.
 */
function getAgentCard() {
  const obj = createServerContext_();
  if (!obj.agentCard) {
    console.error("Agent Card is not defined.");
    return;
  }
  const disp = JSON.stringify(obj.agentCard, null, 2)
    .split("\n")
    .map((e) => `  ${e}`)
    .join("\n");
  console.log(disp);
}

/**
 * Creates the base context containing definitions for the tools and the agent card.
 * The MCPA2Aserver class intrinsically segregates these items into A2A and MCP structures
 * based on the "type" property and the explicit server boolean flags.
 *
 * Tool Categorization Rules:
 * - type: "mcp" -> Exclusive to MCP.
 * - type: "a2a" -> Exclusive to A2A.
 * - type undefined -> Available in both.
 *
 * @returns {{ functions: Object, agentCard?: Object }} The unified context.
 */
function createServerContext_() {
  const functions = {
    params_: {
      get_exchange_rate: {
        // type: "a2a", // Explicitly bind to A2A, or "mcp", or leave undefined for both.
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
        // type: "mcp",
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
    },

    get_exchange_rate: (object) => {
      console.log("Run the function get_exchange_rate.");
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
      return {
        mcp: {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: res }], isError: false },
        },
        a2a: { result: res },
      };
    },

    get_current_weather: (object) => {
      console.log("Run the function get_current_weather.");
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
      return {
        mcp: {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: res }], isError: false },
        },
        a2a: { result: res },
      };
    },
  };

  const agentCard = {
    name: "API Manager",
    description: [
      `Provide management for using various APIs.`,
      `- Run with exchange values between various currencies. For example, this answers "What is the exchange rate between USD and GBP?".`,
      `- Return the weather information by providing the location and the date, and the time.`,
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
    ],
  };

  return { functions, agentCard };
}
