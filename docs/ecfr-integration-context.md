# eCFR API Integration - Context & Planning

## Current State (Completed)

### DRS Integration (Phase 1) - DONE
- **DRS Client** (`api/src/lib/drsClient.ts`) - Fetches documents from FAA DRS API
- **Search Evaluator** (`api/src/lib/searchEvaluator.ts`) - Determines when to fallback to DRS
- **RAG Pipeline** (`api/src/lib/ragPipeline.ts`) - Orchestrates fallback logic
- **Frontend** - Shows DRS badge when fallback is used, renders markdown

### What DRS Provides
- Advisory Circulars (ACs) - guidance on HOW to comply
- Airworthiness Directives (ADs)
- Technical Standard Orders (TSOs)
- FAA Orders

### What DRS Does NOT Have
- CFRs (Code of Federal Regulations) - the actual legal requirements

---

## The Gap Identified

### Example Query: "how do I certify a propeller?"

**Current behavior:**
1. Azure Search returns results with score 8.48 ("Good results")
2. No DRS fallback triggered (score was high, no specific doc mentioned)
3. Claude answers but says: "you would need to comply with the full Part 35 regulations"

**The problem:**
- The system doesn't proactively fetch Part 35 (propeller airworthiness standards)
- DRS doesn't have CFRs anyway
- User gets incomplete answer

---

## Proposed Solution: eCFR API Integration

### Why eCFR?
- **CFRs = Legal Requirements** (what you MUST do)
- **ACs = Guidance** (how you CAN comply)
- For complete answers, we need BOTH

### eCFR API Details
- API endpoint: `https://www.ecfr.gov/api/`
- No API key required (public)
- Can fetch specific titles/parts (Title 14 = Aeronautics)

### Key CFR Parts for Aviation (Title 14)
| Part | Subject |
|------|---------|
| 21 | Certification procedures |
| 23 | Normal category airplanes |
| 25 | Transport category airplanes |
| 27 | Normal category rotorcraft |
| 29 | Transport category rotorcraft |
| 33 | Aircraft engines |
| 35 | Propellers |
| 39 | Airworthiness directives |
| 43 | Maintenance |
| 91 | General operating rules |
| 121 | Air carrier operations |
| 135 | Commuter operations |

### Topic-to-CFR Mapping (Static, rarely changes)
```typescript
const TOPIC_TO_CFR: Record<string, number[]> = {
  'propeller': [35, 21],
  'engine': [33, 21],
  'aircraft': [23, 25, 21],
  'rotorcraft': [27, 29, 21],
  'helicopter': [27, 29, 21],
  'maintenance': [43, 91],
  'certification': [21],
  'type certificate': [21],
  'airworthiness': [39, 21],
};
```

---

## Implementation Plan

### Phase 2: eCFR Integration

1. **Create eCFR Client** (`api/src/lib/ecfrClient.ts`)
   - Fetch CFR parts by title/part number
   - Parse and extract relevant sections
   - Handle rate limiting (if any)

2. **Update Search Evaluator**
   - Add topic detection for aviation subjects
   - Map topics to relevant CFR parts
   - Return suggested CFR parts to fetch

3. **Update RAG Pipeline**
   - Always augment with relevant CFR sections when aviation topics detected
   - Combine: Azure Search + DRS ACs + eCFR regulations
   - Let Claude synthesize the complete answer

4. **Update Frontend**
   - Add badge/indicator for eCFR sources
   - Show which CFR parts were consulted

---

## Architecture After Phase 2

```
User Query
    |
    v
+-------------------+
| Topic Detection   | --> Identify: propeller, engine, certification, etc.
+-------------------+
    |
    v
+-------------------+     +-------------------+     +-------------------+
| Azure AI Search   |     | FAA DRS API       |     | eCFR API          |
| (indexed docs)    |     | (ACs, ADs, TSOs)  |     | (14 CFR Parts)    |
+-------------------+     +-------------------+     +-------------------+
    |                         |                         |
    v                         v                         v
+---------------------------------------------------------------+
|                    Combined Context                            |
|  - Indexed chunks (Azure)                                      |
|  - Advisory guidance (DRS)                                     |
|  - Legal requirements (eCFR)                                   |
+---------------------------------------------------------------+
    |
    v
+-------------------+
| Claude (Anthropic)|
+-------------------+
    |
    v
Complete Answer with:
- Legal requirements cited (CFR sections)
- Guidance on compliance (ACs)
- Specific details from indexed docs
```

---

## Files to Modify/Create

| File | Action |
|------|--------|
| `api/src/lib/ecfrClient.ts` | CREATE - eCFR API client |
| `api/src/lib/searchEvaluator.ts` | UPDATE - Add topic detection |
| `api/src/lib/ragPipeline.ts` | UPDATE - Integrate eCFR fetching |
| `frontend/src/components/Message.tsx` | UPDATE - Add eCFR badge |
| `frontend/src/App.css` | UPDATE - eCFR badge styling |

---

## Questions to Resolve

1. **eCFR API rate limits?** - Need to check documentation
2. **Caching strategy?** - CFRs don't change often, could cache aggressively
3. **How much CFR text to include?** - Full parts can be large, may need section-level fetching
4. **Parallel vs sequential fetching?** - Azure + DRS + eCFR could run in parallel

---

## Related Files

- Plan file: `/Users/tudor/.claude/plans/dreamy-wondering-lark.md`
- DRS Client: `/Users/tudor/src/faa-search-web/api/src/lib/drsClient.ts`
- Search Evaluator: `/Users/tudor/src/faa-search-web/api/src/lib/searchEvaluator.ts`
- RAG Pipeline: `/Users/tudor/src/faa-search-web/api/src/lib/ragPipeline.ts`
