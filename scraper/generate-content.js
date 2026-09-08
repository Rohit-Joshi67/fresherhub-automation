import { GoogleGenAI } from '@google/genai';

let aiClient = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
  if (!aiClient || !process.env.GEMINI_API_KEY) {
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

