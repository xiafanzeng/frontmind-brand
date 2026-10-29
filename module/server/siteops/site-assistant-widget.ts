/**
 * Host-owned floating AI assistant for every trusted static website build.
 *
 * The widget is plain vanilla JavaScript with no dependencies so the immutable
 * static site keeps its no-framework guarantee. It talks only to the module
 * container's public site-assistant API; knowledge, citations and rate limits
 * stay server-side. Chat state persists in sessionStorage so navigation
 * between site pages keeps the multi-turn conversation.
 */

/** The brand module container's public origin is deterministic per deployment. */
export const SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT = "https://brand.frontmind.cn";

export const SITE_ASSISTANT_CONFIG_ASSET_PATH = "/assistant-config.js";
export const SITE_ASSISTANT_WIDGET_ASSET_PATH = "/assistant.js";
export const SITE_ASSISTANT_STYLES_ASSET_PATH = "/assistant.css";

/**
 * Every trusted renderer uses the same external, host-owned assets. Keeping
 * the frozen config out of inline script text lets preview CSP nonce the exact
 * files and avoids an executable customer-controlled inline boundary.
 */
export const TRUSTED_SITE_ASSISTANT_HEAD_MARKUP =
  `<link rel="stylesheet" href="${SITE_ASSISTANT_STYLES_ASSET_PATH}">` +
  `<script src="${SITE_ASSISTANT_CONFIG_ASSET_PATH}" defer></script>` +
  `<script src="${SITE_ASSISTANT_WIDGET_ASSET_PATH}" defer></script>`;

const trustedAssistantScriptPaths = new Set([
  SITE_ASSISTANT_CONFIG_ASSET_PATH,
  SITE_ASSISTANT_WIDGET_ASSET_PATH,
]);

export function isTrustedSiteAssistantExternalScriptTag(tag: string) {
  const attributes = tag
    .replace(/^<script\b/iu, "")
    .replace(/>$/u, "")
    .trim();
  const source = attributes.match(/\bsrc\s*=\s*(["'])([^"']+)\1/iu);
  if (!source || !trustedAssistantScriptPaths.has(source[2]!)) return false;
  if (!/\bdefer(?:\s*=|\s|$)/iu.test(attributes)) return false;
  return attributes
    .replace(source[0], "")
    .replace(
      /\bdefer(?:\s*=\s*(?:"(?:defer)?"|'(?:defer)?'|defer))?/giu,
      "",
    )
    .trim().length === 0;
}

export function trustedSiteAssistantConfigSource(
  config: Readonly<Record<string, unknown>>,
) {
  const serialized = JSON.stringify(config)
    .replaceAll("<", "\\u003c")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
  return `window.__FRONTMIND_ASSISTANT__=${serialized};\n`;
}

export function siteAssistantApiOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.FRONTMIND_SITE_ASSISTANT_API_ORIGIN?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (url.protocol === "https:" && !url.search && !url.hash) {
        return `${url.protocol}//${url.host}`;
      }
    } catch {
      // Fall through to the deterministic default on malformed overrides.
    }
  }
  return SITE_ASSISTANT_WIDGET_API_ORIGIN_DEFAULT;
}

export const TRUSTED_SITE_ASSISTANT_WIDGET_CSS = String.raw`.fma-root{--fma-accent:var(--accent,#34558b);--fma-ink:var(--ink,#182635);--fma-canvas:var(--canvas,#ffffff);--fma-muted:#f1f3f7;--fma-border:rgba(24,38,53,.14);position:relative;z-index:2147483000;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--fma-ink)}
.fm-assistant-launcher{position:fixed;right:20px;bottom:20px;width:54px;height:54px;border-radius:50%;border:none;background:var(--fma-accent);color:var(--fma-canvas);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 28px rgba(16,33,43,.28);transition:transform .16s ease}
.fm-assistant-launcher:hover{transform:translateY(-2px)}
.fm-assistant-launcher:focus-visible{outline:3px solid var(--fma-accent);outline-offset:3px}
.fm-assistant-panel{position:fixed;right:20px;bottom:86px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 130px));display:none;flex-direction:column;background:var(--fma-canvas);border:1px solid var(--fma-border);border-radius:16px;box-shadow:0 24px 64px rgba(16,33,43,.24);overflow:hidden}
.fm-assistant-panel[aria-hidden="false"]{display:flex}
.fm-assistant-header{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--fma-accent);color:var(--fma-canvas);flex:0 0 auto}
.fm-assistant-header strong{font-size:15px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fm-assistant-close{border:none;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px}
.fm-assistant-close:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.fm-assistant-messages{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:transparent}
.fm-assistant-note{font-size:12px;color:var(--fma-ink);opacity:.72;align-self:center;text-align:center}
.fm-assistant-bubble{max-width:86%;padding:10px 12px;border-radius:12px;font-size:14px;line-height:1.6;white-space:normal;word-break:break-word}
.fm-assistant-bubble p{margin:0 0 8px}
.fm-assistant-bubble p:last-child{margin-bottom:0}
.fm-assistant-bubble ul{margin:0 0 8px;padding-left:18px}
.fm-assistant-bubble li{margin:2px 0}
.fm-assistant-user{align-self:flex-end;background:var(--fma-accent);color:var(--fma-canvas);border-bottom-right-radius:4px}
.fm-assistant-answer{align-self:flex-start;background:var(--fma-muted);border-bottom-left-radius:4px}
.fm-assistant-error{align-self:flex-start;background:#fdecea;color:#8a1f18;border:1px solid rgba(138,31,24,.24)}
.fm-assistant-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.fm-assistant-source{font-size:12px;padding:3px 8px;border-radius:999px;background:var(--fma-canvas);border:1px solid var(--fma-border);color:var(--fma-ink)}
.fm-assistant-form{flex:0 0 auto;display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--fma-border);background:var(--fma-canvas)}
.fm-assistant-input{flex:1;min-width:0;resize:none;font:inherit;font-size:14px;line-height:1.5;padding:9px 11px;border:1px solid var(--fma-border);border-radius:10px;background:var(--fma-canvas);color:var(--fma-ink);max-height:96px}
.fm-assistant-input:focus-visible{outline:2px solid var(--fma-accent);outline-offset:1px}
.fm-assistant-send{flex:0 0 auto;border:none;border-radius:10px;padding:0 16px;font:inherit;font-size:14px;font-weight:600;background:var(--fma-accent);color:var(--fma-canvas);cursor:pointer}
.fm-assistant-send:disabled{opacity:.45;cursor:default}
.fm-assistant-send:focus-visible{outline:2px solid var(--fma-accent);outline-offset:2px}
@media (max-width:560px){.fm-assistant-launcher{right:14px;bottom:14px}.fm-assistant-panel{right:8px;left:8px;bottom:78px;width:auto;height:min(70vh,520px)}.fm-assistant-bubble{max-width:92%}}
@media (prefers-reduced-motion:reduce){.fm-assistant-launcher,.fm-assistant-panel{transition:none}}
`;

export const TRUSTED_SITE_ASSISTANT_WIDGET_SOURCE = String.raw`(function () {
  "use strict";
  var bootConfig = window.__FRONTMIND_ASSISTANT__;
  if (!bootConfig || typeof bootConfig.apiBase !== "string" || !/^https:\/\//.test(bootConfig.apiBase)) return;
  var apiBase = bootConfig.apiBase.replace(/\/+$/, "") + "/api/public/site-assistant";
  var MAX_QUESTION = 500;
  var binding = bootConfig.binding && typeof bootConfig.binding === "object"
    && typeof bootConfig.binding.knowledgeArchiveHash === "string"
    && typeof bootConfig.binding.signature === "string"
      ? bootConfig.binding
      : null;
  // Sessions are keyed on the binding's knowledge identity: a new knowledge
  // snapshot always starts a fresh conversation, while pure visual revisions
  // of the same knowledge keep the transcript.
  var storageKey = "fm-assistant:" + apiBase + (binding
    ? ":" + binding.knowledgeSnapshotId + ":" + binding.knowledgeArchiveHash
    : "");
  var frozenName = typeof bootConfig.name === "string" && bootConfig.name.trim() ? bootConfig.name.trim() : null;
  var frozenWelcome = typeof bootConfig.welcome === "string" && bootConfig.welcome.trim() ? bootConfig.welcome.trim() : null;
  var frozenAccent = typeof bootConfig.accent === "string" && /^#[0-9a-f]{6}$/i.test(bootConfig.accent) ? bootConfig.accent : null;
  var designConfig = bootConfig.design && typeof bootConfig.design === "object" ? bootConfig.design : null;
  var previewBridge = window.__FRONTMIND_SITEOPS_PREVIEW_BRIDGE__ && typeof window.__FRONTMIND_SITEOPS_PREVIEW_BRIDGE__ === "object"
    ? window.__FRONTMIND_SITEOPS_PREVIEW_BRIDGE__
    : null;
  // Trusted preview bridge: inside the owner-only embed preview, report every
  // RENDERED real answer (a policy refusal arrives as a 200 answer as well) to
  // the embedding dashboard. Errors, timeouts and local notes never report, so
  // they can never count as a completed trial.
  function reportRenderedAnswerToParent() {
    if (!previewBridge || !binding) return;
    if (window.parent === window) return;
    try {
      window.parent.postMessage({
        schemaVersion: 1,
        kind: "frontmind_site_assistant_answer_rendered",
        token: previewBridge.token,
        buildId: previewBridge.buildId,
        knowledgeSnapshotId: binding.knowledgeSnapshotId,
        knowledgeArchiveHash: binding.knowledgeArchiveHash,
        designRevision: binding.designRevision,
        draftHash: binding.draftHash,
        assistantName: binding.assistantName,
        welcome: binding.welcome
      }, "*");
    } catch (error) { /* the preview bridge is best-effort for the trial gate */ }
  }

  function normalizedPath(value) {
    try {
      var pathname = new URL(value, document.baseURI).pathname.replace(/\/+$/, "");
      return pathname || "/";
    } catch (error) { return null; }
  }

  function applyFrozenSiteDesign() {
    if (!designConfig) return;
    var siteAccent = typeof designConfig.siteAccent === "string" && /^#[0-9a-f]{6}$/i.test(designConfig.siteAccent)
      ? designConfig.siteAccent : null;
    if (siteAccent) {
      document.documentElement.style.setProperty("--frontmind-site-accent", siteAccent);
      document.documentElement.style.setProperty("--accent", siteAccent, "important");
      document.documentElement.style.setProperty("accent-color", siteAccent);
      var theme = document.querySelector('meta[name="theme-color"]');
      if (!theme) {
        theme = document.createElement("meta");
        theme.setAttribute("name", "theme-color");
        document.head.appendChild(theme);
      }
      if (theme.getAttribute("content") !== siteAccent) theme.setAttribute("content", siteAccent);
    }
    if (!Array.isArray(designConfig.navigation) || !Array.isArray(designConfig.allRoutePaths)) return;
    var allPaths = designConfig.allRoutePaths.map(normalizedPath).filter(Boolean);
    var featured = designConfig.navigation.map(function (item) {
      return item && typeof item.href === "string" && typeof item.title === "string"
        ? { href: item.href, path: normalizedPath(item.href), title: item.title }
        : null;
    }).filter(Boolean);
    var allPathSet = new Set(allPaths);
    var featuredIndex = new Map(featured.map(function (item, index) { return [item.path, index]; }));
    var navigations = document.querySelectorAll("header nav, nav[aria-label], [role=navigation]");
    for (var navIndex = 0; navIndex < navigations.length; navIndex += 1) {
      var nav = navigations[navIndex];
      if (nav.closest(".fma-root")) continue;
      var routeAnchors = Array.from(nav.querySelectorAll("a[href]")).filter(function (anchor) {
        var className = typeof anchor.className === "string" ? anchor.className : "";
        return allPathSet.has(normalizedPath(anchor.getAttribute("href") || "")) &&
          !anchor.querySelector("img,svg") && !/(?:^|[-_\s])brand(?:$|[-_\s])/i.test(className);
      });
      if (!routeAnchors.length && featured.length) continue;
      var candidates = new Map();
      routeAnchors.forEach(function (anchor) {
        var current = anchor.parentElement;
        var depth = 0;
        while (current && current !== nav) {
          var value = candidates.get(current) || { count: 0, depth: depth };
          value.count += 1;
          value.depth = Math.max(value.depth, depth);
          candidates.set(current, value);
          current = current.parentElement;
          depth += 1;
        }
      });
      var container = nav;
      var bestCount = 0;
      var bestDepth = -1;
      candidates.forEach(function (value, candidate) {
        if (value.count > bestCount || (value.count === bestCount && value.depth > bestDepth)) {
          container = candidate;
          bestCount = value.count;
          bestDepth = value.depth;
        }
      });
      var found = new Set();
      routeAnchors.forEach(function (anchor) {
        if (!container.contains(anchor)) return;
        var path = normalizedPath(anchor.getAttribute("href") || "");
        var index = featuredIndex.has(path) ? featuredIndex.get(path) : -1;
        var wrapper = anchor;
        while (wrapper.parentElement && wrapper.parentElement !== container) wrapper = wrapper.parentElement;
        if (wrapper.hidden !== (index < 0)) wrapper.hidden = index < 0;
        if (index >= 0) {
          wrapper.style.order = String(index);
          var item = featured[index];
          if (anchor.textContent.trim() !== item.title) anchor.textContent = item.title;
          found.add(path);
        }
      });
      featured.forEach(function (item, index) {
        if (found.has(item.path)) return;
        var anchor = document.createElement("a");
        anchor.href = item.href;
        anchor.textContent = item.title;
        anchor.style.order = String(index);
        anchor.setAttribute("data-frontmind-featured-route", "true");
        container.appendChild(anchor);
      });
      container.setAttribute("data-frontmind-site-navigation", "featured");
      break;
    }
  }

  function watchFrozenSiteDesign() {
    if (!designConfig) return;
    applyFrozenSiteDesign();
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; applyFrozenSiteDesign(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  function renderMarkdownLite(value) {
    var blocks = String(value).split(/\n{2,}/);
    var html = "";
    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index].trim();
      if (!block) continue;
      var lines = block.split(/\n/);
      var isList = lines.length > 0 && lines.every(function (line) { return /^\s*(?:[-*•]|\d+[.、)])\s+/.test(line); });
      if (isList) {
        html += "<ul>" + lines.map(function (line) {
          return "<li>" + escapeHtml(line.replace(/^\s*(?:[-*•]|\d+[.、)])\s+/, "")).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>") + "</li>";
        }).join("") + "</ul>";
      } else {
        html += "<p>" + escapeHtml(block).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>") + "</p>";
      }
    }
    return html || "<p></p>";
  }

  var transcript = [];
  try {
    var saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (saved && Array.isArray(saved.transcript) && (typeof saved.session === "string" || saved.session === null)) {
      transcript = saved.transcript.slice(-40);
    }
  } catch (error) { transcript = []; }
  var session = null;
  for (var back = transcript.length - 1; back >= 0; back -= 1) {
    if (transcript[back].session) { session = transcript[back].session; break; }
  }
  function persist(nextSession) {
    session = nextSession;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ session: session, transcript: transcript.slice(-40) })); } catch (error) { /* storage full or unavailable */ }
  }

  var state = { open: false, ready: false, unavailable: false, configInFlight: false, busy: false };
  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "fm-assistant-launcher";
  launcher.setAttribute("aria-label", "打开 AI 助手");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.4 3.3A.6.6 0 0 1 4.6 19v-3.1A2.5 2.5 0 0 1 4 14.5z" fill="currentColor" opacity=".92"/><path d="M8.4 8.5h7.2M8.4 11.5h4.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';

  var panel = document.createElement("div");
  panel.className = "fm-assistant-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI 助手");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML =
    '<div class="fm-assistant-header"><strong id="fma-title">AI 助手</strong>' +
    '<button type="button" class="fm-assistant-close" aria-label="关闭 AI 助手">×</button></div>' +
    '<div class="fm-assistant-messages" aria-live="polite"></div>' +
    '<form class="fm-assistant-form"><textarea class="fm-assistant-input" rows="1" placeholder="输入你的问题…" aria-label="输入你的问题" maxlength="' + (MAX_QUESTION + 20) + '"></textarea>' +
    '<button type="submit" class="fm-assistant-send">发送</button></form>';

  var messages, input, send, title;
  function mount() {
    var root = document.createElement("div");
    root.className = "fma-root";
    if (frozenAccent) root.style.setProperty("--fma-accent", frozenAccent);
    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);
    messages = panel.querySelector(".fm-assistant-messages");
    input = panel.querySelector(".fm-assistant-input");
    send = panel.querySelector(".fm-assistant-send");
    title = panel.querySelector("#fma-title");
    if (frozenName) {
      title.textContent = frozenName;
      panel.setAttribute("aria-label", frozenName);
      launcher.setAttribute("aria-label", "打开" + frozenName);
    }
    panel.querySelector(".fm-assistant-close").addEventListener("click", function () { setOpen(false); });
    panel.querySelector(".fm-assistant-form").addEventListener("submit", function (event) {
      event.preventDefault();
      void ask();
    });
    input.addEventListener("keydown", function (event) {
      // 中文输入法组合期（选字回车 / keyCode 229）不得触发提交，否则会打断
      // 候选确认或把未上屏的拼音当问题发出。
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void ask();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.open) setOpen(false);
    });
    launcher.addEventListener("click", function () { setOpen(!state.open); });
    for (var index = 0; index < transcript.length; index += 1) appendBubble(transcript[index]);
    if (!transcript.length) appendBubble({ kind: "note", text: frozenWelcome || "你好，我是本站的 AI 助手，可以就网站内容向你解答。" });
    watchFrozenSiteDesign();
  }

  function appendBubble(entry) {
    if (entry.kind === "note") {
      var note = document.createElement("p");
      note.className = "fm-assistant-note";
      note.textContent = entry.text;
      messages.appendChild(note);
      return;
    }
    var wrapper = document.createElement("div");
    wrapper.className = "fm-assistant-bubble " + (entry.kind === "user" ? "fm-assistant-user" : entry.kind === "error" ? "fm-assistant-error" : "fm-assistant-answer");
    if (entry.kind === "user") {
      wrapper.textContent = entry.text;
    } else {
      wrapper.innerHTML = renderMarkdownLite(entry.text);
      if (entry.sources && entry.sources.length) {
        var chips = document.createElement("div");
        chips.className = "fm-assistant-sources";
        chips.setAttribute("aria-label", "回答来源");
        for (var index = 0; index < entry.sources.length; index += 1) {
          var chip = document.createElement("span");
          chip.className = "fm-assistant-source";
          chip.textContent = "来源：" + entry.sources[index].title;
          chips.appendChild(chip);
        }
        wrapper.appendChild(chips);
      }
    }
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
  }

  function setOpen(open) {
    state.open = open;
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      // A previous failure is never terminal: every fresh open retries.
      if (!state.ready && !state.configInFlight) void loadConfig();
      input.focus();
    }
  }

  function loadConfig() {
    state.configInFlight = true;
    return fetch(apiBase + "/config", { headers: { accept: "application/json" } })
      .then(function (response) { if (!response.ok) throw new Error("unavailable"); return response.json(); })
      .then(function (body) {
        state.ready = true;
        state.unavailable = false;
        if (!frozenName && body.assistant && typeof body.assistant.name === "string") {
          title.textContent = body.assistant.name;
          launcher.setAttribute("aria-label", "打开" + body.assistant.name);
        }
        if (!body.knowledgeBase) {
          state.unavailable = true;
          transcript.push({ kind: "note", text: "本站尚未发布可用的知识库，AI 助手暂不能回答。" });
          appendBubble(transcript[transcript.length - 1]);
        }
      })
      .catch(function () {
        state.unavailable = true;
        transcript.push({ kind: "note", text: "AI 助手暂时不可用，请刷新页面或稍后再试。" });
        appendBubble(transcript[transcript.length - 1]);
      })
      .then(function () { state.configInFlight = false; });
  }

  function ask() {
    if (state.busy) return;
    // Never swallow a send silently: an unavailable assistant gets one
    // reconnect attempt, and the visitor always sees what happened.
    if (state.unavailable) {
      if (state.configInFlight) return;
      var question0 = (input.value || "").trim();
      appendBubble({ kind: "note", text: "正在重新连接 AI 助手…" });
      void loadConfig().then(function () {
        if (state.ready && !state.unavailable && question0) ask();
      });
      return;
    }
    var question = (input.value || "").trim().slice(0, MAX_QUESTION);
    if (!question) return;
    input.value = "";
    transcript.push({ kind: "user", text: question });
    appendBubble(transcript[transcript.length - 1]);
    state.busy = true;
    send.disabled = true;
    input.disabled = true;
    var pending = { kind: "note", text: "正在思考…" };
    appendBubble(pending);
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 170000);
    fetch(apiBase + "/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: question, session: session, binding: binding }),
      signal: controller.signal,
    })
      .then(function (response) {
        return response.json().then(function (body) { return { status: response.status, body: body }; });
      })
      .then(function (result) {
        if (messages.lastElementChild && messages.lastElementChild.textContent === pending.text) messages.removeChild(messages.lastElementChild);
        if (result.status === 200 && result.body && result.body.answer) {
          transcript.push({ kind: "answer", text: result.body.answer.text, sources: result.body.answer.sources || [], session: result.body.session });
          persist(result.body.session || session);
          appendBubble(transcript[transcript.length - 1]);
          reportRenderedAnswerToParent();
        } else {
          var message = result.body && result.body.error && typeof result.body.error.message === "string"
            ? result.body.error.message
            : "回答未能生成，请稍后再试。";
          transcript.push({ kind: "error", text: message, session: (result.body && result.body.session) || session });
          persist((result.body && result.body.session) || session);
          appendBubble(transcript[transcript.length - 1]);
        }
      })
      .catch(function () {
        if (messages.lastElementChild && messages.lastElementChild.textContent === pending.text) messages.removeChild(messages.lastElementChild);
        transcript.push({ kind: "error", text: "网络连接失败，请稍后再试。" });
        appendBubble(transcript[transcript.length - 1]);
      })
      .then(function () {
        clearTimeout(timeout);
        state.busy = false;
        send.disabled = false;
        input.disabled = false;
        input.focus();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
`;
