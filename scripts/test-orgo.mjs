const ORGO_API_KEY = process.env.ORGO_API_KEY;
const COMPUTER_ID = process.env.ORGO_COMPUTER_ID || "099c33f0-8459-47bb-8e4d-3b94329e2c85";

if (!ORGO_API_KEY) {
  console.error("Set ORGO_API_KEY");
  process.exit(1);
}

const prompt = `You are an Airsup relay. ChatGPT is ALREADY open and logged in in the browser on this desktop.

RULES (strict):
1. Use ONLY the existing ChatGPT browser tab. Do NOT open terminal, new apps, or other sites.
2. Open a NEW ChatGPT chat: focus the browser, press Ctrl+Shift+O (or use ChatGPT's New chat button).
3. Click the message input box.
4. Type this exact message and press Enter:
   Say hello in exactly one word.
5. Wait until ChatGPT's response is fully complete (stop button gone).
6. Select and copy the assistant's response text.
7. Return ONLY the copied response text as your final answer — no commentary, no markdown, no explanation.

If ChatGPT is not visible, click the Chrome/Chromium window first.`;

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
