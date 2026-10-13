const $ = (id) => document.getElementById(id);
let settings = TT.normalizeSettings({});
let logs = [];

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function load() {
  const data = await chrome.storage.local.get(["settings", "logs"]);
  settings = TT.normalizeSettings(data.settings);
  logs = (data.logs || []).slice().sort((a, b) => a.at - b.at);
  renderAll();
}

async function saveSettings() {
  await chrome.storage.local.set({ settings });
  $("saved").textContent = "保存しました";
  clearTimeout(saveSettings.t);
  saveSettings.t = setTimeout(() => ($("saved").textContent = ""), 1500);
}

function renderAll() {
  renderHeader();
  renderStats();
  renderHistory();
  renderSettings();
}

function renderHeader() {
  $("enabled").checked = settings.enabled;
  $("swLabel").textContent = settings.enabled ? "ON" : "OFF";
}

function studyUrl(id) {
  return chrome.runtime.getURL("study.html") + "?id=" + encodeURIComponent(id);
}

function renderPending() {
  const pend = TT.pendingLogs(logs).slice().reverse();
  $("pendingCard").hidden = !pend.length;
  $("pendingList").innerHTML = pend
    .map((e) => {
      const d = new Date(e.at);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const kind = TT.KINDS[e.kind] ? e.kind : "basic";
      return `<div class="p-item"><span class="chip ${kind}">${TT.KINDS[kind].label}</span>
        <div class="p-title">${esc(e.topic || e.page || "TechTrainの学習")}<small>${when} に開始</small></div>
        <button class="btn primary" data-reflect="${e.id}">振り返る</button></div>`;
    })
    .join("");
}

function renderStats() {
  renderPending();
  const now = Date.now();
  const all = logs;
  const logsDone = TT.doneLogs(all);
  const s = TT.streak(logsDone, now);
  const todayKey = TT.dayKey(now);
  const todayCount = logsDone.filter((e) => TT.dayKey(e.at) === todayKey).length;

  $("streak").textContent = s.days;
  $("flame").classList.toggle("lit", s.doneToday);
  $("streakNote").textContent = !logsDone.length
    ? "学習のあとに振り返ると、ここに記録されます"
    : s.doneToday
    ? "今日もクリア！この調子で続けよう"
    : s.days
    ? `今日やれば ${s.days + 1} 日連続！`
    : "今日から新しい連続記録を始めよう";
  $("today").textContent = todayCount;
  $("total").textContent = logsDone.length;
  $("best").textContent = TT.longestStreak(logsDone);

  const week = TT.thisWeekCount(logsDone, now);
  const goal = Math.max(1, settings.weeklyGoal || 5);
  $("goalText").textContent = week >= goal ? `${week} / ${goal} 回　達成！` : `${week} / ${goal} 回`;
  $("goalBar").style.width = Math.min(100, (week / goal) * 100) + "%";

  // 学習カレンダー（月曜はじまり、17週ぶん）
  const byDay = TT.countByDay(logsDone);
  const weeks = 17;
  const start = TT.addDays(TT.startOfWeek(now), -7 * (weeks - 1));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const t = TT.addDays(start, i);
    const k = TT.dayKey(t);
    const n = byDay[k] || 0;
    const lv = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
    const future = t > now && k !== todayKey;
    cells.push(
      `<div class="${lv ? "l" + lv : ""}${k === todayKey ? " today" : ""}" title="${k}：${n}回"${future ? ' style="visibility:hidden"' : ""}></div>`
    );
  }
  $("heat").innerHTML = cells.join("");

  // ステップ別
  const counts = { basic: 0, applied: 0, quiz: 0 };
  logsDone.forEach((e) => (counts[e.kind] = (counts[e.kind] || 0) + 1));
  const max = Math.max(1, ...Object.values(counts));
  $("kinds").innerHTML = Object.keys(TT.KINDS)
    .map(
      (k) => `<div class="row"><span class="chip ${k}">${TT.KINDS[k].label}</span>
        <div class="bar"><i style="width:${(counts[k] / max) * 100}%;background:var(--${k})"></i></div><b>${counts[k]}</b></div>`
    )
    .join("");

  // よく学んだ技術
  const techs = {};
  logsDone.forEach((e) => {
    const t = (e.tech || "").trim();
    if (t) techs[t] = (techs[t] || 0) + 1;
  });
  const top = Object.entries(techs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("techs").innerHTML = top.length
    ? top.map(([t, n]) => `<span class="tag">${esc(t)}<b>${n}</b></span>`).join("")
    : '<span class="note">まだありません</span>';
}

function renderHistory() {
  const q = $("q").value.trim().toLowerCase();
  const items = logs
    .slice()
    .reverse()
    .filter((e) => !q || [e.topic, e.tech, e.page, e.purpose, e.memo].join(" ").toLowerCase().includes(q));
  if (!items.length) {
    $("list").innerHTML = `<div class="empty">${logs.length ? "見つかりませんでした" : "まだ記録がありません"}</div>`;
    return;
  }
  let html = "";
  let lastDay = "";
  const wd = ["日", "月", "火", "水", "木", "金", "土"];
  for (const e of items) {
    const d = new Date(e.at);
    const k = TT.dayKey(e.at);
    if (k !== lastDay) {
      html += `<div class="day">${d.getMonth() + 1}月${d.getDate()}日（${wd[d.getDay()]}）</div>`;
      lastDay = k;
    }
    const time = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    const kind = TT.KINDS[e.kind] ? e.kind : "basic";
    const title = e.topic || e.page || e.purpose || "（トピック不明）";
    const meta = [time, e.tech, e.page && e.page !== title ? e.page : ""].filter(Boolean).map(esc).join(" ・ ");
    const done = TT.isDone(e);
    const r = TT.RATINGS[e.rating];
    const status = done ? (r ? `<span title="${r.label}">${r.emoji}</span>` : "") : '<span class="wait">振り返り待ち</span>';
    html += `<div class="item">
      <div class="top"><span class="chip ${kind}">${TT.KINDS[kind].label}</span><div class="topic">${esc(title)}</div>${status}</div>
      <div class="meta">${meta}</div>
      ${done && e.memo ? `<div class="memo">${esc(e.memo)}</div>` : ""}
      <div class="acts">${done ? `<button class="btn" data-reflect="${e.id}">詳細・編集</button>` : `<button class="btn primary" data-reflect="${e.id}">振り返る</button>`}
      <button class="btn" data-open="${e.id}">Claudeでもう一度開く</button>
      <button class="btn" data-del="${e.id}">削除</button></div></div>`;
  }
  $("list").innerHTML = html;
}

function renderSettings() {
  document.querySelectorAll('input[name="client"]').forEach((r) => (r.checked = r.value === settings.client));
  document.querySelectorAll('input[name="dest"]').forEach((r) => (r.checked = r.value === settings.dest));
  $("targetBox").hidden = settings.dest !== "fixed";
  if (document.activeElement !== $("targetUrl")) $("targetUrl").value = settings.targetUrl || "";
  renderTargetHint();
  $("autoSendField").hidden = settings.client === "app";
  $("autoSend").checked = !!settings.autoSend;
  $("weeklyGoal").value = settings.weeklyGoal;
}

// --- イベント ---
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== b.dataset.tab));
  })
);

$("enabled").addEventListener("change", (e) => {
  settings.enabled = e.target.checked;
  renderHeader();
  saveSettings();
});

function renderTargetHint(error) {
  const hint = $("targetHint");
  hint.classList.toggle("err", !!error);
  if (error) return (hint.textContent = error);
  const t = TT.parseTargetUrl(settings.targetUrl);
  if (!t) {
    hint.textContent = "Claudeで使いたいチャットかプロジェクトを開いて、アドレスバーのURLを貼り付けてください。";
  } else if (t.type === "chat" && settings.client === "app") {
    hint.textContent =
      "✓ チャットを登録しました。アプリのリンクはプロンプトを渡せないので、プロンプトは自動でコピーされます。開いたら Ctrl+V で貼り付けてください。";
  } else if (t.type === "project" && settings.client === "app") {
    hint.textContent =
      "✓ プロジェクトを登録しました。アプリではプロジェクトのページが開くので、新しいチャットを始めて Ctrl+V で貼り付けてください。";
  } else {
    hint.textContent = "✓ " + (t.type === "chat" ? "チャット" : "プロジェクト") + "を登録しました。開くとプロンプトが自動で入力されます。";
  }
}

document.querySelectorAll('input[name="client"], input[name="dest"]').forEach((r) =>
  r.addEventListener("change", () => {
    settings[r.name] = r.value;
    renderSettings();
    saveSettings();
  })
);

$("targetUrl").addEventListener("input", (e) => {
  const v = e.target.value.trim();
  if (!v) {
    settings.targetUrl = "";
    renderTargetHint();
    return saveSettings();
  }
  const t = TT.parseTargetUrl(v);
  if (!t) return renderTargetHint("https://claude.ai/chat/… か https://claude.ai/project/… の形のURLを入れてください");
  settings.targetUrl = t.url;
  renderTargetHint();
  saveSettings();
});

$("autoSend").addEventListener("change", (e) => {
  settings.autoSend = e.target.checked;
  saveSettings();
});

$("weeklyGoal").addEventListener("change", (e) => {
  const n = parseInt(e.target.value, 10);
  settings.weeklyGoal = n > 0 ? Math.min(99, n) : 5;
  e.target.value = settings.weeklyGoal;
  saveSettings();
  renderStats();
});

$("q").addEventListener("input", renderHistory);

document.addEventListener("click", (ev) => {
  const r = ev.target.closest("[data-reflect]");
  if (r) chrome.tabs.create({ url: studyUrl(r.dataset.reflect) });
});

$("list").addEventListener("click", async (ev) => {
  const open = ev.target.closest("[data-open]");
  const del = ev.target.closest("[data-del]");
  if (open) chrome.runtime.sendMessage({ type: "reopen", id: open.dataset.open });
  if (del && confirm("この記録を削除しますか？")) {
    logs = logs.filter((x) => x.id !== del.dataset.del);
    await chrome.storage.local.set({ logs });
    renderAll();
  }
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "techtrain-log-" + TT.dayKey(Date.now()) + ".json";
  a.click();
});

$("clear").addEventListener("click", async () => {
  if (!confirm("記録をすべて消します。元に戻せません。よろしいですか？")) return;
  logs = [];
  await chrome.storage.local.set({ logs });
  renderAll();
});

load();
