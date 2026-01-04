# FAA Aircraft Certification Search

A web-based Retrieval-Augmented Generation (RAG) application for querying FAA aircraft certification regulations and guidance materials. Built with SolidJS frontend and Azure Functions backend, deployed on Azure Static Web Apps.

## Features

- **Intelligent Search**: Hybrid search combining semantic vector search and keyword matching across FAA regulations
- **AI-Powered Answers**: Claude Sonnet 4.5 generates accurate, cited responses based on retrieved documents
- **Source Citations**: Every answer includes references to specific FAA regulations and advisory circulars
- **Context Viewer**: Toggle to view the retrieved FAA regulations used to generate answers
- **Conversation History**: Browser-based localStorage persistence (up to 50 messages)
- **Export Capability**: Download conversation history as JSON or formatted text
- **Mobile Responsive**: Aviation-themed design that works on all devices
- **Example Questions**: Quick-start with pre-populated FAA certification questions

## Technology Stack

### Frontend
- **Framework**: SolidJS with TypeScript
- **Build Tool**: Vite
- **State Management**: Solid Stores (createStore)
- **Storage**: Browser localStorage
- **Styling**: Custom CSS with aviation theme

### Backend
- **Runtime**: Azure Functions (Node.js 18)
- **Language**: TypeScript
- **Search**: Azure AI Search with hybrid vector + keyword search
- **AI Model**: Claude Sonnet 4.5 (via Anthropic API)

### Deployment
- **Platform**: Azure Static Web Apps
- **CI/CD**: GitHub Actions
- **Resource Group**: `ML_Resource_Group`
- **Subscription**: `14483c8d-67b0-4fb5-a26a-317195bc08cc`

## Project Structure

```
faa-search-web/
├── frontend/                   # SolidJS application
│   ├── src/
│   │   ├── components/        # React-style components
│   │   ├── stores/            # Solid state management
│   │   ├── services/          # API and storage services
│   │   ├── types/             # TypeScript interfaces
│   │   └── App.tsx            # Root component
│   └── dist/                  # Production build output
│
├── api/                       # Azure Functions backend
│   ├── src/
│   │   ├── functions/         # HTTP trigger endpoints
│   │   └── lib/               # RAG pipeline, clients
│   └── dist/                  # Compiled JavaScript
│
└── staticwebapp.config.json   # Azure SWA routing config
```

## Local Development Setup

### Prerequisites

- Node.js 18+ and npm
- Azure Functions Core Tools 4.x
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/tbaraboi/faa-search-web.git
cd faa-search-web
```

### 2. Configure Backend Environment Variables

Create `api/local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "AZURE_SEARCH_ENDPOINT": "https://your-search-service.search.windows.net",
    "AZURE_SEARCH_KEY": "your-azure-search-key",
    "AZURE_SEARCH_INDEX": "your-index-name",
    "ANTHROPIC_API_KEY": "sk-ant-api03-..."
  },
  "Host": {
    "CORS": "*",
    "CORSCredentials": false
  }
}
```

**Important**: This file is gitignored for security. Never commit API keys.

### 3. Install Dependencies

```bash
# Backend
cd api
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Start Development Servers

**Terminal 1 - Backend (Azure Functions):**
```bash
cd api
npm start
# Runs on http://localhost:7071
```

**Terminal 2 - Frontend (Vite Dev Server):**
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

The Vite proxy automatically forwards `/api/*` requests to the Azure Functions backend.

### 5. Test the Application

Open [http://localhost:5173](http://localhost:5173) in your browser and try:
- Clicking example questions
- Asking custom FAA certification questions
- Toggling context visibility
- Exporting conversation history

## Production Build

### Build Frontend

```bash
cd frontend
npm run build
# Output: frontend/dist/
```

### Build Backend

```bash
cd api
npm run build
# Output: api/dist/
```

### Test Production Build Locally

```bash
cd frontend
npm run preview
# Serves production build on http://localhost:4173
```

## Deployment to Azure

### Prerequisites

- Azure account with active subscription
- Azure CLI installed and configured
- GitHub account (for CI/CD)

### Deployment Steps

#### 1. Switch to Deployment Account

```bash
az logout
az login  # Login with tbaraboi@hotmail.com
az account set --subscription "14483c8d-67b0-4fb5-a26a-317195bc08cc"
```

#### 2. Create Azure Static Web App

**Via Azure Portal:**
1. Go to [Azure Portal](https://portal.azure.com)
2. Create Resource → Static Web App
3. Configure:
   - **Subscription**: `14483c8d-67b0-4fb5-a26a-317195bc08cc`
   - **Resource Group**: `ML_Resource_Group` (existing)
   - **Name**: `faa-search-web`
   - **Region**: Choose appropriate region
   - **Deployment**: GitHub
   - **Repository**: Select `faa-search-web`
   - **Branch**: `main`
   - **Build Presets**: Custom
     - App location: `/frontend`
     - API location: `/api`
     - Output location: `dist`

**Via Azure CLI:**
```bash
az staticwebapp create \
  --name faa-search-web \
  --resource-group ML_Resource_Group \
  --source https://github.com/tbaraboi/faa-search-web \
  --location eastus2 \
  --branch main \
  --app-location "/frontend" \
  --api-location "/api" \
  --output-location "dist" \
  --login-with-github
```

#### 3. Configure Application Settings

Add environment variables in Azure Portal → Static Web App → Configuration:

```
AZURE_SEARCH_ENDPOINT=https://faa-ai-search.search.windows.net
AZURE_SEARCH_KEY=<your-key>
AZURE_SEARCH_INDEX=rag-1761849727094
ANTHROPIC_API_KEY=sk-ant-api03-...
```

#### 4. Deploy via GitHub Actions

Azure automatically creates a GitHub Actions workflow. Push to `main` branch to trigger deployment:

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

Monitor deployment in GitHub Actions tab.

#### 5. Access Deployed Application

Your app will be available at:
```
https://faa-search-web.azurestaticapps.net
```

## Usage Guide

### Asking Questions

1. Type your question in the input field at the bottom
2. Click "Ask Question" or press Enter
3. Wait for the AI to search FAA regulations and generate an answer
4. View the answer with source citations

### Example Questions

- "What are the requirements for wing structural certification?"
- "How do I demonstrate compliance with stall speed requirements?"
- "What documents are required for a type certificate application?"
- "What are the flutter certification requirements for transport category aircraft?"

### Viewing Context

Click the "Show Context" button in the header to view the retrieved FAA regulations used to generate answers. This shows the exact text passages from regulations that informed the AI's response.

### Managing Conversations

- **Export**: Download conversation history as text or JSON
- **Clear**: Delete all messages from browser storage
- **Auto-Save**: Conversations are automatically saved to localStorage (max 50 messages)

## API Reference

### POST /api/ask

Ask a question about FAA aircraft certification.

**Request:**
```json
{
  "question": "What are the wing structural certification requirements?"
}
```

**Response:**
```json
{
  "answer": "According to 14 CFR 23.305, wing structures must...",
  "sources": ["14 CFR Part 23", "AC 23-13A"],
  "sourceCount": 3,
  "context": "# Relevant FAA Regulations and Guidance Material\n\n..."
}
```

**Error Response:**
```json
{
  "error": "Failed to retrieve relevant regulations",
  "answer": "",
  "sources": [],
  "sourceCount": 0,
  "context": ""
}
```

## Architecture

### RAG Pipeline

1. **User Question** → Frontend captures input
2. **API Request** → POST to `/api/ask`
3. **Hybrid Search** → Azure AI Search combines:
   - Semantic vector search (embeddings)
   - Keyword search (BM25)
4. **Retrieve Top 3** → Most relevant FAA regulation chunks
5. **Format Context** → Markdown-formatted regulations
6. **Claude API** → Generate answer with system prompt defining FAA expert role
7. **Return Response** → Answer + sources + context
8. **Display** → Frontend renders with citations

### System Prompt

The AI is instructed to act as an FAA certification expert with strict requirements:
- Answer ONLY from provided documents
- Always cite specific regulations
- Distinguish between regulatory requirements and advisory guidance
- Suggest consulting FAA ACO or DER when appropriate

## Cost Considerations

**Expected Monthly Costs** (low-medium traffic):
- Azure Static Web Apps: **Free tier** (100 GB bandwidth/month)
- Azure Functions: **Free tier** (1M executions/month)
- Azure AI Search: **Existing service** (no additional cost)
- Anthropic Claude API: **~$0.01-0.03 per question** (primary cost)

**Total**: $0-10/month for typical usage

## Troubleshooting

### Backend not starting

**Error**: `Port 7071 is unavailable`

**Solution**: Kill existing process
```bash
lsof -ti:7071 | xargs kill -9
```

### Frontend build fails

**Error**: TypeScript type import errors

**Solution**: Ensure all type imports use `import type` syntax
```typescript
import type { Component } from "solid-js";
```

### API calls fail in production

**Check**:
1. Environment variables are set in Azure Static Web App Configuration
2. CORS is configured correctly
3. API keys are valid and have necessary permissions

### LocalStorage quota exceeded

**Solution**: Application auto-prunes to 10 messages when quota is exceeded. Clear browser data or export and clear conversation manually.

## Development Guidelines

### Code Style

- TypeScript strict mode enabled
- Use `import type` for type-only imports
- Prefer functional components in SolidJS
- Keep components small and focused

### Testing

Before committing:
1. Test all example questions
2. Verify source citations
3. Test context toggle
4. Test export functionality
5. Check mobile responsiveness
6. Verify localStorage persistence

### Adding New Features

1. Update types in `frontend/src/types/index.ts` and `api/src/lib/types.ts`
2. Implement backend logic in `api/src/lib/`
3. Update frontend components in `frontend/src/components/`
4. Test locally before deploying
5. Update this README

## Security Notes

- **Never commit** `api/local.settings.json` (gitignored)
- Store API keys in Azure Application Settings, not in code
- Use environment variables for all sensitive configuration
- Review Azure AI Search and Anthropic API access controls regularly

## License

This project is for internal use. Consult with your organization before sharing externally.

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review Azure Functions logs in Azure Portal
3. Check browser console for frontend errors
4. Review Application Insights for production debugging

## Acknowledgments

- Built on Azure AI Search for FAA regulatory document retrieval
- Powered by Anthropic Claude Sonnet 4.5 for intelligent answer generation
- Based on original Python CLI implementation

---

**Last Updated**: January 2026
