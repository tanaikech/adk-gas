# Google API MCP / A2A Server for GASADK

This directory contains a standalone sample deployment script (`DeployMcpServer.js`) to expose the [GoogleApiApp](https://github.com/tanaikech/GoogleApiApp) library as an agent-less **Model Context Protocol (MCP)** and **Agent-to-Agent (A2A)** Server on Google Apps Script (GAS).

By deploying this script as a GAS Web App, you can connect your AI agents (such as Antigravity CLI, Claude Desktop, or custom orchestrators) to run any arbitrary Google Workspace API (including Google Sheets, Drive, Docs, Calendar, Gmail, Slides, etc.) dynamically.

---

## 🌟 Features

- **Dynamic Tool Mapping**: Automatically resolves tool calls in the format `<API_NAME>_<METHOD_NAME>` (e.g. `sheets_spreadsheets_create`) and routes them on-the-fly to the correct Google API, version, and method.
- **Universal Google API Fallback**: Includes a static fallback tool `call_google_api` which lets you execute any raw Google API call by specifying the API, version, and methodName manually.
- **Agent-less Deployment**: No server hosting required. Runs completely serverless on Google Apps Script infrastructure.
- **Dual Support**: Operates as both an MCP server (JSON-RPC 2.0 compliant) and a GASADK A2A (Agent-to-Agent) client-facing server.

---

## ⚙️ Prerequisites

1. A **Google Account** (to write and host Google Apps Script).
2. A **Gemini API Key** (obtainable for free/pay-as-you-go from [Google AI Studio](https://aistudio.google.com/)).
3. (Optional) A Google Spreadsheet ID to store execution logs.

---

## 📥 Step-by-Step Installation Guide

Follow these steps to deploy your Google API MCP Server:

### Step 1: Create a Google Apps Script Project
1. Open your browser and go to [script.google.com](https://script.google.com/).
2. Click on **New Project**.
3. Rename the project to something descriptive (e.g. `Google_API_MCP_Server`).

### Step 2: Add Required GAS Libraries
You need to add two external libraries to your project.
1. In the left sidebar, click the **"+"** button next to **Libraries**.
2. **Add GASADK**:
   - In the **Script ID** input box, paste: `1w2mwhWQd4_6rom-UBRPD8gayBoqGH_87awSBVqGI8DdaQI_pOeSuGYDu`
   - Click **Look up**.
   - Choose the latest version in the dropdown.
   - Keep the Identifier as `GASADK`.
   - Click **Add**.
3. **Add GoogleApiApp**:
   - Click the **"+"** button next to **Libraries** again.
   - In the **Script ID** input box, paste: `1YVWd5qzz0quKljrJkliE143UwwJq1BopoZQSwNEqwNgHOPQ9VeaQeNS7`
   - Click **Look up**.
   - Choose the latest version in the dropdown (specifically Version 10 or higher).
   - Keep the Identifier as `GoogleApiApp`.
   - Click **Add**.

### Step 3: Copy and Paste the Script
1. Open the `Code.gs` file in the GAS editor.
2. Replace all the default template code with the code from [DeployMcpServer.js](./DeployMcpServer.js).
3. Save the project (click the disk icon or press `Ctrl+S` / `Cmd+S`).

### Step 4: Configure Script Properties (Environment Variables)
To store your API keys and configuration safely:
1. Click on the **Project Settings** (gear icon) in the left sidebar.
2. Scroll down to the **Script Properties** section and click **Add script property**.
3. Add the following properties:
   - **`GEMINI_API_KEY`**: Paste your Gemini API Key here (Required for server verification).
   - **`ACCESS_KEY`**: Choose a custom security password of your choice (Default: `sample`). This prevents unauthorized users from calling your server.
   - **`LOG_SPREADSHEET_ID`** *(Optional)*: If you want logging, create a blank Google Sheet, copy its ID from the URL, and paste it here.
4. Click **Save script properties**.

### Step 5: Deploy as a Web App
1. Click the **Deploy** button in the top right corner, then select **New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Configure the settings:
   - **Description**: `Google API MCP Server Version 1`
   - **Execute as**: `Me` (this is critical so the server runs with your permissions to access your Google Docs/Sheets/Drive).
   - **Who has access**: `Anyone` (necessary for external clients/clis to connect, but authorization will still be validated using your `ACCESS_KEY`).
4. Click **Deploy**.
5. *If prompted, click **Authorize access** and log in with your Google account to grant permissions.*
6. Copy the **Web App URL** shown under "Web app" (it will look like `https://script.google.com/macros/s/.../exec`).

### Step 6: Update URL in the Script (Recommended)
1. Go back to the **Editor** tab in GAS.
2. In the code, find the line:
   ```javascript
   const WEB_APPS_URL = "https://script.google.com/macros/s/{deployment ID}/exec";
   ```
3. Replace the placeholder URL with your actual copied Web App URL.
4. Save the file.
5. Click **Deploy** > **Manage deployments**.
6. Select your active deployment, click the **Edit** (pencil) icon, select **New version** in the Version dropdown, and click **Deploy**. This ensures the server uses the correct self-referential URL.

---

## 🛠 Usage & Integration

### Using with Antigravity CLI
You can integrate this MCP server directly into your Antigravity CLI. 

1. Locate your local configuration file. For Linux and macOS, it is typically located at:
   `/home/{user name}/.gemini/config/mcp_config.json`
2. Add the following configuration to the `mcpServers` block.
   Make sure to update the path to your `/path/to/ggsrun` executable. `ggsrun` acts as a terminal wrapper that tunnels standard I/O streams into the deployed Google Apps Script Web App.

```json
{
  "mcpServers": {
    "ggsrun-drive-agent": {
      "command": "/{your path}/ggsrun",
      "args": ["mcp"]
    }
  }
}
```

---

## 🧪 Testing Your MCP Server

You can easily test if your deployed Web App is running correctly by sending HTTP POST requests using `curl` commands in your terminal. Replace `<YOUR_MCP_SERVER_URL>` with your actual GAS Web App URL and `<YOUR_ACCESS_KEY>` with the `ACCESS_KEY` script property you configured (default is `sample`).

### Test 1: `tools/list` (Retrieve capability definitions)
This request polls the server to retrieve all defined tools.

```bash
curl -L "<YOUR_MCP_SERVER_URL>?accessKey=<YOUR_ACCESS_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

*Expected output:* A JSON object containing descriptions of `call_google_api` along with server details.

### Test 2: `tools/call` (Create a Google Spreadsheet dynamically)
This request utilizes the Dynamic Tool Mapping to run the `sheets_spreadsheets_create` tool. The server will dynamically load the Sheets v4 API and create a new spreadsheet.

```bash
curl -L "<YOUR_MCP_SERVER_URL>?accessKey=<YOUR_ACCESS_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "sheets_spreadsheets_create",
      "arguments": {
        "requestBody": {
          "properties": {
            "title": "Created via MCP Curl Test"
          }
        }
      }
    }
  }'
```

*Expected output:* A success response containing the created spreadsheet metadata (ID, spreadsheetUrl, etc.) in the `content[0].text` field.

### Test 3: `tools/call` with fallback tool (`call_google_api`)
Alternatively, you can call the generic proxy tool to list your Google Drive files.

```bash
curl -L "<YOUR_MCP_SERVER_URL>?accessKey=<YOUR_ACCESS_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "call_google_api",
      "arguments": {
        "api": "drive",
        "version": "v3",
        "methodName": "files.list",
        "query": {
          "pageSize": 5,
          "fields": "files(id, name)"
        }
      }
    }
  }'
```

*Expected output:* A list of your top 5 Google Drive files.
