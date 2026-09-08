export function renderJobPage(job, ai) {
  const skillTags = (ai.techStack || [])
    .map(skill => `<a href="/resources#${skill.toLowerCase().replace(/[^a-z0-9]/g, '-')}" class="tag-chip">${skill}</a>`)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${job.title} at ${job.company} — FresherHub</title>
  <meta name="description" content="Detailed fresher guide and application link for ${job.title} at ${job.company}.">
  <link rel="stylesheet" href="/style.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    "title": "${job.title}",
    "description": "${ai.roleSummary}",
    "hiringOrganization": { "@type": "Organization", "name": "${job.company}" },
    "jobLocation": { "@type": "Place", "address": "${job.location}" }
  }
  </script>
</head>
<body>
  <div class="container">
    <p><a href="/">&larr; Back to all listings</a></p>
    <span class="badge">Verified Opening</span>
    <h1>${job.title}</h1>
    <p class="company-sub">${job.company} &bull; <a href="${job.applyUrl}" target="_blank" rel="nofollow noopener">Verify on official portal &nearr;</a></p>

    <div class="split-layout">
      <!-- Left Column: Details -->
      <main class="left-col">
        <table class="meta-table">
          <tr><td>ORGANIZATION</td><td>${job.company}</td></tr>
          <tr><td>LOCATION</td><td>${job.location}</td></tr>
          <tr><td>ELIGIBLE BATCH</td><td>${ai.eligibleBatch}</td></tr>
          <tr><td>ESTIMATED PACKAGE</td><td>${ai.salaryRange}</td></tr>
          <tr><td>POSTED DATE</td><td>${new Date().toISOString().split('T')[0]}</td></tr>
        </table>

        <h3>ABOUT THE ROLE</h3>
        <p>${ai.roleSummary}</p>

        <h3>RECOMMENDED TECH STACK & ROADMAPS</h3>
        <div class="tags-container">${skillTags}</div>
      </main>

      <!-- Right Column: Apply & Prep Guide -->
      <aside class="right-col">
        <div class="apply-card">
          <p class="deadline">STATUS: ACCEPTING APPLICATIONS</p>
          <a href="${job.applyUrl}" target="_blank" rel="nofollow noopener" class="btn-apply">
            Apply on official site &nearr;
          </a>
          <small>Direct redirection to ${job.company}'s ATS portal.</small>
        </div>

        <div class="prep-guide">
          <h4>PREPARATION GUIDE</h4>
          <details open>
            <summary>Aptitude & Reasoning Focus</summary>
            <ul>${(ai.aptitudeTopics || []).map(t => `<li>${t}</li>`).join('')}</ul>
          </details>
          <details open>
            <summary>Coding & Technical Assessment</summary>
            <ul>${(ai.codingTopics || []).map(t => `<li>${t}</li>`).join('')}</ul>
          </details>
          <details open>
            <summary>Interview Strategy</summary>
            <ul>${(ai.interviewTips || []).map(t => `<li>${t}</li>`).join('')}</ul>
          </details>
        </div>
      </aside>
    </div>

    <footer class="site-footer">
      <small><strong>Disclaimer:</strong> FresherHub aggregates public openings directly from official ATS feeds. Trademarks belong to ${job.company}.</small>
    </footer>
  </div>
</body>
</html>`;
}
