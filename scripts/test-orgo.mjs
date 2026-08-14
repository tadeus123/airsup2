const ORGO_API_KEY = process.env.ORGO_API_KEY;
const COMPUTER_ID = process.env.ORGO_COMPUTER_ID || "099c33f0-8459-47bb-8e4d-3b94329e2c85";

if (!ORGO_API_KEY) {
  console.error("Set ORGO_API_KEY");
  process.exit(1);
}

const prompt = `You are an Airsup relay. ChatGPT is already open and logged in in the browser.

Do ONLY these steps, in order:

1. Click the browser window with ChatGPT so it is focused.
2. Press Ctrl+Shift+O (Strg+Shift+O) to open a NEW ChatGPT chat. Do NOT click menus — use this keyboard shortcut.
3. Click the message input box if it is not focused.
4. Paste this FULL prompt into the input (Ctrl+V). If paste fails, type it exactly:

Say hello in exactly one word.

5. Press Enter.
6. Wait until ChatGPT has FULLY finished responding (no stop button, no loading spinner).
7. Select and copy ChatGPT's complete answer text.
8. Return ONLY that copied answer — no prefix, no explanation.

Do NOT open terminal, other apps, or other websites.`;

const started = Date.now();
const res = await fetch("https://www.orgo.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${ORGO_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-5",
    computer_id: COMPUTER_ID,
    messages: [{ role: "user", content: prompt }],
  }),
});

const text = await res.text();
console.log("status", res.status, "ms", Date.now() - started);
try {
  const json = JSON.parse(text);
  console.log(JSON.stringify(json, null, 2));
} catch {
  console.log(text.slice(0, 2000));
}
