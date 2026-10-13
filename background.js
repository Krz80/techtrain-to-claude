importScripts("lib.js");

// TechTrainで直前に押されたボタンの情報（種別・ページ名）
let lastClick = null;

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return TT.normalizeSettings(settings);
}

async function getLogs() {
  const { logs } = await chrome.storage.local.get("logs");
  return logs || [];
}

// アイコンの数字：振り返り待ちがあればその数（オレンジ）、なければ今日の学習回数（緑）
async function refreshBadge() {
  const settings = await getSettings();
  if (!settings.enabled) {
    await chrome.action.setBadgeText({ text: "OFF" });
    await chrome.action.setBadgeBackgroundColor({ color: "#8a8478" });
    return;
  }
  const logs = await getLogs();
  const pending = TT.pendingLogs(logs).length;
  if (pending) {
    await chrome.action.setBadgeText({ text: String(pending) });
    await chrome.action.setBadgeBackgroundColor({ color: "#d97757" });
    await chrome.action.setTitle({ title: `振り返り待ちが ${pending} 件あります` });
    return;
  }
  const today = TT.dayKey(Date.now());
  const n = TT.doneLogs(logs).filter((e) => TT.dayKey(e.at) === today).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#3f9b6c" });
  await chrome.action.setTitle({ title: "TechTrain → Claude" });
}

chrome.runtime.onInstalled.addListener(async () => {
  refreshBadge();
  // 拡張機能を入れた・更新した時点で開いていたTechTrainのタブは、そのままだとボタンの種類を読めない。
  // ページを再読み込みしなくても動くように、ここで読み込み直す
  const tabs = await chrome.tabs.query({ url: ["https://techtrain.dev/*", "https://*.techtrain.dev/*"] });
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["techtrain.js"] }).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.logs || changes.settings) refreshBadge();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "tt-click") {
    lastClick = { kind: msg.kind, page: msg.page, at: Date.now() };
    chrome.storage.session.set({ lastClick });
  }
  if (msg && msg.type === "reopen" && msg.id) {
    getLogs().then((logs) => {
      const e = logs.find((x) => x.id === msg.id);
      if (e) openInClaude(e, null).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
});

function studyPageUrl(id, launch) {
  return chrome.runtime.getURL("study.html") + "?id=" + encodeURIComponent(id) + (launch ? "&launch=1" : "");
}

async function openInClaude(entry, tabId) {
  const settings = await getSettings();
  let url;
  if (settings.client === "app") {
    // ChatGPTのタブは「学習ページ」に置き換え、そこからアプリを起動する
    url = studyPageUrl(entry.id, true);
  } else {
    await chrome.storage.local.set({
      pending: { prompt: entry.prompt, at: Date.now(), autoSend: !!settings.autoSend },
    });
    url = TT.buildTargetUrl(entry.prompt, settings);
  }
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.create({ url });
}

async function recordLog(prompt) {
  if (!lastClick) {
    const s = await chrome.storage.session.get("lastClick");
    lastClick = s.lastClick || null;
  }
  // ボタンを押してから15秒以内なら、そのボタンの情報を使う
  const click = lastClick && Date.now() - lastClick.at < 15000 ? lastClick : null;
  const parsed = TT.parsePrompt(prompt);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    status: "open", // 振り返りが終わると "done"
    kind: (click && click.kind) || TT.kindFromPrompt(prompt),
    kindSource: click && click.kind ? "click" : "guess", // guess = ボタンが読めず本文から推定
    topic: parsed.topic,
    tech: parsed.tech,
    purpose: parsed.purpose,
    page: (click && click.page) || "",
    prompt,
  };
  const logs = await getLogs();
  logs.push(entry);
  await chrome.storage.local.set({ logs });
  lastClick = null;
  chrome.storage.session.remove("lastClick");
  return entry;
}

async function handleNavigation(details) {
  if (details.frameId !== 0) return;
  const prompt = TT.promptFromUrl(details.url);
  if (!prompt) return;
  const settings = await getSettings();
  if (!settings.enabled) return;
  // TechTrainは ?prompt= を使う。?q= の場合はTechTrainでボタンを押した直後だけ転送する
  if (!new URL(details.url).searchParams.has("prompt")) {
    const s = lastClick || (await chrome.storage.session.get("lastClick")).lastClick;
    if (!s || Date.now() - s.at > 15000) return;
  }
  const entry = await recordLog(prompt);
  await openInClaude(entry, details.tabId);
}

const filter = {
  url: [
    { hostEquals: "chatgpt.com", queryContains: "prompt=" },
    { hostEquals: "chatgpt.com", queryContains: "q=" },
    { hostEquals: "chat.openai.com", queryContains: "prompt=" },
    { hostEquals: "chat.openai.com", queryContains: "q=" },
  ],
};
chrome.webNavigation.onBeforeNavigate.addListener(handleNavigation, filter);
