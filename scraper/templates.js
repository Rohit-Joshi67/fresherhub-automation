// templates.js
// Turns a raw scraped title + company + sector into the structured content
// the site needs (about, eligibility, prep guide). This is intentionally
// rule-based (keyword matching) so it runs for free with no external AI
// API calls. It won't be as sharp as a hand-written guide, but it gives
// every posting a usable, relevant starting point automatically.

function detectRoleType(title) {
  const t = title.toLowerCase();
  if (/data entry|clerk|lower division/.test(t)) return "clerical";
  if (/scientist|engineer|developer|technical|it officer|programmer|software/.test(t)) return "technical";
  if (/graduate trainee|ge trainee|associate|analyst|trainee/.test(t)) return "trainee";
  return "general";
}

function govtPrep(roleType) {
  const common = [
    { t: "Aptitude & Reasoning", items: [
      "Practice quantitative aptitude: percentages, ratios, profit-loss, time-speed-distance.",
      "General intelligence & reasoning: series, coding-decoding, analogies.",
      "Time yourself against the real exam's section limits."
    ]},
    { t: "General Awareness & English", items: [
      "Current affairs from the last 6 months, especially government schemes.",
      "English: cloze test, error spotting, sentence improvement.",
      "Static GK: Indian polity, geography, history basics."
    ]}
  ];
  if (roleType === "technical") {
    common.push({ t: "Technical / Core Subjects", items: [
      "Revise data structures, DBMS, operating systems, and computer networks.",
      "Practice implementing common data structures from scratch, not just via library calls.",
      "Be ready to discuss any academic projects in the technical interview."
    ]});
  }
  if (roleType === "clerical") {
    common.push({ t: "Typing / Skill Test", items: [
      "Practice on the actual exam typing software if the recruiter provides a demo.",
      "Accuracy matters as much as speed — errors are usually penalized."
    ]});
  }
  common.push({ t: "Resources", items: [
    "Check the official notification PDF for the exact syllabus — it varies by recruitment cycle.",
    "Use previous years' question papers from the official portal where available."
  ]});
  return common;
}

function privatePrep(roleType) {
  const common = [
    { t: "Aptitude & Reasoning", items: [
      "Quantitative aptitude, logical reasoning, and verbal ability — standard across most IT service company tests.",
      "Practice under strict time limits; sectional cutoffs are common."
    ]},
    { t: "Coding Round", items: [
      "Expect 1–2 coding problems, typically easy-to-medium, in a language of your choice.",
      "Prioritize writing clean, compiling code over the most optimal solution first."
    ]}
  ];
  if (roleType === "technical") {
    common.push({ t: "Technical Interview", items: [
      "Be ready to discuss OOP concepts, DBMS, operating systems, and your final-year project in depth.",
      "Practice explaining the time/space complexity of your code."
    ]});
  }
  common.push({ t: "HR Round", items: [
    "Prepare a 60-second self-introduction and rehearse it out loud.",
    "Be clear and honest about location flexibility and joining timelines — this comes up often."
  ]});
  return common;
}

function generatePrep(sector, title) {
  const roleType = detectRoleType(title);
  return sector === "govt" ? govtPrep(roleType) : privatePrep(roleType);
}

function generateAbout(org, title, sector) {
  if (sector === "govt") {
    return `${org} has an open recruitment for the ${title} position. This posting was picked up automatically from ${org}'s official channels — always cross-check exact eligibility, dates, and vacancy count on the official notification before applying.`;
  }
  return `${org} is hiring for ${title}, a fresher-eligible opening on ${org}'s official careers page. This summary was generated automatically — confirm exact eligibility criteria, compensation, and deadlines on the official listing before applying.`;
}

function generateEligibility(sector) {
  if (sector === "govt") {
    return "Eligibility (qualification, age limit, and category relaxations) is set by the official notification and can change per recruitment cycle — always verify against the official PDF before assuming you qualify.";
  }
  return "Eligibility typically requires a relevant degree (B.E./B.Tech/MCA/M.Sc or equivalent) with no active academic backlogs. Exact cutoffs and batch eligibility vary by company and drive — confirm on the official posting.";
}

module.exports = { generatePrep, generateAbout, generateEligibility, detectRoleType };
