/**
 * Practical 3: Custom Function for Multiple Cells using SubAgent
 * Run setup_Practical3_Environment() first, then use =BULK_FEEDBACK_ANALYZER(A2:A4) in B2.
 */
function setup_Practical3_Environment() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = [
    ["Customer Reviews"],
    ["The UI is great, but the app crashes when I try to upload a picture."],
    ["I absolutely love the new dark mode feature!"],
    ["Customer service took 3 days to reply. Very disappointed."],
  ];
  sheet.getRange(1, 1, data.length, 1).setValues(data);
  sheet.getRange("B1").setValue("Agent Analysis Output");
  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(2, 400);
}

/**
 * Custom function that processes bulk feedback using an orchestrated SubAgent.
 * @param {Array<Array<string>>} dataRange The range of cells containing the feedback.
 * @return {string} The categorized analysis.
 * @customfunction
 */
function BULK_FEEDBACK_ANALYZER(dataRange) {
  const { LlmAgent } = GASADK;
  if (!dataRange) return "Error: Provide a valid range.";

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");
  if (!API_KEY) return "Error: GEMINI_API_KEY missing.";

  try {
    const mergedData = dataRange
      .flat()
      .map((item, i) => `Review ${i + 1}: ${item}`)
      .join("\n");

    const categorizerAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "CategorizerAgent",
      description: "Categorizes customer reviews based on internal guidelines.",
      model: "models/gemini-3.1-flash-lite",
      instruction: `GUIDELINE: Classify strictly as "BUG" (crash/glitch), "PRAISE" (positive sentiment), or "COMPLAINT" (unhappy with service). Provide Category and short summary.`,
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const mainAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "ReviewOrchestrator",
      model: "models/gemini-3.1-flash-lite",
      instruction:
        "Send ALL reviews together to CategorizerAgent. Format the final output as clean, unstyled plain text.",
      subAgents: [categorizerAgent],
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    return mainAgent.run("Analyze the following reviews:\n\n" + mergedData);
  } catch (error) {
    return "Error: " + error.message;
  }
}
