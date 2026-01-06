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