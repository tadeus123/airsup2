#!/usr/bin/env node
/**
 * Airsup ChatGPT sender for Orgo VMs — Chrome DevTools Protocol (DOM), not pixels.
 * Zero npm deps. Args: node airsup-chatgpt-send.js <textB64> [newChat=1|0] [send|verify]
 *
 * Attaches to the same Chrome the human sees when possible (default profile + CDP).
 * Success requires the wake marker to appear in ChatGPT's DOM — no blind "SENT".
 */
"use strict";

const http = require("http");
const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const { EventEmitter } = require("events");
const { spawn, execSync } = require("child_process");

const CDP_PORT = 9222;
const PROFILE_CDP = "/tmp/google-chrome-airsup";
const CHROME_BIN = fs.existsSync("/opt/google/chrome/chrome")
  ? "/opt/google/chrome/chrome"
  : "google-chrome";

function homeDir() {
  return process.env.HOME || "/home/orgo";
}

/** Login Chrome uses the default profile; prefer that so VNC and CDP are the same window. */
function defaultChromeProfile() {
  const candidates = [
    `${homeDir()}/.config/google-chrome`,
    "/home/orgo/.config/google-chrome",
    "/root/.config/google-chrome",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

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

function clearCrashRestoreBubble(profileDir) {
  try {
    const prefsPath = profileDir + "/Default/Preferences";
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

function unlockProfile(profileDir) {
  sh(
    `rm -f '${profileDir}/SingletonLock' '${profileDir}/SingletonSocket' '${profileDir}/SingletonCookie'`
  );
  clearCrashRestoreBubble(profileDir);
}

/** Prefer default profile (same as OAuth login / VNC). Seeded copy only as last resort. */
function launchChromeCdp(opts = {}) {
  const display = displayEnv();
  const useCopy = !!opts.useCopy;
  const profile = useCopy ? PROFILE_CDP : defaultChromeProfile();
  if (useCopy) {
    const src = defaultChromeProfile();
    if (!fs.existsSync(src)) throw new Error("missing chrome profile at " + src);
    sh(`rm -rf '${PROFILE_CDP}'`);
    sh(`cp -a '${src}' '${PROFILE_CDP}'`);
  }
  unlockProfile(profile);
  const dataDirFlag = useCopy ? `--user-data-dir=${PROFILE_CDP} ` : "";
  // Match oauth provision: same visible Chrome the human sees in Orgo.
  const cmd =
    `setsid env DISPLAY=${display} ${CHROME_BIN} ` +
    `--no-sandbox --disable-gpu --disable-dev-shm-usage ` +
    `--no-first-run --no-default-browser-check ` +
    `--hide-crash-restore-bubble --disable-session-crashed-bubble ` +
    `--remote-debugging-port=${CDP_PORT} --remote-allow-origins=* ` +
    `${dataDirFlag}--window-size=1280,720 --start-maximized ` +
    `https://chatgpt.com/ >/tmp/airsup-chrome.log 2>&1 < /dev/null &`;
  execSync(cmd, { stdio: "ignore", shell: "/bin/bash" });
  return { profile, useCopy };
}

async function waitCdpUp(ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cdpReady()) return true;
    await sleep(300);
  }
  return false;
}

async function ensureChromeCdp() {
  if (await cdpReady()) return { restarted: false, mode: "attach" };

  // One relaunch only — Orgo bash aborts ~30–60s; no double seed path on wake.
  killChrome();
  await sleep(600);
  const launched = launchChromeCdp({ useCopy: false });
  if (await waitCdpUp(10000)) {
    return { restarted: true, mode: "default_profile", profile: launched.profile };
  }

  let log = "";
  try {
    log = fs.readFileSync("/tmp/airsup-chrome.log", "utf8").slice(0, 400);
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
    pages.find((p) => /chatgpt\.com\/?(?:$|\?|#|c\/)/i.test(p.url || "")) ||
    pages.find((p) => /chatgpt\.com|openai\.com/i.test(p.url || "")) ||
    pages.find((p) => /chat/i.test(p.title || "")) ||
    pages[0];
  if (!hit) throw new Error("No Chrome page targets — open Chrome on the Orgo desktop");
  return hit;
}

async function waitForExecutionContext(send) {
  let lastErr = null;
  for (let i = 0; i < 20; i++) {
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
    await sleep(200);
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
            }, 12000);
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

function wakeMarker(text) {
  const t = String(text || "").trim();
  if (/@airsup/i.test(t)) {
    const m = /@airsup[^\n]{0,48}/i.exec(t);
    return (m ? m[0] : "@airsup").trim();
  }
  return t.slice(0, Math.min(48, t.length));
}

function isNavLossError(msg) {
  return /Inspected target navigated or closed|execution context|Cannot find default|session closed|WebSocket/i.test(
    String(msg || "")
  );
}

async function attachPage() {
  let pages = await listPages();
  if (!pages.length) {
    await sleep(1200);
    pages = await listPages();
  }
  const page = pickChatGptPage(pages);
  const { ws, send } = await connectWs(page.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");
  try {
    await send("Page.bringToFront");
  } catch {}
  return { ws, send, page };
}

async function evaluateValue(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.result?.subtype === "error") {
    throw new Error(result.result.description || "evaluate error");
  }
  return result?.result?.value;
}

function pageFocusComposerExpression() {
  return `(() => {
    if (/\\/auth\\/|\\/log-in|\\/login/i.test(location.href)) {
      return { ok: false, error: "not_logged_in", href: location.href };
    }
    const el =
      document.querySelector("#prompt-textarea") ||
      document.querySelector('[data-testid="prompt-textarea"]') ||
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]');
    if (!el) return { ok: false, error: "composer_not_found", href: location.href };
    el.focus();
    try {
      document.execCommand("selectAll", false, null);
    } catch {}
    return { ok: true, href: location.href, tag: el.tagName };
  })()`;
}

function pageClickSendExpression() {
  return `(() => {
    const btn =
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label*="Send"]');
    if (btn && !btn.disabled) {
      btn.click();
      return { clicked: true };
    }
    return { clicked: false, disabled: !!(btn && btn.disabled) };
  })()`;
}

/** Strict: must be in a user message bubble, NOT merely in the composer/body. */
function pageVerifyExpression(marker) {
  const payload = JSON.stringify({ marker });
  return `(() => {
    const cfg = ${payload};
    const turns = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );
    const inTurns = turns.some((el) => (el.innerText || "").includes(cfg.marker));
    const composer =
      document.querySelector("#prompt-textarea") ||
      document.querySelector('[data-testid="prompt-textarea"]') ||
      document.querySelector('div.ProseMirror[contenteditable="true"]');
    const composerText = composer
      ? (composer.innerText || composer.textContent || "").trim()
      : "";
    const composerHas = cfg.marker
      ? composerText.includes(cfg.marker.slice(0, Math.min(24, cfg.marker.length)))
      : false;
    return {
      ok: inTurns && !composerHas,
      inTurns,
      composerHas,
      href: location.href,
      turnCount: turns.length,
    };
  })()`;
}

async function pressEnter(send) {
  const base = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function pollVerified(send, marker, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    await sleep(280);
    const v = await evaluateValue(send, pageVerifyExpression(marker));
    if (v && v.ok) return v;
  }
  return evaluateValue(send, pageVerifyExpression(marker));
}

async function sendViaCdp(text, newChat) {
  const marker = wakeMarker(text);
  let session = await attachPage();
  let { ws, send, page } = session;

  const reconnect = async (waitMs = 800) => {
    try {
      ws.close();
    } catch {}
    await sleep(waitMs);
    session = await attachPage();
    ws = session.ws;
    send = session.send;
    page = session.page;
    await waitForExecutionContext(send);
  };

  try {
    if (newChat || !/chatgpt\.com|openai\.com/i.test(page.url || "")) {
      try {
        await send("Page.navigate", { url: "https://chatgpt.com/" });
      } catch (e) {
        if (!isNavLossError(e.message)) throw e;
      }
      await reconnect(1400);
    } else {
      await waitForExecutionContext(send);
    }

    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const focus = await evaluateValue(send, pageFocusComposerExpression());
        if (!focus?.ok) {
          last = focus || { ok: false, error: "composer_not_found" };
          if (focus?.error === "not_logged_in") return focus;
          if (attempt < 1) {
            await reconnect(900);
            continue;
          }
          break;
        }

        // Real CDP text entry (React/ProseMirror listens to this; DOM hacks often don't).
        try {
          await send("Input.insertText", { text });
        } catch {
          // Fallback: execCommand path
          await evaluateValue(
            send,
            `(() => {
              const el = document.querySelector("#prompt-textarea") || document.querySelector('[data-testid="prompt-textarea"]') || document.querySelector('div.ProseMirror[contenteditable="true"]');
              if (!el) return false;
              el.focus();
              document.execCommand("selectAll", false, null);
              return document.execCommand("insertText", false, ${JSON.stringify(text)});
            })()`
          );
        }
        await sleep(200);

        const click = await evaluateValue(send, pageClickSendExpression());
        let method = click?.clicked ? "cdp_click_send" : "cdp_enter";
        if (!click?.clicked) {
          await pressEnter(send);
        }
        await sleep(200);

        // If still in composer, try Enter once more then click again.
        let verified = await pollVerified(send, marker, 6);
        if (!verified?.ok) {
          await pressEnter(send);
          const click2 = await evaluateValue(send, pageClickSendExpression());
          if (click2?.clicked) method = "cdp_click_send_retry";
          verified = await pollVerified(send, marker, 8);
        }

        if (verified?.ok) {
          return {
            ok: true,
            method,
            verified: true,
            href: verified.href,
            turnCount: verified.turnCount,
          };
        }
        last = {
          ok: false,
          error: "not_verified_in_chat",
          method,
          href: verified?.href,
          inTurns: verified?.inTurns,
          composerHas: verified?.composerHas,
        };
        if (attempt < 1) {
          await reconnect(900);
          continue;
        }
      } catch (e) {
        if (isNavLossError(e.message) && attempt < 1) {
          await reconnect(900);
          continue;
        }
        throw e;
      }
    }

    return last || { ok: false, error: "no_result" };
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

async function main() {
  const textB64 = process.argv[2];
  const newChat = (process.argv[3] || "1") !== "0";
  const mode = (process.argv[4] || "send").trim(); // send | verify
  if (!textB64) {
    console.log(JSON.stringify({ ok: false, error: "missing_text_b64" }));
    process.exit(2);
  }
  const text = Buffer.from(textB64, "base64").toString("utf8");
  if (!text.trim()) {
    console.log(JSON.stringify({ ok: false, error: "empty_text" }));
    process.exit(2);
  }

  let ensure = { restarted: false, mode: "attach" };
  let value;
  if (mode === "verify") {
    if (!(await cdpReady())) {
      console.log(JSON.stringify({ ok: false, error: "cdp_down" }));
      process.exit(1);
    }
    const session = await attachPage();
    try {
      await waitForExecutionContext(session.send);
      value = await evaluateValue(session.send, pageVerifyExpression(wakeMarker(text)));
    } finally {
      try {
        session.ws.close();
      } catch {}
    }
  } else {
    ensure = await ensureChromeCdp();
    value = await sendViaCdp(text, newChat);
  }
  const out = { ...(value || { ok: false, error: "no_result" }), ensure, marker: wakeMarker(text) };
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
