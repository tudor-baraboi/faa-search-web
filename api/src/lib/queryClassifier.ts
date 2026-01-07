/**
 * Query Classifier
 * LLM-based classification of aviation regulatory questions
 * Routes queries to appropriate data sources (eCFR, DRS)
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Classification result for a query
 */
export interface QueryClassification {
  // Query intent
  intent: 'regulatory_lookup' | 'compliance_guidance' | 'document_request' | 'general_question';
  
  // Detected aviation topics
  topics: string[];
  
  // CFR routing (for eCFR API)
  cfrParts: number[];
  cfrSections: string[];
  
  // Document routing (for DRS API)
  documentTypes: ('AC' | 'AD' | 'TSO' | 'Order')[];
  specificDocument?: string;
  
  // Confidence and reasoning
  confidence: number;
  reasoning: string;
}

/**
 * Default classification for fallback scenarios
 */
const DEFAULT_CLASSIFICATION: QueryClassification = {
  intent: 'general_question',
  topics: [],
  cfrParts: [],
  cfrSections: [],
  documentTypes: ['AC'],
  confidence: 0.3,
  reasoning: 'Default classification - unable to determine specific routing'
};

/**
 * System prompt for the classifier
 */
const CLASSIFIER_SYSTEM_PROMPT = `You are an FAA regulatory classification expert. Analyze aviation questions and identify:

1. The user's intent:
   - regulatory_lookup: Looking for specific regulation text
   - compliance_guidance: How to comply with requirements
   - document_request: Asking about a specific document (AC, AD, etc.)
   - general_question: General aviation question

2. Relevant 14 CFR Part numbers:
   - Part 21: Certification procedures (type certificates, production approvals)
   - Part 23: Normal category airplanes (23.2xxx = performance & flight characteristics)
   - Part 25: Transport category airplanes
   - Part 27: Normal category rotorcraft
   - Part 29: Transport category rotorcraft
   - Part 33: Aircraft engines
   - Part 35: Propellers
   - Part 39: Airworthiness directives
   - Part 43: Maintenance, preventive maintenance, alterations
   - Part 91: General operating rules
   - Part 121: Air carrier operations
   - Part 135: Commuter operations

3. Specific CFR section numbers if determinable (e.g., "23.2150" for stall speed)

4. Related document types:
   - AC: Advisory Circulars (compliance guidance)
   - AD: Airworthiness Directives (mandatory actions)
   - TSO: Technical Standard Orders
   - Order: FAA Orders

Common section mappings:
- Stall speed → § 23.2150 or § 25.103
- Takeoff performance → § 23.2115 or § 25.105
- Landing performance → § 23.2125 or § 25.125
- Structural strength → § 23.2240 or § 25.301
- Flutter → § 23.2245 or § 25.629
- Fire protection → § 25.1181-1207
- Fuel system → § 23.2430 or § 25.951-1001
- Electrical → § 23.2500-2550 or § 25.1351-1365

Respond ONLY with valid JSON matching the exact schema. No markdown, no explanation outside JSON.`;

/**
 * Classify a user query to determine routing
 * 
 * @param question - User's question
 * @param anthropic - Anthropic client instance
 * @returns Classification result with routing information
 */
export async function classifyQuery(
  question: string,
  anthropic: Anthropic
): Promise<QueryClassification> {
  console.log(`🏷️  Classifying query: "${question.substring(0, 50)}..."`);
  
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Classify this aviation regulatory question:

"${question}"

Respond with JSON only:
{
  "intent": "regulatory_lookup|compliance_guidance|document_request|general_question",
  "topics": ["topic1", "topic2"],
  "cfrParts": [number],
  "cfrSections": ["part.section"],
  "documentTypes": ["AC"|"AD"|"TSO"|"Order"],
  "specificDocument": "if explicitly mentioned, e.g. AC 43.13-1B",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`
      }]
    });
    
    const content = response.content[0];
    if (content.type !== 'text') {
      console.warn('⚠️  Classifier returned non-text response');
      return DEFAULT_CLASSIFICATION;
    }
    
    // Parse JSON response
    const classification = parseClassifierResponse(content.text);
    
    console.log(`✅ Classification: intent=${classification.intent}, parts=[${classification.cfrParts}], sections=[${classification.cfrSections}], confidence=${classification.confidence}`);
    
    return classification;
    
  } catch (error) {
    console.error('❌ Classification error:', error);
    return DEFAULT_CLASSIFICATION;
  }
}

/**
 * Parse and validate classifier response
 */
function parseClassifierResponse(text: string): QueryClassification {
  try {
    // Remove any markdown code blocks if present
    let cleanText = text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const parsed = JSON.parse(cleanText);
    
    // Validate and normalize the response
    return {
      intent: validateIntent(parsed.intent),
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      cfrParts: Array.isArray(parsed.cfrParts) ? parsed.cfrParts.map(Number).filter(n => !isNaN(n)) : [],
      cfrSections: Array.isArray(parsed.cfrSections) ? parsed.cfrSections.map(String) : [],
      documentTypes: validateDocumentTypes(parsed.documentTypes),
      specificDocument: parsed.specificDocument || undefined,
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reasoning: parsed.reasoning || 'No reasoning provided'
    };
  } catch (error) {
    console.error('❌ Failed to parse classifier response:', error);
    console.error('   Raw response:', text.substring(0, 200));
    return DEFAULT_CLASSIFICATION;
  }
}

/**
 * Validate intent value
 */
function validateIntent(intent: string): QueryClassification['intent'] {
  const validIntents = ['regulatory_lookup', 'compliance_guidance', 'document_request', 'general_question'];
  return validIntents.includes(intent) ? intent as QueryClassification['intent'] : 'general_question';
}

/**
 * Validate document types array
 */
function validateDocumentTypes(types: unknown): QueryClassification['documentTypes'] {
  const validTypes = ['AC', 'AD', 'TSO', 'Order'];
  if (!Array.isArray(types)) return ['AC'];
  return types.filter(t => validTypes.includes(t)) as QueryClassification['documentTypes'];
}

/**
 * Quick regex-based pre-filter for obvious document requests
 * Use before LLM classifier to save API calls
 */
export function quickClassifyDocumentRequest(query: string): { isDocRequest: boolean; docType?: string; docNumber?: string } {
  // AC pattern: AC 43.13-1B, AC 150/5340-30J
  const acMatch = query.match(/\bAC\s+([\d\/.-]+[A-Z]?)/i);
  if (acMatch) {
    return { isDocRequest: true, docType: 'AC', docNumber: acMatch[1] };
  }
  
  // AD pattern: AD 2023-01-05
  const adMatch = query.match(/\bAD\s+([\d-]+)/i);
  if (adMatch) {
    return { isDocRequest: true, docType: 'AD', docNumber: adMatch[1] };
  }
  
  // TSO pattern: TSO-C129a
  const tsoMatch = query.match(/\bTSO[-\s]?([A-Z]?\d+[A-Za-z]?)/i);
  if (tsoMatch) {
    return { isDocRequest: true, docType: 'TSO', docNumber: tsoMatch[1] };
  }
  
  // Order pattern: Order 8900.1
  const orderMatch = query.match(/\bOrder\s+(\d+\.\d+[A-Z]?)/i);
  if (orderMatch) {
    return { isDocRequest: true, docType: 'Order', docNumber: orderMatch[1] };
  }
  
  return { isDocRequest: false };
}
