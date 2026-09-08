import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function enrichJobWithAI(job) {
  const prompt = `
You are a senior tech career analyst in India. Analyze this job description and extract/generate rich structured data for freshers.

Return valid JSON with these exact fields:
{
  "roleSummary": "2-3 crisp sentences detailing core daily responsibilities.",
  "eligibleBatch": "e.g., 2024, 2025, 2026 or Any Graduate (extract from text or infer)",
  "salaryRange": "Realistic fresher package (e.g., ₹4.5 - ₹7.0 LPA or Undisclosed)",
  "vacancies": "Estimated count or Multiple",
  "techStack": ["e.g. Java", "SQL", "Spring Boot", "Git"],
  "aptitudeTopics": ["Topic 1 to prepare", "Topic 2", "Topic 3"],
  "codingTopics": ["Core DSA/problem pattern to practice", "Second topic"],
  "interviewTips": ["Specific tip for technical round", "HR round expectation"]
}

Job Title: ${job.title}
Company: ${job.company}
Raw Description:
${job.description.slice(0, 3000)}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    return JSON.parse(response.text);
  } catch (err) {
    console.error(`AI enrichment failed for ${job.title}:`, err.message);
    return null;
  }
}
