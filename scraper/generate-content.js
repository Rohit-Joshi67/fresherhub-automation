// generate-content.js
// Second pipeline step (runs after scrape.js). Reads data/jobs.json,
// and for every job that doesn't already have AI-written content, asks
// an AI model to write:
//   1) a real article body (about the role + why it's worth applying)
//   2) a short vertical-video script: hook, body, and a CTA telling
//      viewers to comment the company name for the link
//
// Supports two providers, checked in this order:
//   1. ANTHROPIC_API_KEY  — Claude Sonnet 5, paid (a fraction of a cent
//      per posting). Use this once you're ready to pay for the best
//      quality writing.
//   2. GEMINI_API_KEY     — Google Gemini 2.5 Flash, genuinely free
//      (no credit card, no time limit — get a key at aistudio.google.com).
//      Good for testing everything end-to-end at zero cost before you
//      commit to Claude.
// If neither is set, this step is skipped entirely and the site falls
// back to the template-based content from templates.js — nothing breaks.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const JOBS_PATH = path.join(ROOT, "data", "jobs.json");
const REELS_PATH = path.join(ROOT, "data", "reel-scripts.json");

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CLAUDE_MODEL = "claude-sonnet-5";
const GEMINI_MODEL = "gemini-2.5-flash";

function buildPrompt(job) {
  return `You are writing content for a fresher job-listing website. Here is a scraped job posting:

Company: ${job.org}
Sector: ${job.sector}
Title: ${job.title}
Location: ${job.location}
Batch/eligibility: ${job.batch}

Write two things and return ONLY valid JSON, nothing else, no markdown fences:

{
  "article": "A 120-180 word engaging, factual article about this opening — what the role likely involves, why a fresher should consider it, and a nudge to verify exact details on the official listing. Do not invent specific salary or deadline numbers not given above.",
  "reel": {
    "hook": "A punchy 1-sentence spoken hook for the first 3 seconds of a vertical video (e.g. attention-grabbing, specific to this job).",
    "body": "A 30-45 second spoken script (roughly 70-100 words) delivered to camera, covering what the job is, who's eligible, and why it's worth applying now. Written to be READ ALOUD naturally, not as bullet points.",
    "cta": "A short closing line telling viewers to comment the company name in the comments to get the apply link sent to them."
  }
}`;
}

function parseJsonFromModelText(text) {
  const clean = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(clean);
}

async function callClaude(job) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: buildPrompt(job) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("").trim();
  return parseJsonFromModelText(text);
}

async function callGemini(job) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(job) }] }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
  return parseJsonFromModelText(text);
}

async function generateForJob(job) {
  if (ANTHROPIC_KEY) return callClaude(job);
  if (GEMINI_KEY) return callGemini(job);
  throw new Error("No API key configured"); // shouldn't reach here — checked in main()
}

async function main() {
  if (!ANTHROPIC_KEY && !GEMINI_KEY) {
    console.log("No ANTHROPIC_API_KEY or GEMINI_API_KEY set — skipping AI content generation. Site will use the template-based fallback content.");
    return;
  }
  console.log(`Using provider: ${ANTHROPIC_KEY ? "Claude (Anthropic)" : "Gemini (Google, free tier)"}`);

  const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));

  let reelScripts = [];
  if (fs.existsSync(REELS_PATH)) {
    try {
      reelScripts = JSON.parse(fs.readFileSync(REELS_PATH, "utf8"));
    } catch {
      reelScripts = [];
    }
  }
  const existingReelIds = new Set(reelScripts.map((r) => r.id));
  let generated = 0;

  for (const job of jobs) {
    if (job.contentGenerated) {
      continue;
    }
    try {
      console.log(`Writing content for ${job.org} — ${job.title}...`);
      const result = await generateForJob(job);
      job.articleHtml = `<p>${result.article}</p>`;
      job.contentGenerated = true;
      if (!existingReelIds.has(job.id)) {
        reelScripts.push({ id: job.id, org: job.org, title: job.title, ...result.reel });
      }
      generated++;
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn(`  failed for ${job.org} — ${job.title}: ${err.message}`);
    }
  }

  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
  fs.writeFileSync(REELS_PATH, JSON.stringify(reelScripts, null, 2));
  console.log(`\nDone. AI content generated for ${generated} new posting(s). Reel scripts written to data/reel-scripts.json.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
