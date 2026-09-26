/**
 * generate-articles.js — interview prep guides, one per published job.
 *
 * Runs at the end of the scheduled scrape. For each published job that does
 * not yet have a guide, drafts one with Gemini and saves it as a static page
 * under docs/guides/<job-slug>-interview-prep.html, plus a guides index.
 *
 * STRICT RULES (same as the rest of the pipeline):
 * - Only facts from the verified job posting may appear as facts.
 * - Prep topics/skills are derived from the posting's own skills/description;
 *   anything generic is explicitly labeled general guidance, never presented
 *   as the company's actual process.
 * - AI output is schema-validated, length-capped, URL-stripped, and every
 *   value is HTML-escaped at render. A bad draft is discarded, never patched
 *   with guesses.
 * - No API key -> skip quietly (production sets GEMINI_API_KEY in secrets).
 */

import fs from 'fs';
import path from 'path';
import { AD_DIRECT_URL, AD_POP_SCRIPTS, AD_NATIVE, AD_BANNER_468 } from './templates.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Only http(s) URLs with a real host are allowed into href attributes. */
function escUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\/[^/\s]+\.[a-z]{2,}/i.test(s)) return '';
  if (/example\.com|placeholder|todo/i.test(s)) return '';
  return esc(s);
}

/** Strip any URLs the model may have invented and collapse whitespace. */
const cleanAi = (s) => String(s || '')
  .replace(/https?:\/\/\S+/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 220);

// ---------------------------------------------------------------------------
// Gemini client (lazy — only needed when GEMINI_API_KEY is present)
// ---------------------------------------------------------------------------
let aiClient = null;
let aiInitAttempted = false;

function loadEnvKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPaths = [path.resolve('.env'), path.resolve('../.env'), path.resolve('scraper/.env')];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf8').match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
      if (m && m[1]) return m[1].trim();
    }
  }
  return null;
}

async function getAiClient() {
  if (aiInitAttempted) return aiClient;
  aiInitAttempted = true;
  const key = loadEnvKey();
  if (!key) return null;
  try {
    const { GoogleGenAI } = await import('@google/genai');
    aiClient = new GoogleGenAI({ apiKey: key });
  } catch (e) {
    console.warn('[guides] Gemini unavailable:', e.message);
    aiClient = null;
  }
  return aiClient;
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------
function factsFor(job) {
  const about = String(job.about || job.description || '').slice(0, 2500);
  return {
    company: String(job.company || job.org || 'Not specified').slice(0, 80),
    title: String(job.title || 'Not specified').slice(0, 80),
    location: String(job.location || 'Not specified').slice(0, 80),
    salary: String(job.salary || 'Not specified').slice(0, 80),
    batch: String(job.batch || 'Not specified').slice(0, 80),
    description: about
  };
}

async function draftGuide(ai, facts) {
  const prompt = `You write interview-prep guides for Indian freshers (0-2 years experience).

STRICT RULES — violating any of these fails the task:
- Use ONLY the facts below. Never invent salary, batch, vacancies, dates, interview rounds, or company claims.
- "skills_to_prepare" and "interview_topics": derive from the posting's skills and description. Foundational topics for this role type are allowed, phrased generically.
- No URLs, no contact info, no promotional claims.
- Return ONLY a JSON object with exactly these keys:
  {"overview": "2-3 sentences on what this role typically involves, grounded in the posting",
   "what_the_role_involves": ["3-6 bullets, each under 140 chars"],
   "skills_to_prepare": ["3-6 bullets, each under 140 chars"],
   "interview_topics": ["3-6 bullets, each under 140 chars"],
   "application_checklist": ["3-5 bullets, each under 140 chars"]}
- Every bullet under 140 characters. Plain text only.

FACTS FROM THE VERIFIED JOB POSTING:
Company: ${facts.company}
Title: ${facts.title}
Location: ${facts.location}
Salary (as stated in posting): ${facts.salary}
Eligible batch (as stated): ${facts.batch}
Posting description:
${facts.description}`;

  const resp = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    contents: [{ text: prompt }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 1200 }
  });
  const data = JSON.parse(resp.text);
  for (const k of ['overview', 'what_the_role_involves', 'skills_to_prepare', 'interview_topics', 'application_checklist']) {
    if (data[k] === undefined) throw new Error(`missing key ${k}`);
  }
  const arr = (v) => (Array.isArray(v) ? v : []).map(cleanAi).filter(Boolean).slice(0, 6);
  const guide = {
    overview: cleanAi(data.overview).slice(0, 600),
    what_the_role_involves: arr(data.what_the_role_involves),
    skills_to_prepare: arr(data.skills_to_prepare),
    interview_topics: arr(data.interview_topics),
    application_checklist: arr(data.application_checklist)
  };
  if (!guide.overview || guide.skills_to_prepare.length < 2 || guide.interview_topics.length < 2) {
    throw new Error('draft too thin, discarding');
  }
  return guide;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
export function renderGuidePage({ job, jobSlug, facts, guide }) {
  const applyUrl = escUrl(job.applyUrl);
  const jobPageUrl = `/docs/jobs/${esc(jobSlug)}.html`;
  const section = (title, items) => `
      <section class="guide-section">
        <h2>${esc(title)}</h2>
        <ul>${items.map((i) => `<li>${esc(String(i || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim())}</li>`).join('')}</ul>
      </section>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(facts.title)} Interview Prep Guide — ${esc(facts.company)} | FresherHub</title>
<meta name="description" content="How to prepare for the ${esc(facts.title)} role at ${esc(facts.company)}: skills, interview topics and application checklist for freshers.">
<style>
  :root { --accent-green: #22c55e; --ink: #0f172a; --muted: #64748b; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; color: var(--ink); background: #f8fafc; }
  .site-nav { display: flex; align-items: center; gap: 24px; padding: 14px 24px; background: #0f172a; color: #fff; }
  .site-nav a { color: #cbd5e1; text-decoration: none; font-size: 14px; }
  .site-nav a.brand { color: #fff; font-weight: 700; font-size: 18px; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 30px; margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: 14px; margin-bottom: 20px; }
  .notice { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #92400e; margin-bottom: 24px; }
  .guide-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; margin-bottom: 18px; }
  .guide-section h2 { font-size: 18px; margin: 0 0 12px; }
  .guide-section ul { margin: 0; padding-left: 20px; }
  .guide-section li { margin-bottom: 8px; line-height: 1.55; font-size: 15px; }
  .cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  .btn { display: inline-block; padding: 12px 22px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px; }
  .btn-primary { background: var(--accent-green); color: #fff; }
  .btn-ghost { background: #fff; color: var(--ink); border: 1px solid #e2e8f0; }
  .btn-sponsored { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
  .foot { margin-top: 36px; font-size: 12px; color: var(--muted); line-height: 1.6; }
  .ad-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; text-align: center; margin-bottom: 6px; }
  .ad-native-wrap { margin: 26px 0; padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
  .ad-banner-wrap { display: flex; justify-content: center; margin: 28px auto; padding: 0 12px; max-width: 100%; overflow: hidden; }
  .ad-banner-inner { max-width: 100%; }
</style>
</head>
<body>
  <header class="site-nav">
    <a class="brand" href="/">FresherHub</a>
    <a href="/">Job Openings</a>
    <a href="/guides/">Prep Guides</a>
  </header>
  <div class="wrap">
    <h1>${esc(facts.title)} — Interview Prep Guide</h1>
    <div class="meta">${esc(facts.company)} &bull; ${esc(facts.location)} &bull; Salary: ${esc(facts.salary)}</div>
    <div class="notice"><strong>How to read this guide:</strong> role facts come from the official job posting. Prep topics are general guidance for this kind of role — they are not the company's actual interview rounds.</div>
    <section class="guide-section">
      <h2>Role overview</h2>
      <p style="line-height:1.65;font-size:15px;margin:0;">${esc(guide.overview)}</p>
    </section>
    ${section('What the role involves', guide.what_the_role_involves)}
    ${section('Skills to prepare', guide.skills_to_prepare)}
    ${section('Interview topics to cover', guide.interview_topics)}
    ${section('Application checklist', guide.application_checklist)}
    ${AD_NATIVE}
    <div class="cta-row">
      <a class="btn btn-ghost" href="${jobPageUrl}">View job details</a>
      ${applyUrl ? `<a class="btn btn-primary" href="${applyUrl}" target="_blank" rel="noopener">Apply on official site</a>` : ''}
      <a class="btn btn-sponsored" href="${AD_DIRECT_URL}" target="_blank" rel="sponsored noopener noreferrer">Sponsored: Upskill Resources &rarr;</a>
    </div>
    ${AD_BANNER_468}
    <div class="foot">Guide generated from the verified job posting on FresherHub. Always confirm details on the official application page before applying.</div>
  </div>
${AD_POP_SCRIPTS}
</body>
</html>`;
}

export function renderGuidesIndex(guides) {
  const cards = guides.map((g) => `
      <a class="g-card" href="/guides/${esc(g.file)}">
        <div class="g-title">${esc(g.title)}</div>
        <div class="g-meta">${esc(g.company)} &bull; ${esc(g.location)}</div>
      </a>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Interview Prep Guides for Freshers | FresherHub</title>
<meta name="description" content="Role-specific interview preparation guides for fresher job openings across India.">
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; color: #0f172a; background: #f8fafc; }
  .site-nav { display: flex; align-items: center; gap: 24px; padding: 14px 24px; background: #0f172a; color: #fff; }
  .site-nav a { color: #cbd5e1; text-decoration: none; font-size: 14px; }
  .site-nav a.brand { color: #fff; font-weight: 700; font-size: 18px; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  .sub { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .g-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; text-decoration: none; color: inherit; }
  .g-card:hover { border-color: #22c55e; }
  .g-title { font-weight: 600; font-size: 15px; margin-bottom: 6px; }
  .g-meta { font-size: 13px; color: #64748b; }
  .ad-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; text-align: center; margin-bottom: 6px; }
  .ad-native-wrap { margin: 26px 0; padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
  .ad-banner-wrap { display: flex; justify-content: center; margin: 24px auto; padding: 0 12px; max-width: 100%; overflow: hidden; }
  .ad-banner-inner { max-width: 100%; }
  .sponsored-strip { text-align: center; margin: 22px 0; }
  .sponsored-strip a { display: inline-block; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-size: 13px; font-weight: 600; padding: 9px 20px; border-radius: 999px; text-decoration: none; }
</style>
</head>
<body>
  <header class="site-nav">
    <a class="brand" href="/">FresherHub</a>
    <a href="/">Job Openings</a>
    <a href="/guides/">Prep Guides</a>
  </header>
  <div class="wrap">
    <h1>Interview Prep Guides</h1>
    <div class="sub">${guides.length} role-specific guides for current fresher openings. Built from verified job postings.</div>
    ${AD_BANNER_468}
    <div class="grid">${cards || '<p>No guides yet — check back soon.</p>'}</div>
    ${AD_NATIVE}
    <div class="sponsored-strip"><a href="${AD_DIRECT_URL}" target="_blank" rel="sponsored noopener noreferrer">Sponsored: Upskill Resources &rarr;</a></div>
  </div>
${AD_POP_SCRIPTS}
</body>
</html>`;
}

function rebuildIndex(guidesDir, jobs) {
  const guides = [];
  for (const f of fs.readdirSync(guidesDir)) {
    if (!f.endsWith('-interview-prep.html')) continue;
    const jobSlug = f.replace(/-interview-prep\.html$/, '');
    const job = jobs.find((j) => String(j.slug || '').includes(jobSlug)) || {};
    guides.push({
      file: f,
      title: `${job.title || jobSlug} — Interview Prep Guide`,
      company: job.company || job.org || '',
      location: job.location || ''
    });
  }
  guides.sort((a, b) => a.title.localeCompare(b.title));
  fs.writeFileSync(path.join(guidesDir, 'index.html'), renderGuidesIndex(guides), 'utf8');
  return guides.length;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {Array} opts.jobs - published feed entries (company, title, location, salary, slug, applyUrl, about)
 * @param {string} opts.repoRoot - repo root
 * @param {number} [opts.maxPerRun=20]
 * @returns {Promise<number>} guides created this run
 */
export async function generateArticles({ jobs, repoRoot, maxPerRun = 20 }) {
  const guidesDir = path.join(repoRoot, 'docs', 'guides');
  fs.mkdirSync(guidesDir, { recursive: true });

  const ai = await getAiClient();
  if (!ai) {
    console.log('[guides] no GEMINI_API_KEY — skipping article generation');
    rebuildIndex(guidesDir, jobs);
    return 0;
  }

  let created = 0;
  for (const job of jobs) {
    if (created >= maxPerRun) break;
    const jobSlug = String(job.slug || '').replace('/docs/jobs/', '').replace(/\.html$/, '') || String(job.id || '');
    if (!jobSlug) continue;
    const file = `${jobSlug}-interview-prep.html`;
    const outPath = path.join(guidesDir, file);
    if (fs.existsSync(outPath)) continue;
    const facts = factsFor(job);
    if (!facts.description || facts.description.length < 80) continue; // nothing to ground the guide in
    try {
      const guide = await draftGuide(ai, facts);
      fs.writeFileSync(outPath, renderGuidePage({ job, jobSlug, facts, guide }), 'utf8');
      created++;
      console.log(`[guides] created ${file}`);
    } catch (e) {
      console.warn(`[guides] ${jobSlug} failed: ${e.message}`);
    }
  }

  // Rebuild the index from every guide on disk (self-healing).
  rebuildIndex(guidesDir, jobs);

  return created;
}
