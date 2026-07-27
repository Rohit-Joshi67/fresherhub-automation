// instagram-post-stub.js
//
// Auto-posting to Instagram requires Meta's official Content Publishing
// API. There is no workaround — Instagram does not allow posting through
// unofficial means, and third-party tools that claim to bypass this
// violate Instagram's terms and risk your account being banned.
//
// What you actually need to set up first (one-time, on Meta's side):
//   1. Your Instagram account must be a Business or Creator account.
//   2. It must be linked to a Facebook Page.
//   3. You create a Meta Developer App at developers.facebook.com.
//   4. You request the "instagram_content_publish" permission — for
//      accounts under ~a certain size this is usually self-serve, but
//      Meta can require app review with a use-case explanation.
//   5. Your video must be hosted at a public URL (e.g. after the avatar
//      API above gives you a download link, you'd re-upload it somewhere
//      public like an S3 bucket) — Instagram's API pulls from a URL, it
//      doesn't accept direct file uploads.
//
// Once you have an access token and a public video URL, posting is a
// two-step API call:

const IG_USER_ID = process.env.IG_USER_ID; // your Instagram Business account's ID
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

async function postReel(videoUrl, caption) {
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    throw new Error("Set IG_USER_ID and IG_ACCESS_TOKEN before running this — see setup notes above.");
  }

  // Step 1: create a media container
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${IG_USER_ID}/media?media_type=REELS&video_url=${encodeURIComponent(videoUrl)}&caption=${encodeURIComponent(caption)}&access_token=${IG_ACCESS_TOKEN}`,
    { method: "POST" }
  );
  const createData = await createRes.json();
  if (!createData.id) throw new Error(`Container creation failed: ${JSON.stringify(createData)}`);

  // Step 2: publish it (may need to poll status_code until FINISHED first — see Meta's docs)
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${IG_USER_ID}/media_publish?creation_id=${createData.id}&access_token=${IG_ACCESS_TOKEN}`,
    { method: "POST" }
  );
  const publishData = await publishRes.json();
  console.log("Published:", publishData);
  return publishData;
}

// Example — your CTA strategy (comment company name for the link) works
// well as the caption's closing line, e.g.:
const exampleCaption =
  "New fresher opening just dropped 👀 Comment the company name and I'll DM you the link! #fresherjobs #itjobs";

// postReel("https://your-hosted-video-url.mp4", exampleCaption).catch(console.error);

// A note on disclosure: if the video uses a synthetic/AI voice or avatar
// rendering rather than footage of you actually speaking, Instagram and
// YouTube both have policies around labeling AI-generated or synthetic
// media — worth checking their current creator guidelines before this
// goes out at any real scale.
