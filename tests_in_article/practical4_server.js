/**
 * Practical 4 Server: A2A Financial Telemetry Node
 * Deploy as a Web App in a separate GAS project with GASADK installed.
 */
function doGet(e) {
  return main(e);
}
function doPost(e) {
  return main(e);
}

const WEB_APPS_URL = "https://script.google.com/macros/s/{deploymentId}/exec"; // Please set your Web Apps URL.

function main(e) {
  const { MCPA2Aserver } = GASADK;
  const lock = LockService.getScriptLock();
  const API_KEY =
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!API_KEY) throw new Error("GEMINI_API_KEY is missing.");

  const m = new MCPA2Aserver();
  m.setServices({ lock: lock });
  m.apiKey = API_KEY;
  m.a2a = true; // Explicitly enable A2A protocol

  const context = {
    functions: {
      params_: {
        get_financial_telemetry: {
          description:
            "Fetches critical financial data for a specified corporation.",
          parameters: {
            type: "object",
            properties: { company_name: { type: "string" } },
            required: ["company_name"],
          },
        },
      },
      get_financial_telemetry: (args) => {
        const hash = args.company_name.length;
        const marketCap = (hash * 18.5).toFixed(2) + "B USD";
        const stockPrice = (hash * 14.3).toFixed(2) + " USD";
        return {
          a2a: {
            result: `Telemetry for ${args.company_name} | Market Cap: ${marketCap} | Stock Price: ${stockPrice}`,
          },
        };
      },
    },
    agentCard: {
      name: "FinancialDataNode",
      description:
        "Provides encrypted financial telemetry for global corporations.",
      url: WEB_APPS_URL,
      skills: [
        { id: "get_financial_telemetry", name: "Fetch Financial Telemetry" },
      ],
    },
  };

  return m.main(e, context);
}
