// avatar-video-stub.js
//
// This is a STARTING POINT, not a finished automation. Turning a script +
// a photo/video of your face into a spoken video requires a dedicated
// "AI avatar" service — there's no way to do this with plain code alone.
//
// Two common options (both are separate paid products you'd sign up for):
//   - HeyGen (heygen.com) — has a straightforward REST API for this
//   - D-ID (d-id.com) — similar, API-first, often cheaper for short clips
//
// Both work roughly the same way:
//   1. You upload/record your face once on their platform to create an
//      "avatar" (this step happens on their site, not in this script).
//   2. You send them a script (text) + your avatar ID via their API.
//   3. They render a video and give you a download URL.
//
// Below is a template for D-ID's API as an example. You will need to:
//   - Create a D-ID account and get an API key
//   - Create/upload your avatar source image on their dashboard
//   - Add the API key as a GitHub secret (DID_API_KEY) if you want this
//     to run inside the same automation, or just run it locally/manually
//
// This is intentionally NOT wired into the daily GitHub Action, since it
// costs money per video and you'll likely want to review scripts before
// generating video from them.

const DID_API_KEY = process.env.DID_API_KEY; // set this yourself
const DID_AVATAR_IMAGE_URL = process.env.DID_AVATAR_IMAGE_URL; // a hosted photo of your face

async function generateVideo(reelScript) {
  if (!DID_API_KEY || !DID_AVATAR_IMAGE_URL) {
    throw new Error("Set DID_API_KEY and DID_AVATAR_IMAGE_URL before running this.");
  }

  const script = `${reelScript.hook} ${reelScript.body} ${reelScript.cta}`;

  const res = await fetch("https://api.d-id.com/talks", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${DID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_url: DID_AVATAR_IMAGE_URL,
      script: {
        type: "text",
        input: script,
        provider: { type: "microsoft" }, // or "elevenlabs" for a cloned voice, configured on D-ID's dashboard
      },
    }),
  });

  if (!res.ok) throw new Error(`D-ID API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  console.log("Video job created:", data.id, "— check D-ID dashboard or poll /talks/{id} for the finished video URL.");
  return data;
}

// Example usage — replace with a real entry from data/reel-scripts.json
generateVideo({
  hook: "This fresher opening closes in days — here's what you need to know.",
  body: "Example script body goes here.",
  cta: "Comment the company name below and I'll send you the apply link.",
}).catch(console.error);
