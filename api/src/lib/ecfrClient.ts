/**
 * eCFR Client
 * Fetches Code of Federal Regulations from the official eCFR API
 * https://www.ecfr.gov/api/
 */

/**
 * eCFR Section content
 */
export interface ECFRSection {
  title: number;
  part: number;
  section: string;
  sectionTitle: string;
  content: string;
  effectiveDate: string;
  source: 'ecfr';
  url: string;  // Direct link to eCFR
}

/**
 * eCFR Structure node (for discovering sections)
 */
export interface ECFRStructureNode {
  type: string;
  identifier: string;
  label: string;
  label_level: string;
  label_description: string;
  children?: ECFRStructureNode[];
}

/**
 * Client for the eCFR API
 * Fetches authoritative CFR text on-demand
 */
export class ECFRClient {
  private baseURL = 'https://www.ecfr.gov/api';
  private latestDateCache: Map<number, string> = new Map();
  
  /**
   * Get the latest available date for a title from eCFR API
   */
  private async getLatestDate(title: number): Promise<string> {
    // Check cache first
    const cached = this.latestDateCache.get(title);
    if (cached) {
      return cached;
    }
    
    try {
      const response = await fetch(`${this.baseURL}/versioner/v1/titles.json`);
      if (response.ok) {
        const data = await response.json();
        const titleInfo = data.titles?.find((t: any) => t.number === title);
        if (titleInfo?.up_to_date_as_of) {
          this.latestDateCache.set(title, titleInfo.up_to_date_as_of);
          return titleInfo.up_to_date_as_of;
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch eCFR titles, using fallback date');
    }
    
    // Fallback: use a known safe date (first of current month)
    const now = new Date();
    const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return fallbackDate;
  }
  
  /**
   * Fetch a specific CFR section
   * 
   * @param title - CFR title (14 for aviation)
   * @param part - Part number (23, 25, 33, etc.)
   * @param section - Section number (e.g., "2150" for § 23.2150)
   * @returns Section content or null if not found
   */
  async fetchSection(title: number, part: number, section: string): Promise<ECFRSection | null> {
    const fullSection = `${part}.${section}`;
    console.log(`🌐 Fetching eCFR: Title ${title}, § ${fullSection}`);
    
    try {
      // Get the latest available date for this title
      const date = await this.getLatestDate(title);
      
      // Fetch section content via XML endpoint with part and section params
      const url = `${this.baseURL}/versioner/v1/full/${date}/title-${title}.xml?part=${part}&section=${fullSection}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/xml'
        }
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`⚠️  eCFR section not found: § ${fullSection}`);
          return null;
        }
        // Log more details for debugging
        const errorText = await response.text().catch(() => 'No error body');
        console.error(`❌ eCFR API error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`);
        return null;
      }
      
      const xmlText = await response.text();
      
      // Check if it's an error response
      if (xmlText.includes('<error>') || xmlText.includes('"error"')) {
        console.log(`⚠️  eCFR returned error for § ${fullSection}`);
        return null;
      }
      
      // Extract text content from XML
      const content = this.extractTextFromXML(xmlText);
      const sectionTitle = this.extractSectionTitleFromXML(xmlText);
      
      if (!content) {
        console.log(`⚠️  No content found for § ${fullSection}`);
        return null;
      }
      
      console.log(`✅ eCFR fetched: § ${fullSection} (${content.length} chars)`);
      
      return {
        title,
        part,
        section,
        sectionTitle: sectionTitle || `§ ${fullSection}`,
        content,
        effectiveDate: date,
        source: 'ecfr',
        url: `https://www.ecfr.gov/current/title-${title}/part-${part}/section-${fullSection}`
      };
      
    } catch (error) {
      console.error(`❌ eCFR fetch error for § ${fullSection}:`, error);
      return null;
    }
  }
  
  /**
   * Extract text content from eCFR XML response
   */
  private extractTextFromXML(xml: string): string {
    // Remove XML declaration and tags, keep text content
    let text = xml
      // Remove XML declaration
      .replace(/<\?xml[^>]*\?>/g, '')
      // Remove HEAD tag but keep content for section reference
      .replace(/<HEAD>([^<]*)<\/HEAD>/g, '$1\n\n')
      // Replace P tags with newlines
      .replace(/<P>/g, '')
      .replace(/<\/P>/g, '\n\n')
      // Remove other XML tags
      .replace(/<[^>]+>/g, '')
      // Clean up whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    return text;
  }
  
  /**
   * Extract section title from eCFR XML
   */
  private extractSectionTitleFromXML(xml: string): string | null {
    const match = xml.match(/<HEAD>([^<]*)<\/HEAD>/);
    return match ? match[1].trim() : null;
  }
  
  /**
   * Fetch multiple sections in parallel
   * 
   * @param title - CFR title
   * @param sections - Array of section identifiers (e.g., ["23.2150", "23.2100"])
   * @returns Array of section contents (nulls filtered out)
   */
  async fetchSections(title: number, sections: string[]): Promise<ECFRSection[]> {
    console.log(`🌐 Fetching ${sections.length} eCFR sections...`);
    
    const results = await Promise.all(
      sections.map(async (sectionId) => {
        // Parse "23.2150" into part=23, section="2150"
        const [partStr, section] = sectionId.split('.');
        const part = parseInt(partStr, 10);
        
        if (isNaN(part) || !section) {
          console.warn(`⚠️  Invalid section format: ${sectionId}`);
          return null;
        }
        
        return this.fetchSection(title, part, section);
      })
    );
    
    // Filter out nulls
    const validResults = results.filter((r): r is ECFRSection => r !== null);
    console.log(`✅ Retrieved ${validResults.length}/${sections.length} eCFR sections`);
    
    return validResults;
  }
  
  /**
   * Get the structure (table of contents) for a part
   * Useful for discovering available sections
   * 
   * @param title - CFR title
   * @param part - Part number
   * @returns Structure tree or null
   */
  async getPartStructure(title: number, part: number): Promise<ECFRStructureNode | null> {
    console.log(`📋 Fetching eCFR structure for Title ${title}, Part ${part}`);
    
    try {
      const date = await this.getLatestDate(title);
      const url = `${this.baseURL}/versioner/v1/structure/${date}/title-${title}.json?part=${part}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.warn(`⚠️  Could not fetch structure for Part ${part}`);
        return null;
      }
      
      return response.json();
      
    } catch (error) {
      console.error(`❌ eCFR structure error:`, error);
      return null;
    }
  }
  
  /**
   * Search eCFR for relevant sections
   * 
   * @param query - Search query
   * @param title - Limit to specific title (optional)
   * @param part - Limit to specific part (optional)
   * @returns Search results
   */
  async searchSections(query: string, title?: number, part?: number): Promise<ECFRSearchResult[]> {
    console.log(`🔍 Searching eCFR for: "${query}"`);
    
    try {
      let url = `${this.baseURL}/search/v1/results?query=${encodeURIComponent(query)}&per_page=10`;
      
      if (title) {
        url += `&title=${title}`;
      }
      if (part) {
        url += `&part=${part}`;
      }
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`eCFR search error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Map results to our format
      const results: ECFRSearchResult[] = (data.results || []).map((r: any) => ({
        title: r.title,
        part: r.part,
        section: r.section,
        sectionTitle: r.section_title || r.headings?.section || '',
        snippet: r.full_text_excerpt || r.snippet || '',
        score: r.score || 0
      }));
      
      console.log(`✅ eCFR search found ${results.length} results`);
      return results;
      
    } catch (error) {
      console.error(`❌ eCFR search error:`, error);
      return [];
    }
  }
  
  /**
   * Extract text content from eCFR API response
   */
  private extractTextContent(data: any): string {
    // The eCFR API returns different structures depending on the endpoint
    // Try multiple extraction strategies
    
    if (typeof data === 'string') {
      return data;
    }
    
    if (data.content) {
      return typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
    }
    
    if (data.text) {
      return data.text;
    }
    
    if (data.full_text) {
      return data.full_text;
    }
    
    // For XML responses converted to JSON, look for nested content
    if (data.section && data.section.content) {
      return this.flattenContent(data.section.content);
    }
    
    // Fallback: stringify the whole response (for debugging)
    return JSON.stringify(data, null, 2);
  }
  
  /**
   * Extract section title from response
   */
  private extractSectionTitle(data: any): string | null {
    if (data.section_title) return data.section_title;
    if (data.headings?.section) return data.headings.section;
    if (data.section?.heading) return data.section.heading;
    return null;
  }
  
  /**
   * Flatten nested content structure into plain text
   */
  private flattenContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    
    if (Array.isArray(content)) {
      return content.map(c => this.flattenContent(c)).join('\n');
    }
    
    if (typeof content === 'object') {
      // Handle common eCFR JSON structures
      if (content.text) return content.text;
      if (content.p) return this.flattenContent(content.p);
      if (content.paragraph) return this.flattenContent(content.paragraph);
      
      // Recursively process object values
      return Object.values(content)
        .map(v => this.flattenContent(v))
        .filter(s => s)
        .join('\n');
    }
    
    return String(content);
  }
}

/**
 * Search result from eCFR
 */
export interface ECFRSearchResult {
  title: number;
  part: number;
  section: string;
  sectionTitle: string;
  snippet: string;
  score: number;
}

/**
 * Singleton instance for reuse
 */
let ecfrClientInstance: ECFRClient | null = null;

export function getECFRClient(): ECFRClient {
  if (!ecfrClientInstance) {
    ecfrClientInstance = new ECFRClient();
  }
  return ecfrClientInstance;
}
