/**
 * Practical 4 Client: Enterprise Intelligence Orchestrator
 * Requires GEMINI_API_KEY. Run setup_IntelligenceEnvironment() once.
 * Set A2A_SERVER_URL to the deployed Node Web App URL before executing the pipeline.
 * URL will be https://script.google.com/macros/s/{deploymentId}/exec/.well-known/agent-card.json`
 */
const A2A_SERVER_URL =
  "https://script.google.com/macros/s/{deploymentId}/exec/.well-known/agent-card.json";

function setup_IntelligenceEnvironment() {
  const folder = DriveApp.createFolder("Intelligence_Workspace_" + Date.now());
  const folderId = folder.getId();
  PropertiesService.getScriptProperties().setProperty(
    "WORKSPACE_FOLDER_ID",
    folderId,
  );

  const skillFolder = folder.createFolder("Corporate_Reporting_Guidelines");
  const guidelineText = `---\nname: Corporate_Reporting_Guidelines\ndescription: Structural guidelines for intelligence reports.\n---\nCORPORATE REPORTING GUIDELINES\nReports MUST follow this structure:\n# 1. EXECUTIVE SUMMARY\n# 2. FINANCIAL TELEMETRY\n# 3. MARKET SENTIMENT\n# 4. STRATEGIC OUTLOOK`;
  skillFolder.createFile("SKILL.md", guidelineText, MimeType.PLAIN_TEXT);

  const ss = SpreadsheetApp.create("Target_Corporations_Tracker_" + Date.now());
  const sheet = ss.getActiveSheet();
  sheet.appendRow([
    "Target Company",
    "Status",
    "Report Document URL",
    "Brief Summary",
  ]);
  const targets = [
    ["CyberDyne Systems", "PENDING", "", ""],
    ["Massive Dynamic", "PENDING", "", ""],
  ];
  sheet.getRange(2, 1, targets.length, 4).setValues(targets);

  PropertiesService.getScriptProperties().setProperty(
    "TRACKING_SHEET_ID",
    ss.getId(),
  );
  console.log(`Setup Complete. Tracking Sheet URL: ${ss.getUrl()}`);
}

function execute_IntelligencePipeline() {
  if (A2A_SERVER_URL.includes("YOUR_NODE"))
    throw new Error("A2A_SERVER_URL not configured.");

  const { LlmAgent } = GASADK;
  const props = PropertiesService.getScriptProperties();
  const API_KEY = props.getProperty("GEMINI_API_KEY");
  const folderId = props.getProperty("WORKSPACE_FOLDER_ID");
  const sheetId = props.getProperty("TRACKING_SHEET_ID");

  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getActiveSheet();
  const data = sheet.getDataRange().getValues();

  const sentimentAgent = new LlmAgent({
    apiKey: API_KEY,
    name: "SentimentAnalyzer",
    description: "Evaluates raw news text for market sentiment.",
    model: "models/gemini-3.1-flash-lite",
    instruction:
      "Output EXACTLY one prefix: [BULLISH], [BEARISH], or [NEUTRAL], followed by a single sentence justification.",
  }).setServices({ lock: LockService.getScriptLock(), properties: props });

  const orchestrator = new LlmAgent({
    apiKey: API_KEY,
    name: "ApexOrchestrator",
    model: "models/gemini-3.1-flash-lite",
    skillFolderId: folderId,
    subAgents: [sentimentAgent],
    a2aServerAgentCardURLs: [A2A_SERVER_URL],
    googleSearch: {},
    instruction: `Construct an intelligence report. Extract telemetry from the A2A node, search Google for recent news, and use SentimentAnalyzer. Synthesize the data adhering strictly to the Corporate_Reporting_Guidelines skill. Save via generate_google_doc_report.`,
    tools: [
      {
        name: "generate_google_doc_report",
        description:
          "Creates a persistent Google Document with the compiled markdown report.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            markdown_content: { type: "string" },
          },
          required: ["title", "markdown_content"],
        },
        function: (args) => {
          const doc = DocumentApp.create(args.title);
          doc.getBody().setText(args.markdown_content);
          DriveApp.getFileById(doc.getId()).moveTo(
            DriveApp.getFolderById(folderId),
          );
          return { docUrl: doc.getUrl() };
        },
      },
    ],
    outputSchema: {
      type: "object",
      properties: {
        doc_url: { type: "string" },
        brief_summary: { type: "string" },
      },
      required: ["doc_url", "brief_summary"],
    },
  }).setServices({ lock: LockService.getScriptLock(), properties: props });

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] !== "PENDING") continue;

    sheet.getRange(i + 1, 2).setValue("PROCESSING");
    SpreadsheetApp.flush();

    try {
      const response = orchestrator.run(
        `Gather intelligence for: ${data[i][0]}`,
        (log) => {
          console.log(`[${log.timestamp}] ${log.message}`);
        },
      );
      sheet.getRange(i + 1, 2).setValue("COMPLETED");
      sheet.getRange(i + 1, 3).setValue(response.doc_url);
      sheet.getRange(i + 1, 4).setValue(response.brief_summary);
    } catch (err) {
      sheet.getRange(i + 1, 2).setValue("FAILED");
    }
    SpreadsheetApp.flush();
  }
}
