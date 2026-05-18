/**
 * Practical 1: Multi-Agent Customer Support Orchestrator
 *
 * Demonstrates SubAgents, static Agent Skills, and strict JSON output routing.
 * Requires GEMINI_API_KEY in Script Properties.
 */
function practical_CustomerSupportOrchestrator() {
  const { LlmAgent } = GASADK;

  const properties = PropertiesService.getScriptProperties();
  const API_KEY = properties.getProperty("GEMINI_API_KEY");
  if (!API_KEY)
    throw new Error("GEMINI_API_KEY is missing in Script Properties.");

  const tempFolder = DriveApp.createFolder("Temp_Skills_" + Date.now());

  try {
    const policyFolder = tempFolder.createFolder("support_policy");
    policyFolder.createFile(
      "SKILL.md",
      "---\nname: support_policy\ndescription: Corporate policy for customer support actions.\n---\nRule: If sentiment is NEGATIVE, the manager_action_plan MUST be 'ESCALATE_TO_HUMAN'. Otherwise, it is 'AUTO_REPLY'.",
      MimeType.PLAIN_TEXT,
    );

    const translatorAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "TranslatorAgent",
      description: "Translates foreign text into English.",
      model: "models/gemini-3.1-flash-lite",
      instruction:
        "Return ONLY the exact English translation of the provided text.",
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const sentimentAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "SentimentAgent",
      description: "Analyzes sentiment of text.",
      model: "models/gemini-3.1-flash-lite",
      instruction: "Return ONLY one word: POSITIVE, NEUTRAL, or NEGATIVE.",
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const mainAgent = new LlmAgent({
      apiKey: API_KEY,
      name: "SupportOrchestrator",
      model: "models/gemini-3.1-flash-lite",
      instruction:
        "Process the customer inquiry. Use TranslatorAgent to translate it, SentimentAgent to analyze it, and the support_policy skill to determine the action plan. Output strictly as JSON.",
      skillFolderId: tempFolder.getId(),
      subAgents: [translatorAgent, sentimentAgent],
      outputSchema: {
        type: "object",
        properties: {
          original_text: { type: "string" },
          english_translation: { type: "string" },
          sentiment: { type: "string" },
          manager_action_plan: { type: "string" },
        },
        required: [
          "original_text",
          "english_translation",
          "sentiment",
          "manager_action_plan",
        ],
      },
    }).setServices({
      lock: LockService.getScriptLock(),
      properties: properties,
    });

    const prompt =
      "Inquiry: Bonjour, mon application plante à chaque fois que j'essaie de me connecter. C'est très frustrant ! Aidez-moi vite.";

    console.log("Executing Orchestrator DAG...");
    const response = mainAgent.run(prompt, (log) => {
      console.log(`[${log.timestamp}] ${log.message}`);
    });

    console.log("Final Compiled Report:\n", JSON.stringify(response, null, 2));
  } finally {
    tempFolder.setTrashed(true);
  }
}
