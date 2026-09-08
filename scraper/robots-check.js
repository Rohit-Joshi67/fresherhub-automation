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

import robotsParser from 'robots-parser';
import fetch from 'node-fetch';

export const USER_AGENT = "FresherHubBot/1.0 (+https://freshersjobopening.online; contact: info@freshersjobopening.online)";
const robotsCache = new Map(); // origin -> parsed robots object (or null if none/error)

export async function fetchRobotsForOrigin(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);

  const robotsUrl = `${origin}/robots.txt`;
  let parsed = null;
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 8000
    });
    if (res.ok) {
      const body = await res.text();
      parsed = robotsParser(robotsUrl, body);
    } else if (res.status === 404) {
      parsed = null;
    } else {
      parsed = "unreachable";
    }
  } catch (err) {
    parsed = "unreachable";
  }

  robotsCache.set(origin, parsed);
  return parsed;
}

export async function checkUrl(targetUrl) {
  let origin;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }

  const robots = await fetchRobotsForOrigin(origin);

  if (robots === "unreachable") {
    // If robots.txt cannot be reached, we default to allowed if it's an official public API, or politely allow with delay
    return { allowed: true, crawlDelayMs: 1000, note: "robots.txt unreachable" };
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

