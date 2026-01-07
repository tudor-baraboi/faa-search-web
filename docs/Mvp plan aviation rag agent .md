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

```
┌──────────────────┐
│   Web Browser    │ React chat interface
│   (Frontend)     │
└────────┬─────────┘
         │ HTTP
         ↓
┌─────────────────────────────────────────┐
│      FastAPI Backend (Monolith)         │
│                                          │
│  ┌────────────────────────────────┐    │
│  │   LangGraph Agent              │    │
│  │   ┌──────────┐  ┌───────────┐ │    │
│  │   │ Clarity  │→ │ Enhanced  │ │    │
│  │   │ Check    │  │ Search    │ │    │
│  │   └──────────┘  └───────────┘ │    │
│  └────────────────────────────────┘    │
│           ↓           ↓                 │
│  ┌─────────────┐  ┌──────────┐        │
│  │  RAG Tool   │  │ DRS Tool │        │
│  │  (module)   │  │ (module) │        │
│  └─────────────┘  └──────────┘        │
│           │            │               │
│  ┌────────────────────────────┐       │
│  │ SQLite (state storage)     │       │
│  │ aviation_agent.db (file)   │       │
│  └────────────────────────────┘       │
└─────────────────────────────────────────┘
         ↓              ↓         
   ┌─────────┐   ┌─────────┐
   │Azure AI │   │DRS API  │
   │ Search  │   │(FAA)    │
   └─────────┘   └─────────┘
         ↓
   ┌─────────┐
   │Azure    │
   │OpenAI   │
   └─────────┘
```

---

## Technology Stack

### Backend (Python)
- **FastAPI** - API server + serves frontend static files
- **LangGraph** - Agent orchestration and workflow management
- **RAG Tool** - Azure AI Search wrapper (vector + semantic search)
- **DRS Tool** - FAA Dynamic Regulatory System API integration
- **SQLite** - Session state persistence (file-based, lives in backend)
- **Azure OpenAI** - LLM (GPT-4) + embeddings (text-embedding-ada-002)
- **Azure AI Search** - Vector database for indexed regulations

### Frontend (JavaScript)
- **React** - UI framework
- **Vite** - Build tool and dev server
- **Chat Interface** - Custom chat components
- **Axios** - HTTP client for backend API calls

### Key Libraries
```
Backend:
- langgraph
- langchain-core
- langchain-openai
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

### Enhanced Search Flow

```
User Query
    ↓
Assess Clarity Node
    ├─→ [Clarity Score < 0.6] → Ask Clarifying Questions → END (wait for user)
    └─→ [Clarity Score ≥ 0.6] → Enhanced Search Node
                                      ↓
                                Search Indexed Content (RAG)
                                      ↓
                                Evaluate Confidence Score
                                      ├─→ [Confidence > 0.7] → Return Answer from RAG
                                      └─→ [Confidence ≤ 0.7] → Fallback to DRS
                                                                    ↓
                                                            Determine doc_type from context
                                                                    ↓
                                                            DRS API search & download
                                                                    ↓
                                                            Extract text from PDF
                                                                    ↓
                                                            Generate answer from DRS
                                                                    ↓
                                                            (Background: index for future)
```

### Multi-Turn Conversation Example

```
Turn 1:
User: "What are the requirements for wing modification?"
Agent: "To provide precise guidance, I need to know:
        1. Which certification part? (Part 23, 25, 27, 29)
        2. What type of modification? (structural, avionics, etc.)"
[END - waits for user response]

Turn 2:
User: "Part 23, structural"
Agent: [Searches with context: "Part 23 structural wing modification"]
       "For Part 23 structural wing modifications, you must comply with:
        
        1. 14 CFR 23.629 - Aeroelastic stability requirements
        2. 14 CFR 23.573 - Damage tolerance and fatigue evaluation
        
        Reference: AC 23-13A (Structural Test Guidance)..."
```

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

2. **No new secrets needed** — uses existing `AzureWebJobsStorage` connection string

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

## Contact & Resources

**Project Documentation:**
- Architecture diagrams: `/docs/architecture.md`
- API documentation: `/docs/api.md`
- Setup guide: `/docs/setup.md`

**External Resources:**
- LangGraph: https://langchain-ai.github.io/langgraph/
- FAA DRS: https://drs.faa.gov
- Azure AI Search: https://azure.microsoft.com/en-us/products/ai-services/ai-search

---

*Last Updated: January 2026*
*Version: 0.1.0-mvp*