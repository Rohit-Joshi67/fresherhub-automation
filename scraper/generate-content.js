// generate-content.js
// Second pipeline step (runs after scrape.js). Reads data/jobs.json,
// and for every job that doesn't already have AI-written content, asks
// Claude to write:
//   1) a real article body (about the role + why it's worth applying)
//   2) a short vertical-video script: hook, body, and a CTA telling
//      viewers to comment the company name for the link
//
// Requires an Anthropic API key in the ANTHROPIC_API_KEY environment
// variable (set as a GitHub secret — see SETUP.md). If it's missing, this
// step is skipped entirely and the site falls back to the template-based
// content from templates.js — nothing breaks, you just don't get the
// AI-written version until you add the key.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const JOBS_PATH = path.join(ROOT, "data", "jobs.json");
const REELS_PATH = path.join(ROOT, "data", "reel-scripts.json");

const MODEL = "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;

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

async function callClaude(job) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: buildPrompt(job) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("").trim();
  const clean = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(clean);
}

async function main() {
  if (!API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — skipping AI content generation. Site will use the template-based fallback content.");
    return;
  }

  const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));

  // Reel scripts persist in their own private file, independent of
  // jobs.json (which is public-facing). Load whatever's already there so
  // we don't lose past scripts for jobs we're about to skip re-generating.
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
      continue; // article already written; its reel script (if any) is already in reelScripts
    }
    try {
      console.log(`Writing content for ${job.org} — ${job.title}...`);
      const result = await callClaude(job);
      job.articleHtml = `<p>${result.article}</p>`;
      job.contentGenerated = true;
      // Note: the reel script is intentionally NOT attached to `job` here.
      // `job` gets written to data/jobs.json, which is what the public
      // website fetches — reel scripts stay private, in reel-scripts.json
      // only, per your request.
      if (!existingReelIds.has(job.id)) {
        reelScripts.push({ id: job.id, org: job.org, title: job.title, ...result.reel });
      }
      generated++;
      await new Promise((r) => setTimeout(r, 800)); // gentle rate limiting
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
  process.exit(1); // fails only this step; scrape.js data is already committed separately if this errors before writing
});
