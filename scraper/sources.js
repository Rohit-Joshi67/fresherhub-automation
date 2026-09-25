/**
 * sources.js — Job source registry + adapters
 * ===========================================
 * Every job source FresherHub pulls from lives here. Each source declares:
 *   { id, kind, name, checkUrl, ...kind-specific params }
 *
 * Adapter contract: fetchSourceJobs(source) -> Promise<Array<RawJob>>
 * RawJob: { title, company, location, description, applyUrl, sourceUrl,
 *           sourceName, companyUrl, publishedDate, validThrough,
 *           fromAtsLive, applyUrlLive, sector }
 *
 * HARD RULES:
 * - Only sources we are permitted to access: official public ATS APIs,
 *   public career-portal endpoints inside robots.txt Allow rules, and
 *   public listing pages the site's robots.txt explicitly allows.
 * - HireDoor's /api/* is DISALLOWED by their robots.txt -> we only read the
 *   server-rendered public HTML pages (/jobs), never their internal API.
 * - Salary figures labelled "Estimated" by a source are NOT treated as facts
 *   and are never populated into the job payload.
 */

import { checkUrl, USER_AGENT } from './robots-check.js';
import { fetchTextCapped, fetchJsonCapped, fetchWithTimeout } from './http.js';

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------
export const SOURCES = [
  // ---- Lever boards (official public postings API) ----
  { id: 'lever-paytm', kind: 'lever', name: 'Paytm', slug: 'paytm', homepage: 'https://paytm.com', checkUrl: 'https://api.lever.co/v0/postings/paytm?mode=json' },
  { id: 'lever-meesho', kind: 'lever', name: 'Meesho', slug: 'meesho', homepage: 'https://meesho.com', checkUrl: 'https://api.lever.co/v0/postings/meesho?mode=json' },
  { id: 'lever-cred', kind: 'lever', name: 'CRED', slug: 'cred', homepage: 'https://cred.club', checkUrl: 'https://api.lever.co/v0/postings/cred?mode=json' },
  { id: 'lever-fi', kind: 'lever', name: 'Fi Money', slug: 'fi', homepage: 'https://fi.money', checkUrl: 'https://api.lever.co/v0/postings/fi?mode=json' },
  { id: 'lever-zeta', kind: 'lever', name: 'Zeta', slug: 'zeta', homepage: 'https://zeta.tech', checkUrl: 'https://api.lever.co/v0/postings/zeta?mode=json' },
  { id: 'lever-coinmarketcap', kind: 'lever', name: 'CoinMarketCap', slug: 'coinmarketcap', homepage: 'https://coinmarketcap.com', checkUrl: 'https://api.lever.co/v0/postings/coinmarketcap?mode=json' },

  // ---- Greenhouse boards (official public boards API) ----
  { id: 'gh-postman', kind: 'greenhouse', name: 'Postman', slug: 'postman', homepage: 'https://postman.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/postman/jobs?content=true' },
  { id: 'gh-razorpay', kind: 'greenhouse', name: 'Razorpay', slug: 'razorpaysoftwareprivatelimited', homepage: 'https://razorpay.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs?content=true' },
  { id: 'gh-inmobi', kind: 'greenhouse', name: 'InMobi', slug: 'inmobi', homepage: 'https://inmobi.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/inmobi/jobs?content=true' },
  { id: 'gh-glance', kind: 'greenhouse', name: 'Glance', slug: 'glance', homepage: 'https://glance.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/glance/jobs?content=true' },
  { id: 'gh-groww', kind: 'greenhouse', name: 'Groww', slug: 'groww', homepage: 'https://groww.in', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true' },
  { id: 'gh-slice', kind: 'greenhouse', name: 'Slice', slug: 'slice', homepage: 'https://sliceit.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/slice/jobs?content=true' },
  { id: 'gh-stage', kind: 'greenhouse', name: 'Stage', slug: 'stage', homepage: 'https://stage.in', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/stage/jobs?content=true' },

  // ---- Keka career portals (India's largest HRMS; tenant robots.txt is
  // Disallow:/ + Allow:/careers, and every endpoint below lives under
  // /careers/. Public JSON endpoints used by Keka's own career widget.)
  { id: 'keka-10decoders', kind: 'keka', name: '10Decoders', tenant: '10decoders', checkUrl: 'https://10decoders.keka.com/careers' },
  { id: 'keka-minfy', kind: 'keka', name: 'Minfy', tenant: 'minfy', checkUrl: 'https://minfy.keka.com/careers' },
  { id: 'keka-signzy', kind: 'keka', name: 'Signzy', tenant: 'signzy', checkUrl: 'https://signzy.keka.com/careers' },
  { id: 'keka-wingify', kind: 'keka', name: 'Wingify', tenant: 'wingify', checkUrl: 'https://wingify.keka.com/careers' },
  { id: 'keka-zaggle', kind: 'keka', name: 'Zaggle', tenant: 'zaggle', checkUrl: 'https://zaggle.keka.com/careers' },
  { id: 'keka-inito', kind: 'keka', name: 'Inito', tenant: 'inito', checkUrl: 'https://inito.keka.com/careers' },

  // ---- HireDoor (public server-rendered listing pages; robots.txt allows
  // /jobs and /latest-jobs, disallows /api/* -> HTML only, 3 pages max)
  { id: 'hiredoor', kind: 'hiredoor', name: 'HireDoor', pages: 5, maxJobs: 40, checkUrl: 'https://hiredoor.in/jobs' }
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripHtml(html) {
  return decodeEntities(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export function unique(arr) {
  return [...new Set(arr)];
}

// India location matching
export function isIndiaLocation(locationStr) {
  if (!locationStr) return true; // many remote/unspecified postings are open to India
  const loc = locationStr.toLowerCase();
  const indiaKeywords = [
    'india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'gurgaon', 'gurugram',
    'noida', 'delhi', 'mumbai', 'chennai', 'kolkata', 'kochi', 'remote', 'ahmedabad'
  ];
  return indiaKeywords.some((k) => loc.includes(k));
}

// Fresher role title heuristics (pre-filter; the content engine classifies
// with evidence as the authority)
export function isFresherEligible(title) {
  const t = (title || '').toLowerCase();
  const excludeWords = [
    'vice president', 'director', 'manager', 'head', 'lead', 'staff',
    'senior', 'sr.', 'principal', 'architect', 'specialist iii', ' ii ', ' iii ', ' iv '
  ];
  if (excludeWords.some((w) => t.includes(w))) return false;
  const fresherWords = [
    'fresher', 'graduate', 'intern', 'trainee', 'analyst', 'associate',
    'junior', 'entry', 'sde 1', 'sde-1', 'sde i', 'engineer 1', 'engineer i',
    'qa engineer', 'software engineer', 'developer', 'operations', 'support',
    'specialist', 'apprentice', 'fellow', 'consultant', '0-1', '0 - 1', '0–1'
  ];
  return fresherWords.some((w) => t.includes(w));
}

/** Parse an experience string like "4 to 5 years" / "0-1 years" -> max years, or null. */
export function parseMaxYears(expStr) {
  if (!expStr) return null;
  const nums = String(expStr).match(/\d+/g);
  if (!nums) return null;
  return Math.max(...nums.map(Number));
}

async function fetchJson(url, timeoutMs = 12000) {
  return fetchJsonCapped(url, { timeoutMs });
}

async function fetchText(url, timeoutMs = 15000) {
  return fetchTextCapped(url, { timeoutMs });
}

// ---------------------------------------------------------------------------
// Lever adapter
// ---------------------------------------------------------------------------
async function fetchLever(src) {
  const apiUrl = `https://api.lever.co/v0/postings/${src.slug}?mode=json`;
  let items;
  try {
    items = await fetchJson(apiUrl, 10000);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const jobs = [];
  for (const j of items) {
    const locName = j.categories?.location || 'India';
    if (!isIndiaLocation(locName) || !isFresherEligible(j.text)) continue;
    jobs.push({
      title: (j.text || '').trim(),
      company: src.name,
      location: locName.trim(),
      applyUrl: j.hostedUrl || '',
      description: stripHtml(j.descriptionPlain || '') || j.text,
      sector: 'private',
      sourceUrl: apiUrl,
      sourceName: 'Lever ATS',
      companyUrl: src.homepage,
      fromAtsLive: true,
      publishedDate: j.createdAt ? new Date(j.createdAt).toISOString().split('T')[0] : ''
    });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Greenhouse adapter
// ---------------------------------------------------------------------------
async function fetchGreenhouse(src) {
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${src.slug}/jobs?content=true`;
  let data;
  try {
    data = await fetchJson(apiUrl, 10000);
  } catch {
    return [];
  }
  const items = data.jobs || [];
  const jobs = [];
  for (const j of items) {
    const locName = j.location?.name || 'India';
    if (!isIndiaLocation(locName) || !isFresherEligible(j.title)) continue;
    jobs.push({
      title: (j.title || '').trim(),
      company: src.name,
      location: locName.trim(),
      applyUrl: j.absolute_url || '',
      description: stripHtml(j.content || '') || j.title,
      sector: 'private',
      sourceUrl: apiUrl,
      sourceName: 'Greenhouse ATS',
      companyUrl: src.homepage,
      fromAtsLive: true,
      publishedDate: j.updated_at ? String(j.updated_at).split('T')[0] : ''
    });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Keka adapter — public career-portal JSON endpoints
// ---------------------------------------------------------------------------
function kekaLocation(jobLocations) {
  if (!Array.isArray(jobLocations) || jobLocations.length === 0) return 'India';
  const parts = jobLocations.map((l) => {
    const name = (l.name || '').trim();
    if (/remote/i.test(name)) return 'Remote';
    const city = (l.city || '').trim();
    if (city && city !== '.') return city;
    return name || 'India';
  });
  return unique(parts.filter(Boolean)).join(', ') || 'India';
}

/** Keka gives an explicit `experience` field — use it as the pre-filter. */
export function kekaFresherEligible(job) {
  const maxYears = parseMaxYears(job.experience);
  if (maxYears !== null) return maxYears <= 2;
  // No explicit experience: fall back to title heuristics + internship signal
  const text = `${job.title || ''} ${job.excerpt || ''}`.toLowerCase();
  if (/\bintern(ship)?\b|\btrainee\b|\bapprentice\b/.test(text)) return true;
  return isFresherEligible(job.title);
}

/** Normalize one Keka API job record into a RawJob. Exported for tests. */
export function normalizeKekaJob(j, src, usedEndpoint) {
  const base = `https://${src.tenant}.keka.com`;
  const location = kekaLocation(j.jobLocations);
  const descParts = [stripHtml(j.description || ''), stripHtml(j.excerpt || '')].filter(Boolean);
  if (j.experience) descParts.push(`Experience required: ${j.experience}.`);
  if (j.jobType === 2) descParts.push('Employment type: Full-time.');
  return {
    title: String(j.title).trim(),
    company: src.name,
    location,
    applyUrl: `${base}/careers/jobdetails/${j.id}`,
    description: unique(descParts).join('\n'),
    sector: 'private',
    sourceUrl: usedEndpoint,
    sourceName: 'Keka ATS',
    companyUrl: `${base}/careers`,
    fromAtsLive: true,
    publishedDate: j.publishedOn ? String(j.publishedOn).split('T')[0] : ''
  };
}

async function fetchKeka(src) {
  const base = `https://${src.tenant}.keka.com`;
  const endpoints = [
    `${base}/careers/api/jobs/default/active`,
    `${base}/careers/api/embedjobs/default/active/`
  ];
  let items = null;
  let usedEndpoint = '';
  for (const ep of endpoints) {
    try {
      const data = await fetchJson(ep, 12000);
      if (Array.isArray(data) && data.length > 0) {
        items = data;
        usedEndpoint = ep;
        break;
      }
    } catch {
      /* try next endpoint */
    }
  }
  if (!items) return [];

  const jobs = [];
  for (const j of items) {
    if (!j || !j.title) continue;
    if (!kekaFresherEligible(j)) continue;
    const job = normalizeKekaJob(j, src, usedEndpoint);
    if (!isIndiaLocation(job.location)) continue;
    jobs.push(job);
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// HireDoor adapter — server-rendered public listing pages only
// (robots.txt allows /jobs; /api/* is disallowed and never touched)
// ---------------------------------------------------------------------------
// Job detail hrefs look like /jobs/sde-intern-47f90d or /jobs/ai-engineering-intern-ppo--caf8a5
// (one or two dashes before the trailing id). Location hubs (/jobs/bangalore)
// never have that trailing -id segment, so they are excluded naturally.
const HIREDOOR_JOB_HREF_RE = /\/jobs\/[A-Za-z0-9][A-Za-z0-9_-]*-{1,2}[A-Za-z0-9]{4,10}/g;

/** Exported for tests. */
export function extractHiredoorHrefs(listHtml) {
  const hrefs = new Set();
  let m;
  HIREDOOR_JOB_HREF_RE.lastIndex = 0;
  while ((m = HIREDOOR_JOB_HREF_RE.exec(listHtml)) !== null) {
    hrefs.add(m[0]);
  }
  return [...hrefs];
}

/** Pull the schema.org JobPosting block out of a detail page. Exported for tests. */
export function extractJobPostingJsonLd(detailHtml) {
  const blocks = detailHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    const inner = b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try {
      const parsed = JSON.parse(inner);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        if (c && c['@type'] === 'JobPosting') return c;
      }
      // @graph wrapper
      if (parsed && Array.isArray(parsed['@graph'])) {
        for (const c of parsed['@graph']) {
          if (c && c['@type'] === 'JobPosting') return c;
        }
      }
    } catch {
      /* not parseable — keep looking */
    }
  }
  return null;
}

/** Official outbound application link embedded in the page's flight data. Exported for tests. */
export function extractHiredoorApplyLink(detailHtml) {
  const m = detailHtml.match(/applicationLink\\?":\\?"(https?:\/\/[^"\\]+)/);
  if (m) return m[1];
  const m2 = detailHtml.match(/applicationLink":"(https?:[^"]+)"/);
  return m2 ? m2[1] : '';
}

function hiredoorLocations(jobPosting) {
  const locs = jobPosting.jobLocation;
  if (!Array.isArray(locs) || locs.length === 0) return '';
  const all = locs
    .map((l) => (l.address && (l.address.addressLocality || l.address.addressRegion)) || '')
    .map((s) => String(s).trim())
    .filter(Boolean);
  // Prefer specific cities; fall back to whatever the posting lists.
  // Never fall back to "India" — an unstated location stays unstated.
  const specific = all.filter((s) => !/^india$/i.test(s) && !/multiple locations/i.test(s));
  const use = specific.length ? specific : all;
  return unique(use).join(', ');
}

/** Normalize a parsed JobPosting (+ apply link) into a RawJob. Exported for tests. */
export function normalizeHiredoorJob(jp, applyLink, pageUrl) {
  const company = (jp.hiringOrganization && jp.hiringOrganization.name) || '';
  const descParts = [stripHtml(jp.description || '')];
  if (jp.experienceRequirements) descParts.push(`Experience: ${stripHtml(String(jp.experienceRequirements))}.`);
  if (jp.employmentType) descParts.push(`Employment type: ${stripHtml(String(jp.employmentType))}.`);
  if (jp.skills) descParts.push(`Skills: ${stripHtml(String(jp.skills))}.`);
  return {
    title: String(jp.title).trim(),
    company: company.trim(),
    location: hiredoorLocations(jp),
    applyUrl: applyLink || '',
    description: unique(descParts.filter(Boolean)).join('\n'),
    sector: 'private',
    sourceUrl: pageUrl,
    sourceName: 'HireDoor',
    companyUrl: '',
    fromAtsLive: false,
    applyUrlLive: false, // set by the liveness probe in fetchHiredoorDetail —
    // HireDoor's own "Verified" label is a discovery signal, never proof
    // that the posting is currently open.
    publishedDate: jp.datePosted ? String(jp.datePosted).split('T')[0] : '',
    validThrough: jp.validThrough ? String(jp.validThrough) : ''
    // NOTE: baseSalary is intentionally NOT consumed — HireDoor labels it
    // "(Estimated)", and estimates are never presented as facts.
  };
}

/**
 * Liveness probe for a HireDoor-extracted external application link.
 * A single cheap request (robots-checked first, body discarded): a reachable
 * application page is genuine evidence the posting is still live, which is
 * more than the source's own "Verified" label can tell us.
 */
async function probeUrlLive(url) {
  try {
    const robots = await checkUrl(url);
    if (!robots.allowed) return false;
    const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
    try { if (res.body) await res.body.cancel(); } catch { /* ignore */ }
    return res.status < 400;
  } catch {
    return false;
  }
}

async function fetchHiredoorDetail(pageUrl) {
  let html;
  try {
    html = await fetchText(pageUrl, 15000);
  } catch {
    return null;
  }
  const jp = extractJobPostingJsonLd(html);
  if (!jp || !jp.title) return null;
  const company = (jp.hiringOrganization && jp.hiringOrganization.name) || '';
  if (!company) return null;
  const applyLink = extractHiredoorApplyLink(html);
  const job = normalizeHiredoorJob(jp, applyLink, pageUrl);
  job.applyUrlLive = applyLink ? await probeUrlLive(applyLink) : false;
  return job;
}

async function fetchHiredoor(src) {
  const hrefs = [];
  const seen = new Set();
  const pages = Math.max(1, Math.min(src.pages || 3, 8));
  for (let page = 1; page <= pages; page++) {
    const url = `https://hiredoor.in/jobs${page > 1 ? `?page=${page}` : ''}`;
    let html;
    try {
      html = await fetchText(url, 15000);
    } catch (e) {
      console.warn(`[HireDoor] listing page ${page} failed: ${e.message}`);
      break;
    }
    let added = 0;
    for (const h of extractHiredoorHrefs(html)) {
      if (!seen.has(h)) {
        seen.add(h);
        hrefs.push(h);
        added++;
      }
    }
    if (added === 0) break; // no new jobs -> stop paginating
    await sleep(700);
  }

  const jobs = [];
  const maxJobs = Math.min(src.maxJobs || 24, hrefs.length);
  for (let i = 0; i < maxJobs; i++) {
    const pageUrl = `https://hiredoor.in${hrefs[i]}`;
    try {
      const job = await fetchHiredoorDetail(pageUrl);
      if (job) jobs.push(job);
    } catch (e) {
      console.warn(`[HireDoor] detail failed ${hrefs[i]}: ${e.message}`);
    }
    await sleep(700); // polite pacing between detail pages
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
const ADAPTERS = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  keka: fetchKeka,
  hiredoor: fetchHiredoor
};

/**
 * Fetch raw jobs for one source (robots.txt already checked by the caller).
 * Never throws — returns [] on failure so one bad source can't kill the run.
 */
export async function fetchSourceJobs(source) {
  const adapter = ADAPTERS[source.kind];
  if (!adapter) {
    console.warn(`[Sources] unknown kind "${source.kind}" for ${source.id} — skipping`);
    return [];
  }
  try {
    const jobs = await adapter(source);
    console.log(`[Sources] ${source.name} (${source.kind}): ${jobs.length} fresher-candidate jobs`);
    return jobs;
  } catch (err) {
    console.warn(`[Sources] ${source.name} failed: ${err.message}`);
    return [];
  }
}

export { checkUrl };
