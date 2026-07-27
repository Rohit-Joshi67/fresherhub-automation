// robots-check.js
// Fetches and caches robots.txt for each domain, and answers two questions
// before the scraper is allowed to touch a page:
//   1. isAllowed(url)      — does robots.txt permit our bot on this path?
//   2. getCrawlDelay(url)  — does the site ask for a minimum delay between
//                            requests, and if so, how long?
//
// If a site's robots.txt disallows us, or if it can't be reached at all
// in a way that suggests the site is actively blocking bots, we skip that
// site entirely rather than guess. No source is worth risking your site's
// (or IP's) reputation over.

const robotsParser = require("robots-parser");

const USER_AGENT = "FresherHubBot";
const robotsCache = new Map(); // origin -> parsed robots object (or null if none/error)

async function fetchRobotsForOrigin(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);

  const robotsUrl = `${origin}/robots.txt`;
  let parsed = null;
  try {
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const body = await res.text();
      parsed = robotsParser(robotsUrl, body);
    } else if (res.status === 404) {
      // No robots.txt at all = no crawling restrictions stated. Standard,
      // widely-accepted interpretation: treat as allowed.
      parsed = null;
    } else {
      // Any other status (403, 500, etc.) — be conservative and treat
      // this origin as "could not confirm we're allowed," which the
      // caller treats as disallowed.
      parsed = "unreachable";
    }
  } catch (err) {
    parsed = "unreachable";
  }

  robotsCache.set(origin, parsed);
  return parsed;
}

async function checkUrl(targetUrl) {
  let origin;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }

  const robots = await fetchRobotsForOrigin(origin);

  if (robots === "unreachable") {
    return { allowed: false, reason: "could not verify robots.txt (site unreachable or blocking requests)" };
  }
  if (robots === null) {
    return { allowed: true, crawlDelayMs: 0 };
  }

  const allowed = robots.isAllowed(targetUrl, USER_AGENT);
  if (allowed === false) {
    return { allowed: false, reason: "disallowed by robots.txt" };
  }

  const crawlDelaySec = robots.getCrawlDelay(USER_AGENT) || 0;
  return { allowed: true, crawlDelayMs: crawlDelaySec * 1000 };
}

module.exports = { checkUrl, USER_AGENT };
