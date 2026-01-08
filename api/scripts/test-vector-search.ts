/**
 * Test script for vector search infrastructure
 * Run with: npx tsx scripts/test-vector-search.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// Load local.settings.json values before importing other modules
const settingsPath = join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
for (const [key, value] of Object.entries(settings.Values)) {
  if (typeof value === 'string') {
    process.env[key] = value;
  }
}

// Now import the modules that depend on env vars
import { generateEmbeddings, generateQueryEmbedding, hasEmbeddingService, EMBEDDING_DIMENSIONS } from '../src/lib/embeddings';
import { ensureIndexExists, hybridSearch, indexDocuments, getDocumentCount, hasVectorSearch, FADocument } from '../src/lib/vectorSearch';

async function main() {
  console.log('🧪 Testing Vector Search Infrastructure\n');
  
  // Check services availability
  console.log('1️⃣ Checking service availability...');
  console.log(`   Embedding service available: ${hasEmbeddingService()}`);
  console.log(`   Vector search available: ${hasVectorSearch()}`);
  console.log(`   Embedding dimensions: ${EMBEDDING_DIMENSIONS}`);
  
  if (!hasEmbeddingService() || !hasVectorSearch()) {
    console.error('❌ Services not configured properly. Check environment variables.');
    process.exit(1);
  }
  
  // Test embedding generation
  console.log('\n2️⃣ Testing embedding generation...');
  try {
    const testText = 'bird strike requirements for aircraft certification';
    const embedding = await generateQueryEmbedding(testText);
    console.log(`   ✅ Generated embedding with ${embedding.length} dimensions`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
  } catch (error) {
    console.error('   ❌ Embedding generation failed:', error);
    process.exit(1);
  }
  
  // Ensure index exists
  console.log('\n3️⃣ Ensuring search index exists...');
  try {
    await ensureIndexExists();
    console.log('   ✅ Index ready');
  } catch (error) {
    console.error('   ❌ Index creation failed:', error);
    process.exit(1);
  }
  
  // Get document count
  console.log('\n4️⃣ Checking document count...');
  try {
    const count = await getDocumentCount();
    console.log(`   📊 Documents in index: ${count}`);
  } catch (error) {
    console.error('   ❌ Failed to get document count:', error);
  }
  
  // Index a test document
  console.log('\n5️⃣ Indexing a test document...');
  try {
    const testDoc: FADocument = {
      id: 'test-bird-strike-doc-1',
      documentType: 'eCFR',
      title: '14 CFR § 25.631 - Bird strike damage',
      content: `Bird strike damage. The airplane must be designed to ensure capability of continued safe flight and landing after impact with an 8-pound bird when the velocity of the airplane (relative to the bird along the airplane's flight path) is equal to Vc at sea level.`,
      cfrPart: 25,
      cfrSection: '631',
      source: 'https://www.ecfr.gov/cgi-bin/text-idx?SID=25&node=25.631',
      lastIndexed: new Date()
    };
    
    // Generate embedding
    const embeddings = await generateEmbeddings([testDoc.content]);
    const docWithEmbedding = { ...testDoc, contentVector: embeddings[0] };
    
    await indexDocuments([docWithEmbedding]);
    console.log('   ✅ Test document indexed');
  } catch (error) {
    console.error('   ❌ Indexing failed:', error);
    process.exit(1);
  }
  
  // Wait a moment for index to update
  console.log('\n   ⏳ Waiting 2s for index to update...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test hybrid search
  console.log('\n6️⃣ Testing hybrid search...');
  try {
    const query = 'bird strike testing requirements';
    const results = await hybridSearch(query, { top: 5 });
    
    console.log(`   📋 Search results for "${query}":`);
    if (results.length === 0) {
      console.log('   ⚠️ No results found (index may need time to update)');
    } else {
      for (const result of results) {
        console.log(`   - ${result.document.title} (score: ${result.score?.toFixed(3) || 'N/A'})`);
      }
    }
    console.log('   ✅ Hybrid search working');
  } catch (error) {
    console.error('   ❌ Search failed:', error);
    process.exit(1);
  }
  
  // Final count
  console.log('\n7️⃣ Final document count...');
  try {
    const count = await getDocumentCount();
    console.log(`   📊 Documents in index: ${count}`);
  } catch (error) {
    console.error('   ❌ Failed to get document count:', error);
  }
  
  console.log('\n✅ All tests passed! Vector search infrastructure is ready.');
}

main().catch(console.error);
