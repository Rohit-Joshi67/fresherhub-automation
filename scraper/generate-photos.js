/**
 * generate-photos.js — Instagram creative images, one per published job.
 *
 * Runs at the end of the scheduled scrape. For each published job that does
 * not yet have a creative, asks Gemini's image model for a 1080x1350 portrait
 * job-alert card and saves it under docs/instagram/<job-slug>.png.
 * Matching data/instagram-queue.json entries get an `image` field pointing
 * at the file, so the caption and creative travel together.
 *
 * Rules:
 * - Only short, verified strings go into the image prompt (company, title,
 *   location). Nothing invented, no salary/batch claims on the creative.
 * - No API key -> skip quietly (production sets GEMINI_API_KEY in secrets).
 * - A failed render is logged and skipped; it never fails the scrape.
 */

import fs from 'fs';
import path from 'path';

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

/** Keep image-prompt text short, plain, and safe for the model to render. */
const promptText = (s, max = 48) => String(s || '')
  .replace(/["'`\\]/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max) || 'Fresher role';

async function renderCreative(ai, job) {
  const company = promptText(job.company || job.org, 40);
  const title = promptText(job.title, 48);
  const location = promptText(job.location, 40);
  const prompt = `Design a portrait Instagram job-alert creative, 1080x1350 pixels.
Style: modern dark navy-to-teal gradient background, subtle geometric shapes, bold clean sans-serif typography, professional fresher job-board aesthetic. No photographs of people, no logos, no watermarks.
Render EXACTLY these 5 text lines, centered, nothing else:
Line 1 (small, uppercase, letter-spaced): FRESHER HIRING
Line 2 (largest, bold): ${company}
Line 3 (large): ${title}
Line 4 (medium): ${location}
Line 5 (small, at the bottom): Link in bio to apply
Spell every word exactly as given. Keep generous margins so no text touches the edges.`;

  const resp = await ai.models.generateContent({
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview',
    contents: [{ text: prompt }],
    config: { responseModalities: ['TEXT', 'IMAGE'] }
  });
  const parts = resp.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }
  throw new Error('model returned no image');
}

/**
 * @param {object} opts
 * @param {Array} opts.jobs - published feed entries
 * @param {string} opts.repoRoot - repo root
 * @param {string} opts.dataDir - data dir (for instagram-queue.json)
 * @param {number} [opts.maxPerRun=10]
 * @returns {Promise<number>} creatives created this run
 */
export async function generatePhotos({ jobs, repoRoot, dataDir, maxPerRun = 10 }) {
  const imgDir = path.join(repoRoot, 'docs', 'instagram');
  fs.mkdirSync(imgDir, { recursive: true });

  const key = loadEnvKey();
  if (!key) {
    console.log('[photos] no GEMINI_API_KEY — skipping creative generation');
    return 0;
  }
  let ai;
  try {
    const { GoogleGenAI } = await import('@google/genai');
    ai = new GoogleGenAI({ apiKey: key });
  } catch (e) {
    console.warn('[photos] Gemini unavailable:', e.message);
    return 0;
  }

  let created = 0;
  const made = [];
  for (const job of jobs) {
    if (created >= maxPerRun) break;
    const jobSlug = String(job.slug || '').replace('/docs/jobs/', '').replace(/\.html$/, '') || String(job.id || '');
    if (!jobSlug) continue;
    const outPath = path.join(imgDir, `${jobSlug}.png`);
    if (fs.existsSync(outPath)) continue;
    try {
      const png = await renderCreative(ai, job);
      if (!png || png.length < 1024) throw new Error('image too small, discarding');
      fs.writeFileSync(outPath, png);
      created++;
      made.push(jobSlug);
      console.log(`[photos] created ${jobSlug}.png (${(png.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.warn(`[photos] ${jobSlug} failed: ${e.message}`);
    }
  }

  // Attach image paths to matching queue entries so caption + creative travel together.
  if (made.length > 0) {
    try {
      const qPath = path.join(dataDir, 'instagram-queue.json');
      const queue = JSON.parse(fs.readFileSync(qPath, 'utf8'));
      const items = Array.isArray(queue) ? queue : [];
      let touched = 0;
      for (const entry of items) {
        const page = String(entry.page || '');
        const hit = made.find((s) => page.includes(s));
        if (hit && !entry.image) {
          entry.image = `docs/instagram/${hit}.png`;
          touched++;
        }
      }
      if (touched > 0) fs.writeFileSync(qPath, JSON.stringify(queue, null, 2), 'utf8');
      console.log(`[photos] linked ${touched} queue entries to creatives`);
    } catch (e) {
      console.warn('[photos] queue linking failed:', e.message);
    }
  }

  return created;
}
