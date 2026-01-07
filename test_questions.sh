#!/bin/bash

# Test questions for FAA RAG system
# Runs each question and captures timing + key metrics

API_URL="http://localhost:7071/api/ask"
LOG_FILE="/tmp/faa_test_results.log"

echo "FAA RAG Test Suite - $(date)" > "$LOG_FILE"
echo "================================" >> "$LOG_FILE"

test_question() {
    local category="$1"
    local question="$2"
    local num="$3"
    
    echo ""
    echo "[$num] Testing: $question"
    
    START=$(date +%s)
    
    RESPONSE=$(curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"question\": \"$question\"}" \
        --max-time 120)
    
    END=$(date +%s)
    DURATION=$((END - START))
    
    # Extract key fields
    SOURCE_COUNT=$(echo "$RESPONSE" | jq -r '.sourceCount // 0')
    ECFR_USED=$(echo "$RESPONSE" | jq -r '.ecfrUsed // false')
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "none"')
    SOURCES=$(echo "$RESPONSE" | jq -r '.sources[:3] | join(", ")' 2>/dev/null || echo "parse error")
    
    # Determine status
    if [ "$ERROR" != "none" ] && [ "$ERROR" != "null" ]; then
        STATUS="❌ FAILED"
    elif [ "$SOURCE_COUNT" -eq 0 ]; then
        STATUS="⚠️ NO SOURCES"
    else
        STATUS="✅ OK"
    fi
    
    echo "   $STATUS | ${DURATION}s | sources=$SOURCE_COUNT | ecfr=$ECFR_USED"
    echo "   Sources: $SOURCES"
    
    # Log details
    echo "" >> "$LOG_FILE"
    echo "[$num] $category: $question" >> "$LOG_FILE"
    echo "Status: $STATUS" >> "$LOG_FILE"
    echo "Duration: ${DURATION}s" >> "$LOG_FILE"
    echo "Sources: $SOURCE_COUNT" >> "$LOG_FILE"
    echo "eCFR: $ECFR_USED" >> "$LOG_FILE"
    echo "Error: $ERROR" >> "$LOG_FILE"
    echo "Top Sources: $SOURCES" >> "$LOG_FILE"
}

echo ""
echo "=== REGULATORY LOOKUP ==="
test_question "regulatory_lookup" "What are the stall speed requirements?" 1
test_question "regulatory_lookup" "What does 14 CFR 25.1309 say about system safety?" 2
test_question "regulatory_lookup" "What are the Part 23 flight characteristics requirements?" 3
test_question "regulatory_lookup" "What is the regulation for fuel tank venting?" 4

echo ""
echo "=== COMPLIANCE GUIDANCE ==="
test_question "compliance_guidance" "How do I demonstrate compliance with Part 25 icing requirements?" 5
test_question "compliance_guidance" "What is an acceptable method to show compliance with flammability requirements?" 6
test_question "compliance_guidance" "How can I certify a modified fuel system under Part 23?" 7

echo ""
echo "=== DOCUMENT REQUEST ==="
test_question "document_request" "Show me AC 23-8C" 8
test_question "document_request" "What does AC 25-7D say about flight testing?" 9
test_question "document_request" "I need the Advisory Circular for EWIS certification" 10

echo ""
echo "=== GENERAL QUESTION ==="
test_question "general_question" "What is the difference between a type certificate and supplemental type certificate?" 11
test_question "general_question" "How does the certification process work for new aircraft?" 12

echo ""
echo "=== MULTI-PART ==="
test_question "multi_part" "What are the structural fatigue requirements for Part 25 aircraft?" 13
test_question "multi_part" "Compare landing gear requirements between Part 23 and Part 25" 14

echo ""
echo "================================"
echo "Test complete! Full log at: $LOG_FILE"
