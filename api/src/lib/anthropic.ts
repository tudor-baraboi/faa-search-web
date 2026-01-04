import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing Anthropic API key. Please set ANTHROPIC_API_KEY environment variable."
    );
  }

  return new Anthropic({ apiKey });
}
