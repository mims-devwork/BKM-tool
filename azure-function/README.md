# BKM Studio — Azure Function Proxy

Proxies requests from the browser to Azure OpenAI.  
The API key lives here as an encrypted env var — users never see it.  
Every call is logged with the caller's name and email via Easy Auth.

---

## Azure Portal setup (one-time)

### 1. Create Function App
- Runtime: **Node.js 20**, Plan: **Consumption**, OS: Windows or Linux

### 2. Set environment variables
Function App → **Environment variables** → add:

| Name | Value |
|---|---|
| `OPENAI_API_KEY` | your Azure OpenAI API key (from Azure OpenAI resource → Keys and Endpoint) |
| `AZURE_OPENAI_ENDPOINT` | `https://bkm-generator-resource.openai.azure.com/openai/v1` |

Click **Apply**.

### 3. Enable Easy Auth
Function App → **Authentication** → **Add identity provider** → **Microsoft**
- App registration type: **Create new**
- Supported account types: **Current tenant only**
- Unauthenticated requests: **HTTP 401 Unauthorized**

Click **Add**. Then click the Microsoft provider that appears and copy the **Application (client) ID**.

### 4. Update bkm-bosch.html
Replace the two placeholders near the top of the `<script>` block:

```js
var FUNCTION_URL   = 'https://<your-function-app-name>.azurewebsites.net/api/generate';
var FUNCTION_SCOPE = 'api://<client-id-from-step-3>/.default';
```

### 5. Deploy
```bash
cd azure-function
npm install
npx func azure functionapp publish <your-function-app-name> --node
```
Requires: `npm install -g azure-functions-core-tools@4` and `az login`

---

## Viewing usage logs
Function App → **Application Insights** → **Logs** → run:
```kusto
traces
| where message startswith "[generate]"
| project timestamp, message
| order by timestamp desc
```
Each row shows the caller's name and email.
