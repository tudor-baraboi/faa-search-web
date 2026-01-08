# Aviation Certification RAG Agent - MVP Plan

## Overview

**Product Name:** Aviation Certification Assistant (AI Regulatory Consultant)

**Target Users:** 
- Designated Engineering Representatives (DERs)
- Certification Project Managers (OEMs)
- Aviation Compliance Attorneys
- Maintenance Organization Inspectors

**Value Proposition:** AI-powered certification consultant that provides precise regulatory guidance with verifiable citations, replacing expensive specialist consultations.

---

## Implementation Status (January 2026)

### ✅ Completed

| Feature | Status | Notes |
|---------|--------|-------|
| Query Classifier (LLM-based) | ✅ Done | Claude Sonnet, extracts CFR parts/sections/topics |
| eCFR API Integration | ✅ Done | Live regulatory text from ecfr.gov |
| DRS API Integration | ✅ Done | ACs, TSOs, Orders with PDF extraction |
| Document Caching (Blob Storage) | ✅ Done | 7-day TTL for CFR, 24h for DRS |
| Cache-first Optimization | ✅ Done | Prioritizes cached docs to reduce latency |
| Web UI (React Chat) | ✅ Done | Responsive chat interface |
| Direct Document Requests | ✅ Done | "Show me AC 23-8C" → instant response |
| Multi-source Context | ✅ Done | Combines eCFR + DRS in answers |
| Azure Static Web Apps | ✅ Done | Production deployment |

### 🔄 In Progress / Planned

| Feature | Status | Effort | Notes |
|---------|--------|--------|-------|
| Multi-turn Conversation | 🔄 Planned | ~10h | Session storage, history context |
| Clarifying Questions (Stage 1) | 🔄 Planned | Part of above | Pre-fetch clarity check |
| Narrowing Questions (Stage 2) | 🔄 Planned | Part of above | Post-fetch clarity check |
| Azure OpenAI Migration | ⏸️ Optional | ~2h | Replace Claude for Azure billing |

### ❌ Not in MVP

| Feature | Phase |
|---------|-------|
| Document upload/analysis | Phase 2 |
| Compliance matrix generation | Phase 3 |
| User authentication | Phase 2+ |
| Proactive DRS monitoring | Phase 4 |

---

## What the MVP Does

**"Clarifying RAG Agent with DRS Fallback + Web UI"**

The agent intelligently handles aviation regulatory questions through a multi-step process:

1. User asks aviation regulation question
2. Agent assesses question clarity
3. If vague → asks targeted clarifying questions
4. If clear → searches indexed regulatory content first
5. If indexed content insufficient → automatically fetches from FAA DRS API
6. Returns precise answer with regulation citations

**Key Innovation:** Never hits dead ends - can answer questions about ANY FAA document through DRS API fallback.

---

## Architecture

### Current Implementation (v1 - Single Turn)

```
┌──────────────────┐
│   Web Browser    │ React + Vite chat interface
│   (Frontend)     │
└────────┬─────────┘
         │ HTTP
         ↓
┌─────────────────────────────────────────┐
│   Azure Static Web Apps                 │
│   (Azure Functions Backend)             │
│                                         │
│  ┌────────────────────────────────┐    │
│  │   RAG Pipeline (TypeScript)    │    │
│  │   ┌──────────┐  ┌───────────┐ │    │
│  │   │ Query    │→ │ Parallel  │ │    │
│  │   │Classifier│  │  Fetch    │ │    │
│  │   └──────────┘  └───────────┘ │    │
│  └────────────────────────────────┘    │
│           ↓           ↓                 │
│  ┌─────────────┐  ┌──────────┐        │
│  │eCFR Client  │  │DRS Client│        │
│  │  (module)   │  │ (module) │        │
│  └─────────────┘  └──────────┘        │
│           │            │               │
│  ┌────────────────────────────┐       │
│  │ Azure Blob Storage (cache) │       │
│  │ document-cache container   │       │
│  └────────────────────────────┘       │
└─────────────────────────────────────────┘
         ↓              ↓         
   ┌─────────┐   ┌─────────┐
   │eCFR API │   │DRS API  │
   │(gov.gov)│   │(FAA)    │
   └─────────┘   └─────────┘
         ↓
   ┌─────────┐
   │Claude   │
   │(Anthropic)│
   └─────────┘
```

### Planned Implementation (v2 - Multi-Turn)

```
┌──────────────────┐
│   Web Browser    │ + sessionId tracking
│   (Frontend)     │
└────────┬─────────┘
         │ HTTP + sessionId
         ↓
┌─────────────────────────────────────────┐
│   Azure Static Web Apps                 │
│                                         │
│  ┌────────────────────────────────┐    │
│  │   RAG Pipeline + Conversation  │    │
│  │   ┌──────────┐  ┌───────────┐ │    │
│  │   │  Load    │→ │ Classify  │ │    │
│  │   │ History  │  │(+history) │ │    │
│  │   └──────────┘  └───────────┘ │    │
│  │         ↓            ↓        │    │
│  │   ┌──────────┐  ┌───────────┐ │    │
│  │   │Pre-fetch │  │Post-fetch │ │    │
│  │   │ Clarity  │  │ Clarity   │ │    │
│  │   └──────────┘  └───────────┘ │    │
│  └────────────────────────────────┘    │
│           ↓                            │
│  ┌────────────────────────────┐       │
│  │ Azure Blob Storage         │       │
│  │ - document-cache/          │       │
│  │ - conversations/{id}.json  │       │
│  └────────────────────────────┘       │
└─────────────────────────────────────────┘
```

---

## Technology Stack

### Current Implementation

**Backend (TypeScript - Azure Functions)**
- **Azure Functions v4** - Serverless API
- **Azure Static Web Apps** - Hosting + managed functions
- **Claude (Anthropic)** - LLM for classification + answer generation
- **Azure Blob Storage** - Document and conversation caching
- **eCFR API** - Live regulatory text
- **DRS API** - FAA documents (ACs, ADs, TSOs, Orders)

**Frontend (TypeScript)**
- **React** - UI framework
- **Vite** - Build tool
- **Zustand** - State management
- **Custom chat components**

### Key Dependencies
```
Backend (api/package.json):
- @anthropic-ai/sdk
- @azure/functions
- @azure/storage-blob
- pdf-parse

Frontend (frontend/package.json):
- react
- vite
- zustand
```

### Future Migration Options
- **Azure OpenAI** - Replace Claude for consolidated Azure billing
- **LangGraph** - If complex agent workflows needed
- fastapi
- uvicorn
- azure-search-documents
- pydantic

Frontend:
- react
- vite
- axios
```

---

## Repository Structure

```
aviation-rag-agent/                    # Single monorepo
│
├── backend/
│   ├── .env.example                   # Template for secrets
│   ├── .gitignore
│   ├── requirements.txt
│   ├── README.md
│   │
│   ├── main.py                        # FastAPI application entry point
│   │
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── graph.py                   # LangGraph agent definition
│   │   ├── state.py                   # Agent state schema
│   │   └── nodes.py                   # Agent node functions
│   │
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── rag_tool.py               # Azure AI Search integration
│   │   └── drs_tool.py               # DRS API integration
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py                # Pydantic models for API
│   │
│   ├── config/
│   │   ├── __init__.py
│   │   └── settings.py               # Configuration management
│   │
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_agent.py
│   │   ├── test_rag_tool.py
│   │   └── test_drs_tool.py
│   │
│   └── aviation_agent.db             # SQLite file (created at runtime)
│
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── App.jsx                   # Main application component
│   │   ├── main.jsx                  # Entry point
│   │   │
│   │   ├── components/
│   │   │   ├── ChatInterface.jsx     # Main chat UI
│   │   │   ├── MessageList.jsx       # Message display
│   │   │   ├── InputBox.jsx          # User input field
│   │   │   └── ThinkingIndicator.jsx # Loading state
│   │   │
│   │   └── services/
│   │       └── api.js                # Backend API client
│   │
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   └── setup.md
│
├── scripts/
│   ├── setup_index.py                # Initial Azure AI Search indexing
│   └── test_drs_api.py               # DRS API connectivity test
│
└── README.md                          # Project overview
```

---

## Agent Workflow

### Current Flow (v1 - Single Turn)

```
User Query
    ↓
Quick Document Check (regex)
    ├─→ [Direct doc request: "AC 23-8C"] → Fetch from DRS → Return
    └─→ [Not direct] → Continue
           ↓
Classify Query (Claude)
    ↓
Parallel Fetch (eCFR + DRS)
    ↓
Generate Answer (Claude)
    ↓
Return with citations
```

### Planned Flow (v2 - Multi-Turn with Two-Stage Clarity)

```
User Message
    ↓
Load Conversation History (Blob Storage)
    ↓
Classify Query (with history context)
    ↓
┌─────────────────────────────────────────────────────────┐
│ STAGE 1: Pre-fetch Clarity Check                        │
│                                                         │
│   if (confidence < 0.7 || needsClarification) {        │
│     → Generate clarifying question                      │
│     → Save to history                                   │
│     → Return { isClarifying: true }                    │
│   }                                                     │
└─────────────────────────────────────────────────────────┘
    ↓ (passed Stage 1)
Parallel Fetch (eCFR + DRS)
    ↓
┌─────────────────────────────────────────────────────────┐
│ STAGE 2: Post-fetch Clarity Check                       │
│                                                         │
│   if (totalSources > MAX_SOURCES) {                    │
│     → Generate narrowing question                       │
│     → Save to history                                   │
│     → Return { isClarifying: true }                    │
│   }                                                     │
└─────────────────────────────────────────────────────────┘
    ↓ (passed Stage 2)
Generate Answer (Claude, with history context)
    ↓
Save to history
    ↓
Return { answer, sources, isClarifying: false }
```

### Multi-Turn Conversation Examples

**Example 1: Vague Query → Clarification (Stage 1)**
```
Turn 1:
User: "wing modification requirements"
Classifier: { confidence: 0.5, needsClarification: true }
Agent: "Which certification part applies? (Part 23, 25, 27, or 29)"
       [isClarifying: true]

Turn 2:
User: "Part 23 structural"
Classifier: { confidence: 0.9, cfrParts: [23], topics: ["structural"] }
Agent: "For Part 23 structural modifications, per § 23.2240..."
       [sources: ["14 CFR § 23.2240", "AC 23-8C"]]
```

**Example 2: Broad Query → Narrowing (Stage 2)**
```
Turn 1:
User: "Part 23 flight characteristics requirements"
Classifier: { confidence: 0.85, cfrParts: [23] }
Fetch: Returns 15 CFR sections
Agent: "I found 15 sections on Part 23 flight characteristics. 
        Which area are you interested in?
        - Stall speed/characteristics
        - Takeoff/landing performance
        - Controllability/stability"
       [isClarifying: true]

Turn 2:
User: "stall characteristics"
Agent: "Per § 23.2150, stall characteristics must..."
       [sources: ["14 CFR § 23.2150"]]
```

**Example 3: Follow-up Questions**
```
Turn 1:
User: "What are stall speed requirements for Part 23?"
Agent: "Per § 23.2150, stall speed..." [sources: § 23.2150]

Turn 2:
User: "What about Part 25?"
Classifier sees history → { cfrParts: [25], topics: ["stall_speed"] }
Agent: "For Part 25, stall speed is defined in § 25.103..."

Turn 3:
User: "Which AC covers flight testing for this?"
Classifier sees history → knows "this" = Part 25 stall speed
Agent: "AC 25-7D covers flight test procedures including stall testing..."
```

---

## Multi-Turn Conversation Implementation

### Conversation Storage

Conversations stored in Azure Blob Storage with 7-day TTL:

```
document-cache/
  conversations/
    {sessionId}.json
```

### Data Schema

```typescript
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    classification?: QueryClassification;
    sources?: string[];
    isClarifying?: boolean;
  };
}

interface Conversation {
  sessionId: string;
  messages: Message[];
  createdAt: string;
  lastActivity: string;
}
```

### Enhanced Classifier Schema

```typescript
interface QueryClassification {
  // Existing fields
  intent: 'regulatory_lookup' | 'compliance_guidance' | 'document_request' | 'general_question';
  topics: string[];
  cfrParts: number[];
  cfrSections: string[];
  documentTypes: ('AC' | 'AD' | 'TSO' | 'Order')[];
  confidence: number;
  
  // New fields for clarification
  needsClarification: boolean;
  missingInfo?: ('part' | 'section' | 'docType' | 'context')[];
  clarifyingQuestion?: string;
}
```

### API Changes

```typescript
// Request
POST /api/ask
{
  question: string;
  sessionId?: string;  // Omit for new conversation
}

// Response
{
  answer: string;
  sources: string[];
  sourceCount: number;
  sessionId: string;      // Always returned
  isClarifying: boolean;  // True if agent is asking a question
  ecfrUsed?: boolean;
  cfrSources?: CFRSource[];
}
```

### Two-Stage Clarity Check Implementation

```typescript
const MIN_CONFIDENCE = 0.7;
const MAX_SOURCES = 8;

async function askQuestion(question: string, sessionId?: string) {
  // Load or create conversation
  const conversation = sessionId 
    ? await loadConversation(sessionId)
    : createConversation();
  
  // Add user message to history
  conversation.messages.push({ role: 'user', content: question, timestamp: now() });
  
  // Classify with history context
  const history = formatHistoryForClassifier(conversation.messages);
  const classification = await classifyQuery(question, history);
  
  // STAGE 1: Pre-fetch clarity check
  if (classification.confidence < MIN_CONFIDENCE || classification.needsClarification) {
    const clarifyingQuestion = classification.clarifyingQuestion 
      || generateClarifyingQuestion(classification.missingInfo);
    
    conversation.messages.push({ 
      role: 'assistant', 
      content: clarifyingQuestion,
      metadata: { isClarifying: true }
    });
    await saveConversation(conversation);
    
    return { answer: clarifyingQuestion, isClarifying: true, sessionId: conversation.sessionId };
  }
  
  // Fetch sources
  const [ecfrDocs, drsDocs] = await Promise.all([
    fetchFromECFR(classification),
    fetchFromDRS(question, classification)
  ]);
  const totalSources = ecfrDocs.length + drsDocs.length;
  
  // STAGE 2: Post-fetch clarity check
  if (totalSources > MAX_SOURCES) {
    const narrowingQuestion = generateNarrowingQuestion(classification.topics, ecfrDocs);
    
    conversation.messages.push({
      role: 'assistant',
      content: narrowingQuestion,
      metadata: { isClarifying: true }
    });
    await saveConversation(conversation);
    
    return { answer: narrowingQuestion, isClarifying: true, sessionId: conversation.sessionId };
  }
  
  // Generate answer with history context
  const answer = await generateAnswer(question, ecfrDocs, drsDocs, conversation.messages);
  
  conversation.messages.push({
    role: 'assistant',
    content: answer,
    metadata: { sources: [...], isClarifying: false }
  });
  await saveConversation(conversation);
  
  return { answer, sources: [...], isClarifying: false, sessionId: conversation.sessionId };
}
```

### Conversation TTL (7 days)

```typescript
async function loadConversation(sessionId: string): Promise<Conversation | null> {
  const conversation = await blobStorage.get(`conversations/${sessionId}.json`);
  
  if (!conversation) return null;
  
  // Check TTL
  const age = Date.now() - new Date(conversation.lastActivity).getTime();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  if (age > maxAge) {
    await blobStorage.delete(`conversations/${sessionId}.json`);
    return null;
  }
  
  return conversation;
}
```

### Frontend Changes

```typescript
// Store sessionId in localStorage
const [sessionId, setSessionId] = useState<string | null>(
  localStorage.getItem('faa-session-id')
);

// Send with requests
const response = await api.ask(question, sessionId);
setSessionId(response.sessionId);
localStorage.setItem('faa-session-id', response.sessionId);

// New conversation button
function startNewConversation() {
  localStorage.removeItem('faa-session-id');
  setSessionId(null);
  clearMessages();
}
```

### Implementation Estimate

| Component | Effort |
|-----------|--------|
| Conversation storage (Blob) | 1 hour |
| API changes (sessionId) | 1 hour |
| Classifier enhancement | 2 hours |
| Two-stage clarity logic | 2 hours |
| Frontend session handling | 2 hours |
| Testing & edge cases | 2 hours |
| **Total** | **~10 hours** |

---

## Query Classifier & eCFR Integration

### Overview

The Query Classifier is an LLM-based component that analyzes user questions to intelligently route them to the appropriate data sources. It leverages Claude's training knowledge of FAA regulations to map natural language queries to specific CFR parts and sections.

### Why a Classifier?

| Problem | Without Classifier | With Classifier |
|---------|-------------------|-----------------|
| "stall speed requirements" | Generic search, may miss § 23.2150 | Routes to Part 23, fetches § 23.2150 |
| "how do I certify a propeller?" | Searches indexed docs only | Fetches Part 35 + Part 21 from eCFR |
| "AC 43.13-1B maintenance" | Might find it, might not | Direct DRS fetch by document number |

### Classifier Architecture

```
User Query: "How do I demonstrate stall speed compliance?"
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QUERY CLASSIFIER                                    │
│                                                                             │
│  Claude API Call with Structured Output:                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ System: "You are an FAA regulatory classifier. Given a question,   │   │
│  │          identify relevant 14 CFR parts, sections, and document    │   │
│  │          types. Use your knowledge of aviation regulations."       │   │
│  │                                                                     │   │
│  │ User: "How do I demonstrate stall speed compliance?"               │   │
│  │                                                                     │   │
│  │ Output:                                                             │   │
│  │ {                                                                   │   │
│  │   "intent": "compliance_guidance",                                  │   │
│  │   "topics": ["stall_speed", "flight_characteristics"],              │   │
│  │   "cfrParts": [23],                                                 │   │
│  │   "cfrSections": ["23.2150", "23.2100"],                           │   │
│  │   "documentTypes": ["AC"],                                          │   │
│  │   "confidence": 0.92                                                │   │
│  │ }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Route to Data Sources
```

### How Claude Knows CFR Mappings

Claude's training data includes:
- **14 CFR full text** (public law, widely available)
- **FAA Advisory Circulars** (published guidance)
- **Aviation regulatory literature** (textbooks, legal analysis)

This enables Claude to accurately map:
- "stall speed" → § 23.2150 (Stall speed)
- "propeller certification" → Part 35 + Part 21
- "engine fire protection" → Part 25 Subpart E
- "maintenance requirements" → Part 43

**Important:** Claude does NOT reliably know:
- DRS document GUIDs (runtime data)
- Current AC version numbers (use DRS to validate)
- Whether a specific document is in your index

### Classification Output Schema

```typescript
interface QueryClassification {
  // Query intent
  intent: 'regulatory_lookup' | 'compliance_guidance' | 'document_request' | 'general_question';
  
  // Detected aviation topics
  topics: string[];  // e.g., ["stall_speed", "flight_characteristics"]
  
  // CFR routing (for eCFR API)
  cfrParts: number[];        // e.g., [23, 25]
  cfrSections: string[];     // e.g., ["23.2150", "23.2100"]
  
  // Document routing (for DRS API)
  documentTypes: ('AC' | 'AD' | 'TSO' | 'Order')[];
  specificDocument?: string;  // e.g., "AC 43.13-1B" if explicitly mentioned
  
  // Confidence and reasoning
  confidence: number;  // 0-1 scale
  reasoning: string;   // Explanation for debugging
}
```

### Classifier Implementation

```typescript
// api/src/lib/queryClassifier.ts

export async function classifyQuery(
  question: string,
  anthropic: Anthropic
): Promise<QueryClassification> {
  
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: `You are an FAA regulatory classification expert. Analyze aviation questions and identify:
1. The user's intent (regulatory lookup, compliance guidance, document request, or general)
2. Relevant 14 CFR Part numbers (21, 23, 25, 27, 29, 33, 35, 39, 43, 91, 121, 135)
3. Specific CFR section numbers if determinable
4. Related document types (AC, AD, TSO, Order)

Common CFR mappings:
- Part 21: Certification procedures (type certificates, production approvals)
- Part 23: Normal category airplanes (23.2xxx = performance & flight characteristics)
- Part 25: Transport category airplanes
- Part 27/29: Rotorcraft (normal/transport)
- Part 33: Aircraft engines
- Part 35: Propellers
- Part 39: Airworthiness directives
- Part 43: Maintenance, preventive maintenance, alterations
- Part 91: General operating rules

Respond ONLY with valid JSON matching the schema.`,
    messages: [{
      role: "user",
      content: `Classify this aviation regulatory question:

"${question}"

Respond with JSON:
{
  "intent": "regulatory_lookup|compliance_guidance|document_request|general_question",
  "topics": ["topic1", "topic2"],
  "cfrParts": [number],
  "cfrSections": ["section.number"],
  "documentTypes": ["AC"|"AD"|"TSO"|"Order"],
  "specificDocument": "if mentioned",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`
    }]
  });
  
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }
  
  return JSON.parse(content.text);
}
```

### eCFR Integration

The eCFR API provides authoritative CFR text on-demand (no indexing required):

```typescript
// api/src/lib/ecfrClient.ts

export class ECFRClient {
  private baseURL = 'https://www.ecfr.gov/api/versioner/v1';
  
  /**
   * Fetch a specific CFR section
   * @param title - CFR title (14 for aviation)
   * @param part - Part number (23, 25, etc.)
   * @param section - Section number (2150, etc.)
   */
  async fetchSection(title: number, part: number, section: string): Promise<ECFRSection> {
    const date = new Date().toISOString().split('T')[0]; // Current date
    const url = `${this.baseURL}/full/${date}/title-${title}.json?part=${part}&section=${part}.${section}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`eCFR API error: ${response.status}`);
    }
    
    return response.json();
  }
  
  /**
   * Fetch all section titles for a part (for discovery)
   */
  async getSectionTitles(title: number, part: number): Promise<SectionTitle[]> {
    const url = `${this.baseURL}/structure/${new Date().toISOString().split('T')[0]}/title-${title}.json?part=${part}`;
    // Parse structure to extract section numbers and titles
    // ...
  }
}
```

### Enhanced RAG Pipeline Flow

```
User Query: "stall speed compliance"
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Step 1: CLASSIFY QUERY                                            │
│   → { cfrParts: [23], cfrSections: ["23.2150"], intent: "..." }  │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Step 2: PARALLEL SOURCE FETCH                                     │
│                                                                   │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│   │Azure Search │  │ eCFR API    │  │ DRS API     │              │
│   │(indexed)    │  │(§ 23.2150)  │  │(search ACs) │              │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│          │                │                │                      │
│          └────────────────┴────────────────┘                      │
│                           │                                       │
│                    Combined Context                               │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Step 3: VALIDATE & FILTER                                         │
│   - eCFR returned 404? → Remove from context                     │
│   - DRS found no ACs? → Continue with CFR only                   │
│   - Deduplicate overlapping content                              │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Step 4: CLAUDE SYNTHESIS                                          │
│   Enhanced system prompt:                                         │
│   "Cite CFR sections for legal requirements.                     │
│    Cite ACs for acceptable means of compliance.                  │
│    Distinguish between MUST (regulatory) and MAY (guidance)."    │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Step 5: RESPONSE                                                  │
│   {                                                               │
│     answer: "Per § 23.2150, stall speed must not exceed...       │
│              AC 23.2150-1 provides acceptable methods...",       │
│     sources: ["14 CFR § 23.2150", "AC 23.2150-1"],              │
│     cfrSources: ["§ 23.2150"],                                   │
│     acSources: ["AC 23.2150-1"],                                 │
│     ecfrUsed: true,                                              │
│     fallbackUsed: true                                           │
│   }                                                               │
└───────────────────────────────────────────────────────────────────┘
```

### Query Flow Examples

**Example 1: General Compliance Question**
```
Query: "How do I demonstrate stall speed compliance?"

Classifier Output:
{
  "intent": "compliance_guidance",
  "topics": ["stall_speed", "flight_test"],
  "cfrParts": [23],
  "cfrSections": ["23.2150"],
  "documentTypes": ["AC"],
  "confidence": 0.92,
  "reasoning": "Stall speed requirements for normal category aircraft are in § 23.2150"
}

Actions:
1. eCFR → Fetch § 23.2150 full text
2. DRS → Search "stall speed" → Find AC 23.2150-1
3. Azure Search → Additional context (if any)

Result: Complete answer with legal requirement + compliance method
```

**Example 2: Specific Document Request**
```
Query: "What does AC 43.13-1B say about propeller inspection?"

Classifier Output:
{
  "intent": "document_request",
  "topics": ["propeller", "inspection", "maintenance"],
  "cfrParts": [43, 35],
  "cfrSections": [],
  "documentTypes": ["AC"],
  "specificDocument": "AC 43.13-1B",
  "confidence": 0.98,
  "reasoning": "User explicitly requested AC 43.13-1B"
}

Actions:
1. DRS → Fetch AC 43.13-1B directly (skip search)
2. eCFR → Skip (AC requested, not CFR)
3. Azure Search → Skip (specific doc requested)

Result: Answer from specific AC with propeller inspection guidance
```

**Example 3: Regulatory Lookup**
```
Query: "What are the engine fire protection requirements for Part 25?"

Classifier Output:
{
  "intent": "regulatory_lookup",
  "topics": ["engine", "fire_protection", "powerplant"],
  "cfrParts": [25],
  "cfrSections": ["25.1181", "25.1182", "25.1183", "25.1185", "25.1187"],
  "documentTypes": ["AC"],
  "confidence": 0.88,
  "reasoning": "Engine fire protection is in Part 25 Subpart E, §§ 25.1181-1207"
}

Actions:
1. eCFR → Fetch §§ 25.1181-1187 (fire protection sections)
2. DRS → Search "engine fire protection" ACs
3. Azure Search → Additional context

Result: Complete fire protection requirements with applicable guidance
```

### Latency Considerations

| Component | Latency | Notes |
|-----------|---------|-------|
| Classifier (Claude) | ~400ms | Single API call with small output |
| eCFR API | ~200-400ms | Per section fetch |
| DRS API | ~500-1000ms | Search + PDF download + parse |
| Azure Search | ~50ms | Already optimized |

**Total with classifier:** ~1.5-2.5s (acceptable for regulatory queries)

**Optimization strategies:**
1. Cache frequently accessed CFR sections (24hr TTL)
2. Parallel fetch from eCFR/DRS/Azure
3. Use regex pre-filter before classifier for obvious patterns (e.g., "AC 43.13-1B")

### Classifier Reliability

| Scenario | Mitigation |
|----------|------------|
| Claude suggests wrong CFR section | eCFR returns 404 → graceful fallback to search |
| Claude hallucinates AC number | DRS search validates existence |
| Low confidence classification | Fall back to existing search-only flow |
| eCFR API down | Use Azure Search + DRS only |

### Caching Strategy

To reduce latency and external API dependency, cache fetched documents in Azure Blob Storage.

#### Why Blob Storage?

| Factor | Blob Storage | Alternatives |
|--------|--------------|--------------|
| **Cost** | ~$0.02/GB/month | Redis: ~$15+/month |
| **Persistence** | ✅ Survives cold starts | In-memory: ❌ Lost |
| **Latency** | ~50-100ms read | Redis: ~5ms (overkill) |
| **Already provisioned** | ✅ Azure Functions requires Storage Account | Redis: New resource |
| **Document size** | ✅ Handles 50KB+ docs | Table Storage: 64KB limit |

#### What to Cache

| Content | Cache Key | TTL | Size |
|---------|-----------|-----|------|
| CFR sections | `cfr/14/{part}/{section}.json` | 7 days | ~5-20KB |
| DRS documents | `drs/{docType}/{docNumber}.json` | 24 hours | ~20-100KB |
| Classifier results | `classifier/{queryHash}.json` | 1 hour | ~1KB |

#### Cache Implementation

```typescript
// api/src/lib/documentCache.ts

import { BlobServiceClient } from "@azure/storage-blob";
import { createHash } from "crypto";

export class DocumentCache {
  private containerClient;
  
  constructor() {
    const connectionString = process.env.AzureWebJobsStorage; // Already exists!
    const blobService = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = blobService.getContainerClient("document-cache");
  }
  
  /**
   * Get cached document
   */
  async get<T>(key: string): Promise<{ data: T; cachedAt: Date } | null> {
    try {
      const blobClient = this.containerClient.getBlobClient(key);
      const props = await blobClient.getProperties();
      
      // Check TTL based on metadata
      const cachedAt = props.metadata?.cachedat 
        ? new Date(props.metadata.cachedat) 
        : props.lastModified;
      const ttlHours = parseInt(props.metadata?.ttlhours || "24");
      
      if (Date.now() - cachedAt.getTime() > ttlHours * 3600000) {
        return null; // Expired
      }
      
      const download = await blobClient.download();
      const text = await streamToString(download.readableStreamBody);
      return { data: JSON.parse(text), cachedAt };
    } catch (error) {
      return null; // Cache miss
    }
  }
  
  /**
   * Store document in cache
   */
  async set(key: string, data: any, ttlHours: number = 24): Promise<void> {
    const blobClient = this.containerClient.getBlockBlobClient(key);
    const content = JSON.stringify(data);
    
    await blobClient.upload(content, content.length, {
      metadata: {
        cachedat: new Date().toISOString(),
        ttlhours: ttlHours.toString()
      },
      blobHTTPHeaders: { blobContentType: "application/json" }
    });
  }
  
  /**
   * Cache key generators
   */
  static cfrKey(part: number, section: string): string {
    return `cfr/14/${part}/${section}.json`;
  }
  
  static drsKey(docType: string, docNumber: string): string {
    return `drs/${docType}/${docNumber.replace(/\s+/g, '-')}.json`;
  }
  
  static classifierKey(query: string): string {
    const hash = createHash('sha256').update(query.toLowerCase().trim()).digest('hex').slice(0, 16);
    return `classifier/${hash}.json`;
  }
}

async function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
```

#### Cached Fetch Pattern

```typescript
// In ecfrClient.ts
async fetchSection(part: number, section: string): Promise<ECFRSection> {
  const cache = new DocumentCache();
  const key = DocumentCache.cfrKey(part, section);
  
  // Try cache first
  const cached = await cache.get<ECFRSection>(key);
  if (cached) {
    console.log(`📦 Cache hit: ${key}`);
    return cached.data;
  }
  
  // Fetch from eCFR
  console.log(`🌐 Fetching from eCFR: §${part}.${section}`);
  const data = await this.fetchFromAPI(part, section);
  
  // Store in cache (7 day TTL for CFRs - they rarely change)
  await cache.set(key, data, 168); // 168 hours = 7 days
  
  return data;
}
```

#### Cache Flow Diagram

```
Query: "stall speed compliance"
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Check Classifier Cache                                            │
│   Key: classifier/{hash}.json                                     │
│   Hit? → Use cached classification                               │
│   Miss? → Call Claude, cache result (1 hour TTL)                 │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Parallel Fetch with Cache                                         │
│                                                                   │
│   eCFR § 23.2150:                                                │
│     Cache key: cfr/14/23/2150.json                               │
│     Hit? → 50ms (blob read)                                      │
│     Miss? → 300ms (API) + cache for 7 days                       │
│                                                                   │
│   DRS AC 23.2150-1:                                              │
│     Cache key: drs/AC/23.2150-1.json                             │
│     Hit? → 50ms (blob read)                                      │
│     Miss? → 1000ms (API + PDF) + cache for 24 hours              │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
              Generate Answer
```

#### Cache Invalidation

| Strategy | When to Use |
|----------|-------------|
| **TTL-based** (default) | CFRs (7 days), DRS docs (24 hours), Classifier (1 hour) |
| **Manual purge** | When you know a regulation changed |
| **Version prefix** | Add `v1/`, `v2/` to keys for cache busting |

#### Setup Required

1. **Create container** (one-time, or auto-create in code):
   ```bash
   az storage container create --name document-cache --account-name <your-storage>
   ```

2. **No new secrets needed** — uses `BLOB_STORAGE_CONNECTION_STRING` (or `AzureWebJobsStorage` locally)

#### ⚠️ Azure Functions Deployment Troubleshooting

**CRITICAL:** The deployment pipeline requires specific Azure configuration to work properly.

**Required GitHub Secrets:**
- `AZURE_STATIC_WEB_APPS_API_TOKEN_GRAY_WAVE_06AC23C1E` - For SWA frontend deployment
- `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` - For Function App API deployment

**To get/update the publish profile:**
```bash
az functionapp deployment list-publishing-profiles \
  --name faa-search-api \
  --resource-group ML_Resource_Group \
  --xml > publish-profile.xml

gh secret set AZURE_FUNCTIONAPP_PUBLISH_PROFILE < publish-profile.xml
```

**Required Azure Function App Settings:**
1. **Disable EasyAuth** - EasyAuth on the Function App blocks GitHub Actions deployment:
   ```bash
   az rest --method PUT --url "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Web/sites/<app>/config/authsettingsV2?api-version=2022-03-01" --body '{"properties":{"platform":{"enabled":false}}}'
   ```

2. **Enable basic auth for SCM** (required for publish profile):
   ```bash
   az resource update --ids /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Web/sites/<app>/basicPublishingCredentialsPolicies/scm --set properties.allow=true
   ```

3. **Remove WEBSITE_RUN_FROM_PACKAGE** if set to a URL (conflicts with zip deploy):
   ```bash
   az functionapp config appsettings delete --name <app> --resource-group <rg> --setting-names WEBSITE_RUN_FROM_PACKAGE
   ```

**How to manually trigger deployment:**
```bash
gh workflow run "Deploy Azure Functions API" --repo <owner>/<repo>
```

#### ⚠️ Production Caching Verification Checklist

**CRITICAL:** Always verify caching is working in production after deployment. The cache significantly improves response quality and latency.

| Step | Command | Expected |
|------|---------|----------|
| 1. Check env var name | Code uses `BLOB_STORAGE_CONNECTION_STRING` | NOT `AZURE_STORAGE_CONNECTION_STRING` |
| 2. Verify Function App setting | `az functionapp config appsettings list --name <app> --resource-group <rg> \| jq '.[] \| select(.name=="BLOB_STORAGE_CONNECTION_STRING")'` | Connection string present |
| 3. Health check | `curl https://<app-url>/api/health \| jq '.hasBlobStorage'` | `true` |
| 4. Verify cache container exists | `az storage blob list --account-name <storage> --container-name document-cache --output table` | Shows cached documents |

**Common Issues:**
- Wrong env var name (`AZURE_STORAGE_CONNECTION_STRING` vs `BLOB_STORAGE_CONNECTION_STRING`)
- Missing connection string in Function App settings
- Need to restart Function App after setting env vars: `az functionapp restart --name <app> --resource-group <rg>`

### CFR→Document Mapping Enhancement

The Query Classifier identifies CFR parts/sections from user queries. This enhancement automatically searches DRS for related documents (ACs, ADs, TSOs, Orders) based on those CFR references, ensuring Claude has both the regulatory requirements AND compliance guidance in context.

#### Why This Matters

| Source | Content Type | Example |
|--------|-------------|---------|
| eCFR | Legal requirement (MUST) | "Stall speed may not exceed 61 knots..." |
| AC | Acceptable means of compliance (MAY) | "Flight test procedures for demonstrating..." |
| AD | Mandatory safety action | "Replace fuel line fitting within 500 hours..." |
| TSO | Equipment standard | "Minimum performance standard for..." |

Without this mapping, users get only the CFR text. With it, they get the complete picture: requirement + how to comply.

#### Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `DRS_MAX_CFR_QUERIES` | 3 | Max CFR-based search queries (sections prioritized over parts) |
| `DRS_MAX_DOC_TYPES` | 2 | Max document types to search from classifier output |
| `DRS_MAX_RESULTS_PER_SEARCH` | 1 | Top N results fetched per DRS search |
| `DRS_MAX_TOTAL_DOCUMENTS` | 4 | Hard cap on total documents fetched per request |

#### Flow

```
User: "What are the stall speed requirements for Part 23?"
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Query Classifier                                                  │
│   cfrParts: [23]                                                  │
│   cfrSections: ["23.2150"]                                        │
│   documentTypes: ["AC", "AD"]                                     │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Build CFR Search Queries                                          │
│   ["23.2150", "Part 23"]  (max DRS_MAX_CFR_QUERIES)              │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Parallel Fetch                                                    │
│                                                                   │
│   eCFR:                                                          │
│     └── § 23.2150 (stall speed text)                             │
│                                                                   │
│   DRS (for each query × each docType):                           │
│     ├── "23.2150" in AC → AC 23.2150-1                           │
│     ├── "23.2150" in AD → (none found)                           │
│     ├── "Part 23" in AC → AC 23-8C                               │
│     └── "Part 23" in AD → (none found)                           │
│                                                                   │
│   Deduplicate + cap at DRS_MAX_TOTAL_DOCUMENTS                   │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ Claude Synthesis                                                  │
│   Context: eCFR § 23.2150 + AC 23.2150-1 + AC 23-8C              │
│   → Complete answer with requirement + compliance methods        │
└───────────────────────────────────────────────────────────────────┘
```

#### Implementation Details

```typescript
// api/src/lib/ragPipeline.ts

// Configurable limits
const DRS_CONFIG = {
  maxCfrQueries: parseInt(process.env.DRS_MAX_CFR_QUERIES || '3'),
  maxDocTypes: parseInt(process.env.DRS_MAX_DOC_TYPES || '2'),
  maxResultsPerSearch: parseInt(process.env.DRS_MAX_RESULTS_PER_SEARCH || '1'),
  maxTotalDocuments: parseInt(process.env.DRS_MAX_TOTAL_DOCUMENTS || '4'),
};

// Build search queries from CFR classification (sections first, then parts)
function buildCFRSearchQueries(classification: QueryClassification): string[] {
  const queries: string[] = [];
  
  // Sections are most specific (e.g., "23.2150")
  for (const section of classification.cfrSections) {
    if (queries.length >= DRS_CONFIG.maxCfrQueries) break;
    queries.push(section);
  }
  
  // Parts are broader (e.g., "Part 23")
  for (const part of classification.cfrParts) {
    if (queries.length >= DRS_CONFIG.maxCfrQueries) break;
    queries.push(`Part ${part}`);
  }
  
  return queries;
}
```

#### Rate Limiting Analysis

| Scenario | DRS Searches | Document Downloads |
|----------|--------------|-------------------|
| Simple query (1 section, 1 type) | 1 | 1 |
| Typical query (2 sections, 2 types) | 4 | 2-4 |
| Complex query (3 queries, 2 types) | 6 | 4 (capped) |
| Worst case with defaults | 6 | 4 (capped) |

**Latency impact:** +200-400ms for searches (parallel), +1-3s for uncached downloads (cached: ~50ms)

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/queryClassifier.ts` | CREATE | LLM-based query classification |
| `api/src/lib/ecfrClient.ts` | CREATE | eCFR API client |
| `api/src/lib/documentCache.ts` | CREATE | Blob Storage cache client |
| `api/src/lib/types.ts` | UPDATE | Add QueryClassification, ECFRSection types |
| `api/src/lib/ragPipeline.ts` | UPDATE | Integrate classifier + parallel fetch |
| `api/src/lib/searchEvaluator.ts` | UPDATE | Use classification for smarter routing |
| `api/src/lib/drsClient.ts` | UPDATE | Add cache-first fetch |
| `frontend/src/components/SourceList.tsx` | UPDATE | Display CFR vs AC source badges |

### Azure Search Index Decommission Plan

After implementing the Query Classifier, eCFR Integration, Caching, and Smart DRS Search, the Azure AI Search index can be decommissioned to eliminate the ~$70-250/month cost.

#### Prerequisites

All 4 components must be implemented and tested:

| Component | Status | Description |
|-----------|--------|-------------|
| 1. Query Classifier | ⬜ TODO | Routes queries to CFR parts/sections |
| 2. eCFR Client | ⬜ TODO | Fetches regulations on-demand |
| 3. Blob Cache | ⬜ TODO | Reduces latency for repeat queries |
| 4. Smart DRS Routing | ⬜ TODO | Uses classifier output for targeted AC search |

#### Architecture Comparison

```
BEFORE (with Azure Search):                    AFTER (classifier + on-demand):
┌─────────────────────────────┐               ┌─────────────────────────────┐
│ Query                       │               │ Query                       │
│   ↓                         │               │   ↓                         │
│ Azure Search ($70-250/mo)   │               │ Classifier (Claude)         │
│   ↓                         │               │   ↓                         │
│ Score check                 │               │ Cache check (Blob Storage)  │
│   ↓                         │               │   ↓                         │
│ DRS fallback (if needed)    │               │ eCFR + DRS (parallel)       │
│   ↓                         │               │   ↓                         │
│ Claude                      │               │ Claude                      │
└─────────────────────────────┘               └─────────────────────────────┘
      ~$100/mo fixed                                ~$0.01/query variable
```

#### Transition Timeline

| Week | Phase | Actions |
|------|-------|---------|
| 1-2 | **Build** | Implement classifier, eCFR client, cache, update pipeline |
| 3 | **Parallel Run** | Deploy with BOTH paths enabled; index as fallback |
| 4 | **Validate** | Run 50+ real queries; compare classifier vs index results |
| 5 | **Soft Disable** | Set `USE_AZURE_SEARCH=false` in config; keep resource |
| 6 | **Monitor** | Watch for errors, user complaints, accuracy issues |
| 7+ | **Decommission** | Delete Azure AI Search resource if stable |

#### Validation Checklist

Before disabling the index:

| Check | Target | How to Verify |
|-------|--------|---------------|
| Classifier accuracy | >95% correct CFR mapping | Test with 50+ real queries |
| eCFR coverage | All Part 21-43 accessible | Automated API smoke tests |
| Cache hit rate | >60% after warm-up | Monitor blob access logs |
| Response quality | No degradation | A/B compare with index path |
| Latency | <3s p95 | Monitor function execution time |
| Error rate | <1% | Check function failure logs |

#### Rollback Plan

If issues arise after disabling the index:

```typescript
// api/src/lib/ragPipeline.ts - Feature flag for quick rollback

const USE_AZURE_SEARCH = process.env.USE_AZURE_SEARCH !== 'false'; // Default: true

async askQuestion(question: string): Promise<RAGResponse> {
  if (USE_AZURE_SEARCH) {
    // Legacy path: Azure Search + DRS fallback
    return this.askWithAzureSearch(question);
  } else {
    // New path: Classifier + eCFR + DRS
    return this.askWithClassifier(question);
  }
}
```

To rollback: Set `USE_AZURE_SEARCH=true` in Azure Static Web App configuration.

#### What You Keep vs Lose

| Keep | Lose |
|------|------|
| ✅ Full CFR coverage (eCFR) | ❌ Semantic search over custom docs |
| ✅ Always-current regulations | ❌ Sub-100ms first response |
| ✅ ~$100/mo cost savings | ❌ Offline capability |
| ✅ Simpler architecture | ❌ Any custom indexed content |

#### Final Decommission Steps

Once validated (Week 7+):

```bash
# 1. Verify no custom content in index you want to keep
az search index show --name <index-name> --service-name <search-service>

# 2. Export index definition (backup)
az search index show --name <index-name> --service-name <search-service> > index-backup.json

# 3. Delete the search service
az search service delete --name <search-service> --resource-group <rg-name>

# 4. Remove from code
# - Delete api/src/lib/azureSearch.ts
# - Remove AZURE_SEARCH_* env vars from configuration
# - Update ragPipeline.ts to remove index path
```

#### Cost Impact

| Resource | Before | After |
|----------|--------|-------|
| Azure AI Search (Basic) | ~$70-250/mo | $0 |
| Blob Storage (cache) | ~$0 | ~$1-5/mo |
| Claude API (classifier) | ~$X | ~$X + $5-20/mo |
| **Net Savings** | — | **~$50-230/mo** |

---

## Step 5: Multi-Turn Orchestrator Microservice

After implementing Steps 1-4 (Classifier, eCFR, Cache, Smart DRS), add multi-turn conversation support as a separate orchestrator microservice using LangGraph.

### Why a Separate Microservice?

| Concern | Tool Layer (Azure Functions) | Orchestrator (LangGraph) |
|---------|------------------------------|--------------------------|
| **State** | Stateless | Stateful (session, history) |
| **Language** | TypeScript | Python (LangGraph native) |
| **Scaling** | Per-invocation | Per-session |
| **Responsibility** | Execute operations | Manage conversation flow |

### Architecture: Orchestrator + Tools

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                       │
│                         (React / Static Web App)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR MICROSERVICE (NEW)                          │
│                    Azure Container App (Python/LangGraph)                   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  LangGraph Agent                                                     │  │
│   │  - Session state (PostgreSQL / Cosmos DB)                           │  │
│   │  - Conversation history                                              │  │
│   │  - Clarity check & clarification flow                               │  │
│   │  - Multi-turn context accumulation                                  │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                         │           │           │                          │
│                    Tool Calls (HTTP)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                         │           │           │
          ┌──────────────┘           │           └──────────────┐
          ▼                          ▼                          ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  /api/classify   │    │  /api/search     │    │  /api/answer     │
│  (Step 1)        │    │  (Steps 2-4)     │    │  (Claude)        │
│                  │    │                  │    │                  │
│  Azure Function  │    │  Azure Function  │    │  Azure Function  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
         │                       │
         │              ┌────────┴────────┐
         ▼              ▼                 ▼
   ┌──────────┐   ┌──────────┐     ┌──────────┐
   │  Claude  │   │  eCFR    │     │  DRS     │
   │  (class) │   │  + Cache │     │  + Cache │
   └──────────┘   └──────────┘     └──────────┘
```

### LangGraph Agent Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LANGGRAPH AGENT FLOW                                 │
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │   START      │────▶│   CLASSIFY   │────▶│   CLARITY    │                │
│  │              │     │   (tool)     │     │   CHECK      │                │
│  └──────────────┘     └──────────────┘     └──────┬───────┘                │
│                                                   │                         │
│                              ┌────────────────────┴────────────────────┐   │
│                              │                                         │   │
│                      [score < 0.6]                              [score ≥ 0.6]
│                              │                                         │   │
│                              ▼                                         ▼   │
│                     ┌──────────────┐                          ┌──────────────┐
│                     │  CLARIFY     │                          │   SEARCH     │
│                     │  (ask user)  │                          │   (tool)     │
│                     └──────┬───────┘                          └──────┬───────┘
│                            │                                         │        │
│                            │ END (wait)                              │        │
│                            ▼                                         ▼        │
│                     ┌──────────────┐                          ┌──────────────┐
│                     │  User sends  │                          │   ANSWER     │
│                     │  follow-up   │─────────────────────────▶│   (tool)     │
│                     └──────────────┘                          └──────────────┘
│                                                                       │        │
│                                                                       ▼        │
│                                                                ┌──────────────┐
│                                                                │    END       │
│                                                                └──────────────┘
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Contract: Orchestrator → Tools

The orchestrator calls existing Azure Functions as HTTP tools:

```python
# Tool 1: Classify (Step 1)
POST /api/classify
Request:  { "question": "wing modification requirements" }
Response: { 
  "cfrParts": [23, 25], 
  "cfrSections": ["23.2240", "23.2245"], 
  "topics": ["wing", "structural"],
  "documentTypes": ["AC"],
  "confidence": 0.85
}

# Tool 2: Search (Steps 2-4: eCFR + DRS + Cache)
POST /api/search
Request:  { 
  "cfrSections": ["23.2240"], 
  "topics": ["wing", "structural"], 
  "docTypes": ["AC"] 
}
Response: { 
  "documents": [...], 
  "sources": ["§ 23.2240", "AC 23-xx"],
  "ecfrUsed": true,
  "drsUsed": true,
  "cacheHits": 2
}

# Tool 3: Answer (Claude synthesis)
POST /api/answer
Request:  { 
  "question": "...", 
  "documents": [...], 
  "history": [{ "role": "user", "content": "..." }, ...] 
}
Response: { 
  "answer": "For Part 23 structural wing modifications...", 
  "sources": ["§ 23.2240", "AC 23-xx"] 
}
```

### Orchestrator Implementation

```python
# orchestrator/agent/graph.py

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.postgres import PostgresSaver
import httpx
from typing import TypedDict

TOOLS_BASE_URL = "https://your-swa.azurestaticapps.net/api"

class AgentState(TypedDict):
    messages: list[dict]           # Conversation history
    question: str                   # Current question
    classification: dict | None    # From classify tool
    clarity_score: float           # 0-1 clarity assessment
    documents: list[dict]          # Retrieved documents
    answer: str | None             # Final answer

async def classify_node(state: AgentState) -> dict:
    """Call the /api/classify tool"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{TOOLS_BASE_URL}/classify",
            json={"question": state["question"]}
        )
        return {"classification": response.json()}

async def clarity_check_node(state: AgentState) -> dict:
    """Assess if the question is clear enough to answer"""
    classification = state["classification"]
    history_length = len(state["messages"])
    
    # Clarity heuristics:
    # - No specific CFR sections identified → vague
    # - Low classifier confidence → vague
    # - Short question with no history → likely vague
    has_sections = bool(classification.get("cfrSections"))
    confidence = classification.get("confidence", 0)
    
    if has_sections and confidence > 0.7:
        return {"clarity_score": 0.9}
    elif history_length >= 2:  # Context from prior turns
        return {"clarity_score": 0.8}
    else:
        return {"clarity_score": 0.4}

async def clarify_node(state: AgentState) -> dict:
    """Generate clarifying question"""
    classification = state["classification"]
    
    # Build clarification based on what's missing
    questions = []
    if len(classification.get("cfrParts", [])) > 1:
        parts = ", ".join(str(p) for p in classification["cfrParts"])
        questions.append(f"Which certification part applies? (Part {parts})")
    if not classification.get("cfrSections"):
        questions.append("What specific aspect are you asking about?")
    
    clarification = "To provide precise guidance, I need to know:\n"
    clarification += "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions))
    
    return {"answer": clarification}

async def search_node(state: AgentState) -> dict:
    """Call the /api/search tool (eCFR + DRS + Cache)"""
    classification = state["classification"]
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{TOOLS_BASE_URL}/search",
            json={
                "cfrSections": classification.get("cfrSections", []),
                "topics": classification.get("topics", []),
                "docTypes": classification.get("documentTypes", ["AC"])
            }
        )
        return {"documents": response.json().get("documents", [])}

async def answer_node(state: AgentState) -> dict:
    """Call the /api/answer tool"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{TOOLS_BASE_URL}/answer",
            json={
                "question": state["question"],
                "documents": state["documents"],
                "history": state["messages"]
            }
        )
        return {"answer": response.json().get("answer", "")}

def route_clarity(state: AgentState) -> str:
    """Route based on clarity score"""
    if state["clarity_score"] < 0.6:
        return "clarify"
    return "search"

# Build the graph
workflow = StateGraph(AgentState)

workflow.add_node("classify", classify_node)
workflow.add_node("clarity_check", clarity_check_node)
workflow.add_node("clarify", clarify_node)
workflow.add_node("search", search_node)
workflow.add_node("answer", answer_node)

workflow.set_entry_point("classify")

workflow.add_edge("classify", "clarity_check")
workflow.add_conditional_edges(
    "clarity_check",
    route_clarity,
    {"clarify": "clarify", "search": "search"}
)
workflow.add_edge("clarify", END)
workflow.add_edge("search", "answer")
workflow.add_edge("answer", END)

# Compile with PostgreSQL checkpointer for session persistence
checkpointer = PostgresSaver.from_conn_string(os.environ["DATABASE_URL"])
agent = workflow.compile(checkpointer=checkpointer)
```

### Orchestrator API (FastAPI)

```python
# orchestrator/main.py

from fastapi import FastAPI
from pydantic import BaseModel
from agent.graph import agent

app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    session_id: str

class ChatResponse(BaseModel):
    response: str
    session_id: str
    needs_more_info: bool
    sources: list[str]

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Multi-turn conversation endpoint"""
    
    # Configure thread for session persistence
    config = {"configurable": {"thread_id": request.session_id}}
    
    # Get current state (conversation history)
    current_state = agent.get_state(config)
    messages = current_state.values.get("messages", []) if current_state.values else []
    
    # Add user message to history
    messages.append({"role": "user", "content": request.message})
    
    # Run the agent
    result = await agent.ainvoke(
        {
            "messages": messages,
            "question": request.message,
            "classification": None,
            "clarity_score": 0,
            "documents": [],
            "answer": None
        },
        config
    )
    
    # Determine if we need more info (clarification was requested)
    needs_more_info = result["clarity_score"] < 0.6
    
    return ChatResponse(
        response=result["answer"],
        session_id=request.session_id,
        needs_more_info=needs_more_info,
        sources=extract_sources(result.get("documents", []))
    )

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "orchestrator"}
```

### Multi-Turn Conversation Example

```
Turn 1:
  User: "What are the wing modification requirements?"
  
  Orchestrator flow:
    → classify: { cfrParts: [23, 25], cfrSections: [], confidence: 0.5 }
    → clarity_check: score = 0.4 (vague - multiple parts, no sections)
    → clarify: "To provide precise guidance, I need to know:
                1. Which certification part applies? (Part 23, 25)
                2. What specific aspect are you asking about?"
    → END (needs_more_info: true)

Turn 2:
  User: "Part 23, structural modification to wing spar"
  
  Orchestrator flow (with history):
    → classify: { cfrParts: [23], cfrSections: ["23.2240", "23.2245"], 
                  topics: ["wing", "spar", "structural"], confidence: 0.92 }
    → clarity_check: score = 0.9 (clear now)
    → search: [§ 23.2240, § 23.2245, AC 23-xx from cache/eCFR/DRS]
    → answer: "For Part 23 structural wing spar modifications, you must 
               comply with § 23.2240 (Structural strength) which requires..."
    → END (needs_more_info: false)
```

### New Azure Functions to Expose

Refactor existing code into separate tool endpoints:

| Function | Description | Source |
|----------|-------------|--------|
| `/api/classify` | Query classification | Extract from ragPipeline + new queryClassifier |
| `/api/search` | eCFR + DRS + Cache fetch | Extract from ragPipeline |
| `/api/answer` | Claude synthesis | Extract from ragPipeline |
| `/api/ask` | Keep for backward compatibility | Existing (calls all three internally) |

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `api/src/functions/classify.ts` | CREATE | Expose classifier as HTTP endpoint |
| `api/src/functions/search.ts` | CREATE | Expose search (eCFR+DRS+cache) as endpoint |
| `api/src/functions/answer.ts` | CREATE | Expose Claude answer generation |
| `orchestrator/` | CREATE | New Python project for LangGraph |
| `orchestrator/agent/graph.py` | CREATE | LangGraph agent definition |
| `orchestrator/agent/state.py` | CREATE | Agent state schema |
| `orchestrator/main.py` | CREATE | FastAPI server |
| `orchestrator/requirements.txt` | CREATE | Python dependencies |
| `orchestrator/Dockerfile` | CREATE | Container image |

### Deployment Architecture

```
Azure Static Web App (existing):
  ├── Frontend (React)
  │     └── Calls /api/chat (orchestrator) or /api/ask (direct)
  └── /api/* (Azure Functions - Stateless Tools)
        ├── /api/classify   ← Called by orchestrator
        ├── /api/search     ← Called by orchestrator
        ├── /api/answer     ← Called by orchestrator
        └── /api/ask        ← Direct path (backward compat)

Azure Container App (new):
  └── Orchestrator (LangGraph + FastAPI)
        └── POST /chat      ← Called by frontend
        └── GET /health

Azure Database for PostgreSQL Flexible Server:
  └── Session state & conversation history
```

### Implementation Timeline

| Week | Phase | Actions |
|------|-------|---------|
| 1 | **Refactor Functions** | Split ragPipeline into /classify, /search, /answer endpoints |
| 2 | **Build Orchestrator** | Create LangGraph agent, FastAPI server, Dockerfile |
| 3 | **Deploy Infrastructure** | Container App, PostgreSQL, networking |
| 4 | **Integration Testing** | End-to-end multi-turn flows |
| 5 | **Frontend Update** | Switch from /api/ask to /chat endpoint |

### Cost Estimate

| Component | Monthly Cost |
|-----------|--------------|
| Azure Functions (tools) | ~$0 (consumption) |
| Container App (orchestrator) | ~$20-50 (min 0.25 vCPU) |
| PostgreSQL Flexible (state) | ~$15-30 (burstable B1ms) |
| **Total Added** | **~$35-80/mo** |

### Feature Flag for Gradual Rollout

```typescript
// Frontend: services/api.ts

const USE_ORCHESTRATOR = import.meta.env.VITE_USE_ORCHESTRATOR === 'true';

export async function askQuestion(question: string, sessionId?: string) {
  if (USE_ORCHESTRATOR && sessionId) {
    // New path: Multi-turn orchestrator
    return fetch('/chat', {
      method: 'POST',
      body: JSON.stringify({ message: question, session_id: sessionId })
    });
  } else {
    // Legacy path: Direct to Azure Function
    return fetch('/api/ask', {
      method: 'POST', 
      body: JSON.stringify({ question })
    });
  }
}
```

---

## Core Features (MVP)

### Functional Features
- ✅ **Multi-turn clarifying questions** - Intelligently identifies vague queries and asks targeted questions
- ✅ **Indexed content search** - Fast semantic search through pre-indexed regulations (Azure AI Search)
- ✅ **DRS API fallback** - Automatic fallback to FAA DRS for comprehensive coverage
- ✅ **Precise citations** - All answers include specific regulation numbers and sources
- ✅ **Session persistence** - Conversation history maintained across messages
- ✅ **Context extraction** - LLM extracts structured context (aircraft part, mod type, etc.)

### User Interface Features
- ✅ **Web chat interface** - Clean, responsive chat UI
- ✅ **Message history** - Full conversation display
- ✅ **Loading indicators** - Shows when agent is thinking/processing
- ✅ **Source citations** - Displays regulation references and document sources
- ✅ **Mobile responsive** - Works on tablets and phones

### Technical Features
- ✅ **Confidence scoring** - Determines when to use RAG vs DRS
- ✅ **Stateful workflows** - LangGraph manages multi-step agent logic
- ✅ **Error handling** - Graceful failures with helpful messages
- ✅ **Hybrid search** - Combines vector similarity + keyword search

---

## What's NOT in MVP

Explicitly out of scope for initial release:

- ❌ **Document upload/analysis** - User cannot upload engineering documents (Phase 2)
- ❌ **Compliance matrix generation** - No automated compliance matrices (Phase 3)
- ❌ **Timeline prediction** - No certification timeline estimates (Phase 3)
- ❌ **Proactive DRS monitoring** - No automatic alerts for regulation changes (Phase 4)
- ❌ **User authentication** - No login/user accounts
- ❌ **Multi-user support** - No user profiles or saved projects
- ❌ **Document version tracking** - No historical regulation versions
- ❌ **Cost estimation** - No certification cost predictions
- ❌ **Precedent research** - No STC/TC precedent analysis

---

## Success Criteria

### Functional Success
1. ✅ Vague questions trigger clarifying questions (clarity score < 0.6)
2. ✅ Clear questions get precise answers without clarification
3. ✅ Questions not in index automatically fetch from DRS
4. ✅ All answers include specific regulation citations
5. ✅ Multi-turn conversations maintain context across messages
6. ✅ Response time < 5 seconds for typical queries

### Technical Success
1. ✅ LangGraph state management works correctly
2. ✅ Session persistence survives page refreshes
3. ✅ RAG + DRS fallback logic functions properly
4. ✅ Frontend ↔ Backend integration stable
5. ✅ Error handling prevents crashes
6. ✅ Can deploy to Azure successfully

### Business Success
1. ✅ Demo-able to potential customers/investors
2. ✅ Provides more precise answers than baseline RAG
3. ✅ Handles real user questions from target personas
4. ✅ Foundation architecture supports Phase 2+ features

---

## Development Phases

### Phase 1: MVP (4 weeks)
**Deliverable:** Web-based clarifying RAG agent with DRS fallback

**Week 1:** Backend Foundation
- LangGraph setup and configuration
- Agent state schema definition
- Clarity assessment node
- RAG tool (Azure AI Search wrapper)

**Week 2:** DRS Integration
- DRS API tool implementation
- PDF download and text extraction
- Fallback logic and confidence scoring
- Background indexing pipeline

**Week 3:** Backend Completion
- FastAPI endpoints (REST API)
- Error handling and validation
- Testing both RAG and DRS paths
- Edge case handling

**Week 4:** Frontend Development
- React + Vite setup
- Chat interface components
- Backend API integration
- Responsive design and polish

### Phase 2: Document Analysis (2-3 weeks)
**Deliverable:** Users can upload engineering documents for analysis

- Document upload endpoint
- PDF parsing and specification extraction
- Cross-reference user docs with regulations
- Identify applicable requirements

### Phase 3: Compliance Planning (3-4 weeks)
**Deliverable:** Automated compliance matrix and timeline generation

- Compliance matrix generation
- Gap analysis and identification
- Timeline prediction model
- Certification roadblock detection

### Phase 4: Proactive Intelligence (4-5 weeks)
**Deliverable:** Background monitoring and alerts

- DRS change monitoring service
- Project tracking and alerts
- Regulatory impact analysis
- Alternative strategy suggestions

---

## Key Architectural Decisions

### Monolith vs Microservices
**Decision:** Monolith (single deployment)

**Rationale:**
- Simpler to develop and debug
- Faster performance (no network calls between services)
- Lower operational overhead
- Easier to iterate during MVP phase
- Can split into microservices later if scaling requires it

**What This Means:**
- Backend, agent, and all tools in single codebase
- Single deployment unit
- All components import directly (no HTTP between internal services)

### Repository Strategy
**Decision:** Single monorepo (backend + frontend)

**Rationale:**
- Easier coordination between frontend and backend changes
- Atomic commits across full stack
- Single version, single deploy
- Appropriate for small team/solo developer

**Branching:**
```
main              # Production-ready
├── develop       # Integration branch
    ├── feature/clarity-checker
    ├── feature/drs-integration
    └── feature/chat-ui
```

### State Management
**Decision:** SQLite for MVP, migrate to Azure PostgreSQL for production

**Rationale:**
- SQLite: Zero setup, built-in LangGraph support, perfect for development
- PostgreSQL: Azure-native, built-in LangGraph support, persistent across deployments
- Easy migration path (just swap checkpointer implementation)

**SQLite in MVP:**
- Lives as file in backend directory (`aviation_agent.db`)
- Same process as FastAPI application
- Not a separate service or Azure resource

### Frontend Framework
**Decision:** React + Vite

**Rationale:**
- Modern, fast development experience
- Large ecosystem and community
- Easy to find developers
- Good for future mobile app (React Native)
- Vite provides instant hot reload

### Agent Framework
**Decision:** LangGraph (not Semantic Kernel)

**Rationale:**
- Purpose-built for stateful agent workflows
- Native support for cycles (clarification loops)
- Built-in checkpointing and state management
- Larger community and better documentation for agent use cases
- Strong Python ecosystem integration

### Vector Database
**Decision:** Azure AI Search for MVP (consider Pinecone for cost optimization)

**Rationale:**
- Azure AI Search: Already in Azure ecosystem, good hybrid search
- Consideration: ~$250/month minimum even when idle
- Alternative: Pinecone Serverless (~$5/month, true pay-per-use)
- Decision deferred until after MVP proves product-market fit

---

## API Endpoints

### Backend REST API

```
POST /api/chat
Request:
{
  "message": "What are wing modification requirements?",
  "session_id": "abc-123" // optional, generated if not provided
}

Response:
{
  "response": "To provide precise guidance, I need to know...",
  "session_id": "abc-123",
  "needs_more_info": true,
  "sources": [
    {
      "regulation": "14 CFR 23.629",
      "title": "Aeroelastic stability",
      "url": "https://..."
    }
  ]
}

GET /health
Response:
{
  "status": "healthy",
  "version": "0.1.0"
}
```

---

## Deployment Strategy

### MVP Deployment (Simple)
```
Single Azure Container Instance or VM
├── FastAPI backend (serves API)
└── React static files (served by FastAPI at /)
```

### Production Deployment (Future)
```
Backend: Azure Container Apps or App Service
Frontend: Azure Static Web Apps or CDN
Database: Azure Database for PostgreSQL Flexible Server
```

---

## Future Expansion Roadmap

### After MVP Success

**Phase 2: Document Intelligence**
- Upload engineering drawings and specifications
- Automated requirement extraction
- Cross-document compliance analysis
- Design gap identification

**Phase 3: Planning & Analysis**
- Compliance matrix generation
- Certification timeline estimation
- Roadblock prediction and mitigation
- Alternative strategy suggestions

**Phase 4: Proactive Services**
- Automated DRS monitoring (daily updates)
- Regulatory change alerts for active projects
- Project status tracking
- Cost estimation tools

**Phase 5: Scale & Expand**
- Multi-user support with authentication
- Team collaboration features
- API for third-party integrations
- Expand to other regulatory domains (medical devices, nuclear, maritime)

---

## Market Positioning

**Target Market:**
- Aircraft manufacturers (Boeing, Airbus, Gulfstream, etc.)
- Part 21 design organizations
- Maintenance organizations (Part 145)
- Aviation law firms and consultants
- Aviation engineering consultancies

**Value Proposition:**
"AI compliance infrastructure for safety-critical industries - replacing $300/hr specialists for routine regulatory analysis"

**Competitive Moat:**
- Regulatory expertise encoded in agent behaviors
- Direct DRS API integration (comprehensive FAA document access)
- Multi-step reasoning and clarification workflows
- Compliance process knowledge (not just search)

**Expansion Potential:**
- Medical devices (FDA regulations)
- Nuclear (NRC compliance)
- Automotive safety (NHTSA)
- Maritime (Coast Guard/IMO)

---

## Notes

### Important Clarifications

**DRS Tool:**
- Python module/class, NOT a microservice
- Lives in `backend/tools/drs_tool.py`
- Same process as FastAPI application
- Directly imported and called by agent nodes

**SQLite:**
- File-based database, NOT an Azure service
- Lives as `aviation_agent.db` in backend directory
- Same container/VM as application code
- For production, migrate to Azure PostgreSQL (built-in LangGraph support)

**Architecture:**
- Monolith deployment (all components in single container)
- Can scale horizontally by running multiple instances
- Stateless application (state in database)
- No microservices until post-revenue scaling needs

**Cost Optimization:**
- Consider Pinecone Serverless instead of Azure AI Search (~$245/month savings)
- Use Azure PostgreSQL Flexible Server (can pause when not using)
- Serverless Cosmos DB option if switching from PostgreSQL

---

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- Azure subscription
- FAA DRS API key
- Git

### Initial Setup

1. **Clone repository**
   ```bash
   git clone https://github.com/yourusername/aviation-rag-agent.git
   cd aviation-rag-agent
   ```

2. **Backend setup**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # or `venv\Scripts\activate` on Windows
   pip install -r requirements.txt
   cp .env.example .env
   # Edit .env with your Azure credentials
   ```

3. **Frontend setup**
   ```bash
   cd frontend
   npm install
   ```

4. **Index initial documents**
   ```bash
   cd backend
   python scripts/setup_index.py
   ```

5. **Run development servers**
   ```bash
   # Terminal 1 - Backend
   cd backend
   uvicorn main:app --reload
   
   # Terminal 2 - Frontend
   cd frontend
   npm run dev
   ```

6. **Access application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - API docs: http://localhost:8000/docs

---

## Ideas Shelf

Future enhancements and architectural directions to explore.

### Agentic Mode (LangGraph)

Move from linear flow to autonomous agent that decides what tools to call and loops until it has sufficient context.

**Tools the agent could use:**
- `cfr_lookup` - Fetch specific CFR sections from eCFR
- `cfr_search` - Search CFR by topic/keywords
- `drs_search` - Search FAA documents (ACs, ADs, TSOs)
- `drs_fetch` - Download and extract specific document
- `user_docs` - Search user-uploaded documents (specs, reports)
- `precedent_search` - Find similar TC/STC approvals
- `web_search` - General aviation information

**Flow:**
```
User Question
    ↓
Agent thinks: "What do I need to answer this?"
    ↓
┌─────────────────────────────────────────┐
│ Agent Loop                              │
│                                         │
│   Decide → Call Tool → Evaluate         │
│      ↑                    │             │
│      └────────────────────┘             │
│           (repeat until sufficient)     │
└─────────────────────────────────────────┘
    ↓
"I have enough context" → Generate Answer
```

**Example:**
```
User: "Compare Part 23 and Part 25 stall requirements and 
       find the relevant ACs for compliance"

Agent:
  → cfr_lookup(part=23, section="2150") ✓
  → cfr_lookup(part=25, section="103") ✓
  → "Need compliance guidance..."
  → drs_search(keywords=["stall", "Part 23"], type="AC") ✓
  → drs_search(keywords=["stall", "Part 25"], type="AC") ✓
  → "Found AC 23-8C and AC 25-7D, let me get details..."
  → drs_fetch("AC 23-8C") ✓ (cached)
  → drs_fetch("AC 25-7D") ✓ (cached)
  → "Sufficient context" → Generate comparison
```

**When to implement:** When users need complex multi-part queries that require dynamic tool selection and iteration.

**Tech:** LangGraph with tool-calling loop, ReAct pattern

---

### User Document Upload

Allow users to upload their own documents (specs, test reports, drawings) and reference them in queries.

**Use cases:**
- "Does my wing design meet § 23.2240?"
- "What additional tests do I need based on my test plan?"
- "Find gaps in my compliance matrix"

**Storage:** Azure Blob Storage per user/project

---

### Precedent Research

Search historical TC/STC approvals to find how similar designs were certified.

**Data source:** FAA type certificate data sheets, STC database

**Use case:** "How have other Part 23 aircraft with composite wings been certified?"

---

### Proactive Monitoring

Alert users when regulations or ACs they care about are updated.

**Implementation:** 
- User bookmarks CFR sections or ACs
- Background job checks DRS/eCFR for changes
- Email/notification on updates

---

### Compliance Matrix Generation

Given a project scope, auto-generate a compliance matrix with applicable regulations.

**Input:** Aircraft type, modifications, certification basis
**Output:** Spreadsheet with sections, compliance methods, status

---

### Multi-Agent Collaboration

Specialized agents that collaborate on complex questions:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Regulatory  │  │ Compliance  │  │ Precedent   │
│ Agent       │  │ Agent       │  │ Agent       │
│ "What the   │  │ "How to     │  │ "How others │
│  CFR says"  │  │  comply"    │  │  did it"    │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        ↓
               ┌─────────────────┐
               │  Synthesizer    │
               │  Agent          │
               └─────────────────┘
                        ↓
                 Final Answer
```

---

## Contact & Resources

**Project Documentation:**
- Architecture diagrams: `/docs/architecture.md`
- API documentation: `/docs/api.md`
- Setup guide: `/docs/setup.md`

**External Resources:**
- LangGraph: https://langchain-ai.github.io/langgraph/
- FAA DRS: https://drs.faa.gov
- eCFR API: https://www.ecfr.gov/developers/documentation/api/v1

---

*Last Updated: January 2026*
*Version: 0.1.0-mvp*