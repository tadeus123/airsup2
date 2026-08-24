#!/usr/bin/env node
/**
 * Fill ChatGPT email/password login via CDP (DOM), not pixels.
 * Args: node airsup-chatgpt-login.js <emailB64> <passwordB64>
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return String(e && e.stdout ? e.stdout : "");
  }
}

function displayEnv() {
  if (fs.existsSync("/tmp/.X11-unix/X99")) return ":99";
  if (fs.existsSync("/tmp/.X11-unix/X0")) return ":0";
  return ":99";
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
          this.emit("error", new Error("WS upgrade failed"));
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
      let maskOffset = offset;
      if (masked) {
        maskOffset = offset + 4;
        if (this._buffer.length < maskOffset + payloadLength) return;
      } else if (this._buffer.length < offset + payloadLength) return;
      let payload = this._buffer.slice(maskOffset, maskOffset + payloadLength);
      if (masked) {
        const mask = this._buffer.slice(offset, offset + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      this._buffer = this._buffer.slice(maskOffset + payloadLength);
      if (opcode === 1) this.emit("message", payload.toString());
      if (opcode === 8) this._socket.end();
    }
  }

  send(data) {
    const payload = Buffer.from(data);
    const header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | payload.length;
    if (payload.length >= 126) throw new Error("frame too large");
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    this._socket.write(Buffer.concat([header, mask, masked]));
  }

  close() {
    try {
      this._socket.end();
    } catch {}
  }
}

function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: CDP_PORT, path }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function cdpReady() {
  try {
    await httpGetJson("/json/version");
    return true;
  } catch {
    return false;
  }
}

function seedProfile() {
  if (!fs.existsSync(PROFILE_SRC)) return { seeded: false };
  sh(`rm -rf '${PROFILE_CDP}'`);
  sh(`cp -a '${PROFILE_SRC}' '${PROFILE_CDP}'`);
  sh(
    `rm -f '${PROFILE_CDP}/SingletonLock' '${PROFILE_CDP}/SingletonSocket' '${PROFILE_CDP}/SingletonCookie'`
  );
  return { seeded: true };
}

function launchChromeCdp(url) {
  const display = displayEnv();
  sh(
    `rm -f '${PROFILE_CDP}/SingletonLock' '${PROFILE_CDP}/SingletonSocket' '${PROFILE_CDP}/SingletonCookie'`
  );
  const cmd =
    `setsid env DISPLAY=${display} ${CHROME_BIN} ` +
    `--no-sandbox --disable-gpu --disable-dev-shm-usage ` +
    `--no-first-run --no-default-browser-check ` +
    `--hide-crash-restore-bubble --disable-session-crashed-bubble ` +
    `--remote-debugging-port=${CDP_PORT} --remote-allow-origins=* ` +
    `--user-data-dir=${PROFILE_CDP} --window-size=1280,720 ` +
    `${url} >/tmp/airsup-chrome.log 2>&1 < /dev/null &`;
  execSync(cmd, { stdio: "ignore", shell: "/bin/bash" });
}

async function ensureChromeCdp() {
  if (await cdpReady()) return;
  // Prefer attaching to already-open chrome (launched with --remote-debugging-port).
  for (let i = 0; i < 15; i++) {
    await sleep(300);
    if (await cdpReady()) return;
  }
  seedProfile();
  sh("pkill -9 -f '/opt/google/chrome/chrome' || true; pkill -9 -f 'google-chrome' || true");
  await sleep(600);
  launchChromeCdp("https://chatgpt.com/auth/login");
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await cdpReady()) return;
  }
  throw new Error("Chrome CDP did not come up");
}

async function connectWs(wsUrl) {
  const ws = new MinimalWebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "cdp error"));
        else resolve(msg.result);
      }
    } catch {}
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) {
          pending.delete(mid);
          reject(new Error("cdp timeout " + method));
        }
      }, 20000);
    });
  return { ws, send };
}

function loginExpression(email, password) {
  const emailJson = JSON.stringify(email);
  const passJson = JSON.stringify(password);
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const setNative = (el, value) => {
      el.focus();
      el.click();
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const isPhone = (el) => {
      const t = ((el.type || "") + " " + (el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "") + " " + (el.autocomplete || "")).toLowerCase();
      return el.type === "tel" || /phone|mobile|otp|sms/.test(t);
    };
    const findEmail = () => {
      const inputs = [...document.querySelectorAll("input")].filter((i) => !i.disabled && i.offsetParent !== null);
      return (
        inputs.find((i) => i.type === "email") ||
        inputs.find((i) => (i.autocomplete || "").toLowerCase() === "username") ||
        inputs.find((i) => /email/i.test(i.placeholder || "") && !isPhone(i)) ||
        inputs.find((i) => /email/i.test((i.name || "") + (i.id || "")) && !isPhone(i)) ||
        null
      );
    };
    const findPassword = () =>
      [...document.querySelectorAll("input")].find(
        (i) => i.type === "password" && !i.disabled && i.offsetParent !== null
      ) || null;
    const findContinue = () => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      return (
        buttons.find((b) => /^continue$/i.test((b.innerText || b.textContent || "").trim())) ||
        buttons.find((b) => /^(log\\s*in|sign\\s*in|next)$/i.test((b.innerText || b.textContent || "").trim())) ||
        null
      );
    };
    const clickEmailPath = () => {
      const buttons = [...document.querySelectorAll("button, a, [role='button']")];
      const emailBtn = buttons.find((b) => {
        const t = (b.innerText || b.textContent || "").trim().toLowerCase();
        return t === "continue with email" || t === "email" || t === "use email";
      });
      if (emailBtn) {
        emailBtn.click();
        return true;
      }
      return false;
    };

    if (!/chatgpt\\.com|openai\\.com|auth\\.openai\\.com/i.test(location.hostname)) {
      location.href = "https://chatgpt.com/auth/login";
      await sleep(2000);
    }

    // Leave phone mode if stuck there
    const phoneErr = [...document.querySelectorAll("p, span, div")].some((n) =>
      /phone number is not valid/i.test(n.textContent || "")
    );
    if (phoneErr || document.querySelector('input[type="tel"]')) {
      clickEmailPath();
      await sleep(500);
    }

    let emailEl = null;
    for (let i = 0; i < 40; i++) {
      emailEl = findEmail();
      if (emailEl) break;
      clickEmailPath();
      await sleep(350);
    }
    if (!emailEl) {
      return {
        ok: false,
        error: "email_field_not_found",
        href: location.href,
        inputs: [...document.querySelectorAll("input")].map((i) => i.type + ":" + (i.placeholder || "")).slice(0, 8),
      };
    }

    setNative(emailEl, ${emailJson});
    await sleep(300);
    const cont = findContinue();
    if (cont) cont.click();
    else emailEl.form ? emailEl.form.requestSubmit() : emailEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

    let passEl = null;
    for (let i = 0; i < 40; i++) {
      await sleep(350);
      passEl = findPassword();
      if (passEl) break;
    }
    if (!passEl) return { ok: false, error: "password_field_not_found", href: location.href, emailSet: true };

    setNative(passEl, ${passJson});
    await sleep(300);
    const cont2 = findContinue();
    if (cont2) cont2.click();
    else passEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    return { ok: true, href: location.href };
  })()`;
}

async function main() {
  const email = Buffer.from(process.argv[2] || "", "base64").toString("utf8");
  const password = Buffer.from(process.argv[3] || "", "base64").toString("utf8");
  if (!email || !password) {
    console.log(JSON.stringify({ ok: false, error: "missing_args" }));
    process.exit(1);
  }

  await ensureChromeCdp();
  let pages = await httpGetJson("/json/list");
  if (!Array.isArray(pages) || !pages.length) {
    await sleep(1500);
    pages = await httpGetJson("/json/list");
  }
  const page =
    pages.find((p) => /chatgpt|openai/i.test(p.url || "")) ||
    pages.find((p) => p.type === "page") ||
    pages[0];
  if (!page || !page.webSocketDebuggerUrl) {
    console.log(JSON.stringify({ ok: false, error: "no_page" }));
    process.exit(1);
  }

  const { ws, send } = await connectWs(page.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");
  if (!/chatgpt|openai/i.test(page.url || "")) {
    await send("Page.navigate", { url: "https://chatgpt.com/auth/login" });
    await sleep(2500);
  }

  const result = await send("Runtime.evaluate", {
    expression: loginExpression(email, password),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result?.result?.value || { ok: false, error: "no_value" };
  console.log(JSON.stringify(value));
  try {
    ws.close();
  } catch {}
  process.exit(value.ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
