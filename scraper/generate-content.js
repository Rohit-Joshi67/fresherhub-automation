import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

// Automatically load GEMINI_API_KEY from .env or scraper/.env if present
function loadEnvKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPaths = [
    path.resolve('.env'),
    path.resolve('../.env'),
    path.resolve('scraper/.env')
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
      if (match && match[1]) return match[1].trim();
    }
  }
  return null;
}

const apiKey = loadEnvKey();
let aiClient = null;
if (apiKey) {
  try {
    aiClient = new GoogleGenAI({ apiKey });
  } catch (e) {
    console.warn('Failed to initialize GoogleGenAI client:', e.message);
  }
}

// Deterministic high-quality heuristic generator used as zero-cost fallback or when API limits are reached
export function generateHeuristicEnrichment(job) {
  const text = `${job.title} ${job.description || ''}`.toLowerCase();

  // Infer tech stack
  const techStack = [];
  if (/python|django|fastapi|pandas/.test(text)) techStack.push('Python');
  if (/java|spring|hibernate/.test(text)) techStack.push('Java', 'Spring Boot');
  if (/javascript|react|node|typescript|angular|vue/.test(text)) techStack.push('JavaScript', 'React.js', 'Node.js');
  if (/c\+\+|cpp/.test(text)) techStack.push('C++');
  if (/sql|mysql|postgres|database/.test(text)) techStack.push('SQL', 'Relational DBs');
  if (/aws|cloud|azure|gcp|docker/.test(text)) techStack.push('Cloud Computing (AWS/Azure)');
  if (/qa|testing|selenium|automation|cypress/.test(text)) techStack.push('Automation Testing', 'Selenium');
  if (/data|analytics|machine learning|ai/.test(text)) techStack.push('Data Structures', 'Data Analytics');

  if (techStack.length === 0) {
    techStack.push('Data Structures & Algorithms', 'Core CS Fundamentals', 'Git & GitHub', 'SQL');
  }

  // Infer batch
  let eligibleBatch = '2024, 2025 & 2026 Graduates';
  if (/2026/.test(text)) eligibleBatch = '2026 Batch Graduates';
  else if (/2025/.test(text)) eligibleBatch = '2025 & 2026 Batch Graduates';
  else if (/2024/.test(text)) eligibleBatch = '2024, 2025 & 2026 Batches';

  // Infer salary package
  let salaryRange = '₹4.5 – ₹9.0 LPA (Standard Fresher Band)';
  if (/intern|internship|trainee/.test(text)) {
    salaryRange = '₹25,000 – ₹50,000/month (Stipend) + Full-time PPO';
  } else if (/specialist|member technical staff|mts|product/.test(text)) {
    salaryRange = '₹8.0 – ₹16.0 LPA (Role Dependent)';
  } else if (/support|associate|operations/.test(text)) {
    salaryRange = '₹3.6 – ₹6.0 LPA';
  }

  // Generate crisp role summary
  const roleSummary = `${job.company} is seeking an entry-level candidate for the ${job.title} position in ${job.location || 'India'}. As part of the engineering and product team, the hired candidate will collaborate on software development, test automation, and system maintenance. Ideal for candidates with strong foundational problem-solving and computer science fundamentals.`;

  // Coding & Aptitude focus
  const aptitudeTopics = [
    'Quantitative Aptitude: Percentages, Profit & Loss, Time-Speed-Distance, and Probability',
    'Logical Reasoning: Coding-Decoding, Seating Arrangements, Syllogisms, and Pattern Series',
    'Verbal Ability: Reading Comprehension, Sentence Correction, and Technical Vocabulary'
  ];

  const codingTopics = [
    'Arrays, Strings, Two-Pointer technique, and HashMaps (LeetCode Easy to Medium)',
    'Recursion, Binary Search, and Tree traversals (BFS & DFS)',
    'Object-Oriented Programming (OOP) concepts, DBMS Queries, and Operating Systems Basics'
  ];

  const interviewTips = [
    `Review your final-year college project or internships thoroughly — explain architectural choices clearly for ${job.company}.`,
    'Prepare to write clean, compiling code with optimal Time and Space complexity (Big-O analysis).',
    'HR/Managerial Round: Showcase adaptability, eagerness to learn, and clear communication regarding location preferences.'
  ];

  return {
    roleSummary,
    eligibleBatch,
    salaryRange,
    vacancies: 'Multiple Openings (Fresher Intake)',
    techStack: [...new Set(techStack)].slice(0, 6),
    aptitudeTopics,
    codingTopics,
    interviewTips
  };
}

export async function enrichJobWithAI(job) {
  if (!aiClient) {
    return generateHeuristicEnrichment(job);
  }

  const prompt = `
You are a senior tech career advisor in India. Analyze this entry-level job posting for Indian freshers and return structured JSON.
Return ONLY valid JSON matching this schema:
{
  "roleSummary": "2-3 crisp sentences detailing core daily responsibilities.",
  "eligibleBatch": "e.g., 2024, 2025 & 2026 Batches (or Any Graduate)",
  "salaryRange": "Estimated Indian fresher package e.g. ₹5.0 - ₹8.5 LPA or Stipend",
  "vacancies": "Estimated count e.g. Multiple Openings",
  "techStack": ["Skill1", "Skill2", "Skill3", "Skill4"],
  "aptitudeTopics": ["Aptitude topic 1", "Logical topic 2", "Verbal topic 3"],
  "codingTopics": ["DSA topic 1", "Algorithm pattern 2", "Core CS subject 3"],
  "interviewTips": ["Technical round tip for this company", "HR & behavioral round advice"]
}

Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'India'}
Raw Description:
${(job.description || job.title).slice(0, 2500)}
`;

  try {
    const response = await aiClient.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    const parsed = JSON.parse(response.text);
    if (parsed.roleSummary && parsed.techStack) {
      return parsed;
    }
    return generateHeuristicEnrichment(job);
  } catch (err) {
    console.warn(`[AI Note] Falling back to heuristic enrichment for ${job.title}: ${err.message}`);
    return generateHeuristicEnrichment(job);
  }
}

// Extract company, role, batch, salary, location from unstructured reel transcripts or captions
export async function extractJobFromText(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error('Input text/transcript cannot be empty.');
  }

  if (aiClient) {
    const prompt = `
You are an expert Indian tech job parser. Given this raw text / social media reel transcript / post caption, extract the exact job details into valid JSON.
Return ONLY valid JSON with these exact keys:
{
  "company": "Company or startup name (e.g. Paytm, Google, TCS)",
  "title": "Exact job title / role (e.g. Associate Software Engineer, Cloud Trainee)",
  "location": "Job location or Remote (e.g. Bengaluru, Karnataka or Pan-India)",
  "batch": "Eligible passing batches (e.g. 2024, 2025 & 2026 Graduates)",
  "salary": "Package or stipend mentioned (e.g. ₹6.5 - ₹10 LPA, or ₹35,000/month)",
  "sector": "private or govt",
  "applyUrl": "Official application URL if mentioned (or 'https://careers.google.com' / official careers default)",
  "lastDate": "Last date to apply or 'Accepting Applications'",
  "description": "Clean 2-3 sentence overview of the role"
}

Raw Text / Reel Transcript:
${rawText.slice(0, 3000)}
`;
    try {
      const response = await aiClient.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      const parsed = JSON.parse(response.text);
      if (parsed.company && parsed.title) {
        return parsed;
      }
    } catch (e) {
      console.warn('Gemini extraction failed, using heuristic regex parser:', e.message);
    }
  }

  // Heuristic regex fallback for reel transcripts
  const lines = rawText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  let company = 'Tech Organization';
  let title = 'Software Trainee / Fresher Role';
  let location = 'Bengaluru / Pan-India';
  let batch = '2024, 2025 & 2026 Graduates';
  let salary = '₹4.5 – ₹9.0 LPA (Fresher Band)';
  let sector = 'private';
  let applyUrl = 'https://freshersjobopening.online';

  const lower = rawText.toLowerCase();

  // Find company
  const compMatch = rawText.match(/(?:at|company|hiring|join|in)\s+([A-Z][a-zA-Z0-9\s]{2,20})/);
  if (compMatch && compMatch[1]) company = compMatch[1].trim();

  // Find title
  const titleMatch = rawText.match(/(software engineer|developer|intern|trainee|analyst|associate|qa engineer|data analyst)/i);
  if (titleMatch) title = titleMatch[0].replace(/\b\w/g, c => c.toUpperCase());

  // Find salary
  const salMatch = rawText.match(/(₹?\s*\d+(?:\.\d+)?\s*(?:lpa|lakh|k|pm|\/month))/i);
  if (salMatch) salary = salMatch[0].toUpperCase();

  // Find batch
  const batchMatch = rawText.match(/(202[3-7](?:\s*[,&/\-]\s*202[3-7])*)/);
  if (batchMatch) batch = `${batchMatch[0]} Graduates`;

  // Find location
  const locMatch = rawText.match(/(bangalore|bengaluru|hyderabad|pune|noida|delhi|mumbai|chennai|gurgaon|remote|pan-india)/i);
  if (locMatch) location = locMatch[0].replace(/\b\w/g, c => c.toUpperCase());

  return {
    company,
    title,
    location,
    batch,
    salary,
    sector,
    applyUrl,
    lastDate: 'Accepting Applications',
    description: rawText.slice(0, 500)
  };
}


