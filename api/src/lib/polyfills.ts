// Polyfill for crypto in Azure Functions environment
// Azure Static Web Apps may bundle functions in a way that doesn't include Node.js globals

if (typeof globalThis.crypto === "undefined") {
  try {
    const nodeCrypto = require("crypto");
    if (nodeCrypto.webcrypto) {
      (globalThis as any).crypto = nodeCrypto.webcrypto;
    } else {
      // Fallback for older Node versions
      (globalThis as any).crypto = nodeCrypto;
    }
  } catch (error) {
    console.error("Failed to polyfill crypto:", error);
  }
}

export {};
