#!/usr/bin/env node
/**
 * Airsup ChatGPT sender for Orgo VMs — Chrome DevTools Protocol (DOM), not pixels.
 * Zero npm deps. Args: node airsup-chatgpt-send.js <textB64> [newChat=1|0]
 *
 * Chrome refuses --remote-debugging-port on the default user-data-dir, so we use
 * a seeded copy at PROFILE_CDP (login cookies copied from the normal profile).
 */
"use strict";

const http = require("http");
const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const { EventEmitter } = require("events");
const { spawn, execSync } = require("child_process");

const CDP_PORT = 9222;
const PROFILE_SRC = "/root/.config/google-chrome";
const PROFILE_CDP = "/root/.config/google-chrome-airsup";
const CHROME_BIN = fs.existsSync("/opt/google/chrome/chrome")
  ? "/opt/google/chrome/chrome"
  : "google-chrome";

class MinimalWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.readyState = 0;
    this._buffer = Buffer.alloc(0);
    this._url = new URL(url);
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.createConnection(
      { host: this._url.hostname, port: parseInt(this._url.port, 10) || 80 },
      () => {
        const path = this._url.pathname + (this._url.search || "");
        socket.write(
          `GET ${path} HTTP/1.1\r\nHost: ${this._url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      }
    );
    this._socket = socket;
    let upgraded = false;
    socket.on("data", (chunk) => {
      if (!upgraded) {
        this._buffer = Buffer.concat([this._buffer, chunk]);
        const headerEnd = this._buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headers = this._buffer.slice(0, headerEnd).toString();
        if (!headers.includes("101")) {
          this.emit("error", new Error("WS upgrade failed: " + headers.split("\r\n")[0]));
          socket.destroy();
          return;
        }
        upgraded = true;
        this.readyState = 1;
        this.emit("open");
        const remaining = this._buffer.slice(headerEnd + 4);
        this._buffer = Buffer.alloc(0);
        if (remaining.length) this._processFrames(remaining);
      } else {
        this._processFrames(chunk);
      }
    });
    socket.on("close", () => {
      this.readyState = 3;
      this.emit("close");
    });
    socket.on("error", (err) => this.emit("error", err));
  }

  _processFrames(data) {
    this._buffer = Buffer.concat([this._buffer, data]);
    while (this._buffer.length >= 2) {
      const firstByte = this._buffer[0];
      const secondByte = this._buffer[1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;
      if (payloadLength === 126) {
        if (this._buffer.length < 4) return;
        payloadLength = this._buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this._buffer.length < 10) return;
        payloadLength = Number(this._buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (masked) offset += 4;
      if (this._buffer.length < offset + payloadLength) return;
      let payload = this._buffer.slice(offset, offset + payloadLength);
      if (masked) {
        const mask = this._buffer.slice(offset - 4, offset);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this._buffer = this._buffer.slice(offset + payloadLength);
      if (opcode === 0x01) this.emit("message", payload.toString("utf-8"));
      else if (opcode === 0x08) this.close();
      else if (opcode === 0x09) this._sendFrame(0x0a, payload);
    }
  }

  _sendFrame(opcode, data) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf-8");
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      mask.copy(header, 10);
    }
    this._socket.write(Buffer.concat([header, masked]));
  }

  send(data) {
    if (this.readyState !== 1) throw new Error("WebSocket not open");
    this._sendFrame(0x01, data);
  }

  close() {
    if (this.readyState < 2) {
      this.readyState = 2;
      try {
        this._sendFrame(0x08, Buffer.alloc(0));
      } catch {}
      this._socket.end();
    }
  }
}

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port: CDP_PORT, path: urlPath, timeout: 2500 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("CDP HTTP timeout"));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayEnv() {
  try {
    if (fs.existsSync("/tmp/.X11-unix/X99")) return ":99";
    if (fs.existsSync("/tmp/.X11-unix/X0")) return ":0";
  } catch {}
  return process.env.DISPLAY || ":99";
}

function sh(cmd) {
  try {
    execSync(cmd, { stdio: "ignore" });
  } catch {}
}

async function cdpReady() {
  try {
    await httpJson("/json/version");
    return true;
  } catch {
    return false;
  }
}

function seedProfile() {
  if (!fs.existsSync(PROFILE_SRC)) {
    throw new Error("missing chrome profile at " + PROFILE_SRC);
  }
  // Refresh seed when missing or older than 7 days so login stays usable.
  const marker = PROFILE_CDP + "/.airsup_seeded";
  let need = !fs.existsSync(marker);
  if (!need) {
    try {
      const age = Date.now() - fs.statSync(marker).mtimeMs;
      if (age > 7 * 24 * 3600 * 1000) need = true;
    } catch {
      need = true;
    }
  }
  if (!need) return { seeded: false };
  sh(`rm -rf '${PROFILE_CDP}'`);
  sh(`cp -a '${PROFILE_SRC}' '${PROFILE_CDP}'`);
  sh(
    `rm -f '${PROFILE_CDP}/SingletonLock' '${PROFILE_CDP}/SingletonSocket' '${PROFILE_CDP}/SingletonCookie'`
  );
  fs.writeFileSync(marker, String(Date.now()));
  clearCrashRestoreBubble();
  return { seeded: true };
}

/** Stop Chrome's "Restore pages?" bubble from stealing focus. */
function clearCrashRestoreBubble() {
  try {
    const prefsPath = PROFILE_CDP + "/Default/Preferences";
    if (!fs.existsSync(prefsPath)) return;
    const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {}
}

function killChrome() {
  sh("pkill -9 -f '/opt/google/chrome/chrome' || true");
  sh("pkill -9 -f 'google-chrome' || true");
}

function launchChromeCdp() {
  const display = displayEnv();
  sh(
    `rm -f '${PROFILE_CDP}/SingletonLock' '${PROFILE_CDP}/SingletonSocket' '${PROFILE_CDP}/SingletonCookie'`
  );
  clearCrashRestoreBubble();
  // Launch via setsid so Orgo bash teardown does not kill Chrome.
  const cmd =
    `setsid env DISPLAY=${display} ${CHROME_BIN} ` +
    `--no-sandbox --disable-gpu --disable-dev-shm-usage ` +
    `--no-first-run --no-default-browser-check ` +
    `--hide-crash-restore-bubble --disable-session-crashed-bubble ` +
    `--remote-debugging-port=${CDP_PORT} --remote-allow-origins=* ` +
    `--user-data-dir=${PROFILE_CDP} --window-size=1280,720 ` +
    `https://chatgpt.com/ >/tmp/airsup-chrome.log 2>&1 < /dev/null &`;
  execSync(cmd, { stdio: "ignore", shell: "/bin/bash" });
}

async function ensureChromeCdp() {
  if (await cdpReady()) return { restarted: false, seeded: false };

  const seed = seedProfile();
  killChrome();
  await sleep(1000);
  launchChromeCdp();

  for (let i = 0; i < 50; i++) {
    await sleep(400);
    if (await cdpReady()) return { restarted: true, ...seed };
  }

  let log = "";
  try {
    log = fs.readFileSync("/tmp/airsup-chrome.log", "utf8").slice(0, 500);
  } catch {}
  throw new Error("Chrome CDP did not come up on :" + CDP_PORT + (log ? " log=" + log : ""));
}

async function listPages() {
  const targets = await httpJson("/json/list");
  if (!Array.isArray(targets)) throw new Error("bad /json/list");
  return targets.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !/^chrome:/i.test(t.url || "")
  );
}

function pickChatGptPage(pages) {
  const hit =
    pages.find((p) => /chatgpt\.com|openai\.com/i.test(p.url || "")) ||
    pages.find((p) => /chat/i.test(p.title || "")) ||
    pages[0];
  if (!hit) throw new Error("No Chrome page targets");
  return hit;
}

async function waitForExecutionContext(send) {
  let lastErr = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      const state = r?.result?.value;
      if (state === "interactive" || state === "complete") return state;
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }
  throw new Error(
    "no execution context" + (lastErr ? ": " + (lastErr.message || lastErr) : "")
  );
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new MinimalWebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    ws.on("open", () => {
      resolve({
        ws,
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP timeout: ${method}`));
            }, 25000);
            pending.set(id, {
              resolve: (v) => {
                clearTimeout(timer);
                res(v);
              },
              reject: (e) => {
                clearTimeout(timer);
                rej(e);
              },
            });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    });
    ws.on("error", reject);
  });
}

function pageSendExpression(text, newChat) {
  const payload = JSON.stringify({ text, newChat: !!newChat });
  return `(() => {
    const cfg = ${payload};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function findComposer() {
      return (
        document.querySelector("#prompt-textarea") ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('div.ProseMirror[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]')
      );
    }

    function findSend() {
      return (
        document.querySelector('[data-testid="send-button"]') ||
        document.querySelector('button[aria-label="Send message"]') ||
        document.querySelector('button[aria-label*="Send"]') ||
        Array.from(document.querySelectorAll("button")).find((b) => {
          const t = (b.getAttribute("data-testid") || "") + " " + (b.getAttribute("aria-label") || "");
          return /send/i.test(t) && !b.disabled;
        })
      );
    }

    function findNewChat() {
      return (
        document.querySelector('[data-testid="create-new-chat-button"]') ||
        document.querySelector('a[href="/"]') ||
        Array.from(document.querySelectorAll("a,button")).find((el) =>
          /^\\s*new chat\\s*$/i.test((el.textContent || "").trim())
        )
      );
    }

    function setComposerText(el, text) {
      el.focus();
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch {}
      const got = (el.innerText || el.textContent || "").trim();
      if (got.includes(text.slice(0, Math.min(32, text.length)))) return true;
      try {
        el.textContent = "";
        const p = document.createElement("p");
        p.textContent = text;
        el.appendChild(p);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text })
        );
      } catch {}
      return (el.innerText || el.textContent || "").includes(text.slice(0, Math.min(24, text.length)));
    }

    return (async () => {
      if (!/chatgpt\\.com|openai\\.com/i.test(location.hostname)) {
        location.href = "https://chatgpt.com/";
        await sleep(2500);
      }

      if (cfg.newChat) {
        const nb = findNewChat();
        if (nb) {
          nb.click();
          await sleep(900);
        } else if (location.pathname && location.pathname !== "/" && !/^\\/?$/.test(location.pathname)) {
          location.href = "https://chatgpt.com/";
          await sleep(2500);
        }
      }

      let composer = null;
      for (let i = 0; i < 24; i++) {
        composer = findComposer();
        if (composer) break;
        await sleep(250);
      }
      if (!composer) return { ok: false, error: "composer_not_found", href: location.href };

      if (!setComposerText(composer, cfg.text)) {
        return { ok: false, error: "set_text_failed", sample: (composer.innerText || "").slice(0, 80) };
      }

      await sleep(250);
      const send = findSend();
      if (send && !send.disabled) {
        send.click();
        await sleep(200);
        return { ok: true, method: "dom_click_send", href: location.href };
      }

      composer.focus();
      composer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
      );
      composer.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
      );
      return { ok: true, method: "dom_enter", sendDisabled: !!(send && send.disabled), href: location.href };
    })();
  })()`;
}

async function sendViaCdp(text, newChat) {
  let pages = await listPages();
  if (!pages.length) {
    await sleep(1500);
    pages = await listPages();
  }
  let page = pickChatGptPage(pages);
  let { ws, send } = await connectWs(page.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");

  if (!/chatgpt\.com|openai\.com/i.test(page.url || "")) {
    await send("Page.navigate", { url: "https://chatgpt.com/" });
    await sleep(2000);
    await waitForExecutionContext(send);
  } else {
    await waitForExecutionContext(send);
  }

  let result;
  let value;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await send("Runtime.evaluate", {
        expression: pageSendExpression(text, newChat),
        awaitPromise: true,
        returnByValue: true,
      });
      value = result?.result?.value;
      if (result?.result?.subtype === "error") {
        throw new Error(result.result.description || "evaluate error");
      }
      if (value && value.ok) break;
      if (value && value.error === "composer_not_found") {
        await sleep(1200);
        continue;
      }
      break;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/execution context|Cannot find default/i.test(msg) && attempt < 2) {
        try {
          ws.close();
        } catch {}
        await sleep(1000);
        pages = await listPages();
        page = pickChatGptPage(pages);
        ({ ws, send } = await connectWs(page.webSocketDebuggerUrl));
        await send("Runtime.enable");
        await send("Page.enable");
        await waitForExecutionContext(send);
        continue;
      }
      throw e;
    }
  }

  try {
    ws.close();
  } catch {}
  return value;
}

async function main() {
  const textB64 = process.argv[2];
  const newChat = (process.argv[3] || "1") !== "0";
  if (!textB64) {
    console.log(JSON.stringify({ ok: false, error: "missing_text_b64" }));
    process.exit(2);
  }
  const text = Buffer.from(textB64, "base64").toString("utf8");
  if (!text.trim()) {
    console.log(JSON.stringify({ ok: false, error: "empty_text" }));
    process.exit(2);
  }

  const ensure = await ensureChromeCdp();
  const value = await sendViaCdp(text, newChat);
  const out = { ...(value || { ok: false, error: "no_result" }), ensure };
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
