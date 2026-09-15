/**
 * Anthropic API endpoint utilities.
 *
 * @module dsh-llm-pi-ai/anthropic-endpoint
 */

/**
 * Extract the Anthropic API root from a configured baseURL.
 *
 * Anthropic's model listing endpoint is at `{root}/v1/models`, where the root
 * may be `https://api.anthropic.com` or a compatible gateway. Users may
 * configure either the bare root or a path like `{root}/v1`; this function
 * normalizes to the root so the caller can append the versioned model path.
 *
 * @param baseURL - The configured base URL, which may or may not include /v1
 * @returns The API root without trailing /v1
 */
export function anthropicApiRoot(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  // Remove /v1 suffix if present
  return trimmed.replace(/\/v1$/, '')
}
