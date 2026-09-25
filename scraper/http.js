/**
 * http.js — shared HTTP helper for the scraper.
 *
 * Uses Node's native fetch. In sandboxed environments where outbound traffic
 * must go through an egress proxy, native fetch honors the proxy env vars
 * (HTTP_PROXY / HTTPS_PROXY) when NODE_USE_ENV_PROXY=1 — node-fetch does not,
 * and direct connections to some hosts blackhole there. All requests carry
 * the bot user-agent and a hard timeout via AbortSignal.
 */

export const USER_AGENT =
  "FresherHubBot/1.0 (+https://freshersjobopening.online; contact: info@freshersjobopening.online)";

/** Plain fetch with bot UA + hard timeout. Caller checks res.ok. */
export async function fetchWithTimeout(url, { timeoutMs = 15000, headers = {} } = {}) {
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });
}

/**
 * Read a response body with a hard byte cap, so a misbehaving endpoint can
 * never blow up memory. Throws when the cap is exceeded or the status is
 * not OK.
 */
export async function fetchTextCapped(url, { timeoutMs = 15000, maxBytes = 5_000_000, headers = {} } = {}) {
  const res = await fetchWithTimeout(url, { timeoutMs, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`response exceeded ${maxBytes} bytes for ${url}`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Same as fetchTextCapped but parses JSON. */
export async function fetchJsonCapped(url, opts = {}) {
  const text = await fetchTextCapped(url, opts);
  return JSON.parse(text);
}
