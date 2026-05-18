/**
 * Practical 2: Financial Data Analyzer with Code Execution
 * Requires GEMINI_API_KEY in Script Properties.
 */
function practical_FinancialForecaster() {
  const { LlmAgent } = GASADK;
  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");

  if (!API_KEY)
    throw new Error("GEMINI_API_KEY is missing in Script Properties.");

  const ss = SpreadsheetApp.create("Temp_Financial_Data_" + Date.now());
  const sheet = ss.getActiveSheet();
  const data = [
    ["Month", "Revenue"],
    [1, 10000],
    [2, 11500],
    [3, 12000],
    [4, 13500],
    [5, 14000],
    [6, 15500],
  ];
  sheet.getRange(1, 1, data.length, 2).setValues(data);
  const ssId = ss.getId();

  try {
    const agent = new LlmAgent({
      apiKey: API_KEY,
      name: "FinancialAnalyst",
      model: "models/gemini-3.1-flash-lite",
      instruction:
        "Use getSpreadsheetData to retrieve revenue data. Then, use your code executor to mathematically calculate the average monthly growth rate and predict Month 7 revenue.",
      codeExecutor: {},
      tools: [
        {
          name: "getSpreadsheetData",
          description: "Fetches the raw financial revenue data.",
          parameters: { type: "object", properties: {} },
          function: () =>
            SpreadsheetApp.openById(ssId)
              .getActiveSheet()
              .getDataRange()
              .getValues(),
        },
      ],
      outputSchema: {
        type: "object",
        properties: {
          average_growth_rate_percentage: { type: "number" },
          month_7_prediction: { type: "number" },
          analysis_summary: { type: "string" },
        },
        required: [
          "average_growth_rate_percentage",
          "month_7_prediction",
          "analysis_summary",
        ],
      },
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const response = agent.run("Execute the financial analysis.", (log) => {
      console.log(`[${log.timestamp}] ${log.message}`);
    });
    console.log("Analysis Result:\n", JSON.stringify(response, null, 2));
  } finally {
    DriveApp.getFileById(ssId).setTrashed(true);
  }
}
