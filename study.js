const $ = (id) => document.getElementById(id);
const MIN_MEMO = 5;
const params = new URLSearchParams(location.search);
const id = params.get("id");
let entry = null;
let settings = Object.assign({}, TT.DEFAULT_SETTINGS);
let rating = 0;

async function getLogs() {
  const { logs } = await chrome.storage.local.get("logs");
  return logs || [];
}

async function updateEntry(patch) {
  const logs = await getLogs();
  const i = logs.findIndex((x) => x.id === id);
  if (i < 0) return;
  logs[i] = Object.assign({}, logs[i], patch);
  entry = logs[i];
  await chrome.storage.local.set({ logs });
  return logs;
}

// クリップボードにコピー。ページにフォーカスがなくても使える方法を順に試す
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

async function launchApp() {
  const s = Object.assign({}, settings, { client: "app" });
  const manual = TT.needsManualPaste(s);
  // アプリ側で入力されなかったときのために、どの設定でも先にコピーしておく
  const copied = await copyText(entry.prompt);
  $("launchHint").hidden = false;
  $("launchHint").textContent = !copied
    ? "Claudeアプリが開いたら、上の「プロンプトをコピー」を押してから入力欄に Ctrl+V で貼り付けてください。"
    : manual
    ? "プロンプトをコピーしました。Claudeアプリでいつものチャットが開いたら、入力欄に Ctrl+V で貼り付けて送信してください。"
    : "プロンプトをコピー済みです。アプリの入力欄が空だったら Ctrl+V で貼り付けてください。初回はChromeに「Claude を開きますか？」と出るので、「常に許可」にチェックして開いてください。";
  location.href = TT.buildTargetUrl(entry.prompt, s);
}

function openWeb() {
  chrome.storage.local.set({ pending: { prompt: entry.prompt, at: Date.now(), autoSend: !!settings.autoSend } });
  chrome.tabs.create({ url: TT.buildTargetUrl(entry.prompt, Object.assign({}, settings, { client: "web" })) });
}

function renderHead() {
  const kind = TT.KINDS[entry.kind] ? entry.kind : "basic";
  document.querySelectorAll(".kbtn").forEach((b) => b.classList.toggle("on", b.dataset.k === kind));
  $("kguess").hidden = entry.kindSource !== "guess";
  $("topic").textContent = entry.topic || entry.page || entry.purpose || "TechTrainの学習";
  const d = new Date(entry.at);
  const time = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} に開始`;
  $("meta").textContent = [entry.tech, entry.page && entry.page !== entry.topic ? entry.page : "", time].filter(Boolean).join(" ・ ");
  document.title = (entry.status === "done" ? "記録済み" : "学習中") + "：" + $("topic").textContent;
}

function setRating(r) {
  rating = r;
  document.querySelectorAll(".rate").forEach((b) => b.classList.toggle("on", Number(b.dataset.r) === r));
  validate();
}

function validate() {
  const len = $("memo").value.trim().length;
  $("count").textContent = len < MIN_MEMO ? `あと ${MIN_MEMO - len} 文字` : "OK！";
  $("save").disabled = !(rating && len >= MIN_MEMO);
  $("save").title = !rating ? "理解度を選んでください" : len < MIN_MEMO ? `${MIN_MEMO}文字以上書いてください` : "";
}

async function showDone() {
  const logs = await getLogs();
  const done = TT.doneLogs(logs);
  const now = Date.now();
  $("streak").textContent = TT.streak(done, now).days;
  const week = TT.thisWeekCount(done, now);
  const goal = Math.max(1, settings.weeklyGoal || 5);
  $("weekText").textContent = week >= goal ? `今週 ${week} / ${goal} 回　目標達成！🎉` : `今週 ${week} / ${goal} 回　あと ${goal - week} 回`;
  $("weekBar").style.width = Math.min(100, (week / goal) * 100) + "%";
  const r = TT.RATINGS[entry.rating];
  $("memoView").textContent = (r ? r.emoji + " " + r.label + "\n" : "") + (entry.memo || "");
  $("reflect").hidden = true;
  $("doneCard").hidden = false;
  renderHead();
}

function showForm() {
  $("doneCard").hidden = true;
  $("reflect").hidden = false;
  $("reflectTitle").textContent = entry.status === "done" ? "振り返りを書き直す" : "学習が終わったら、振り返って記録しよう";
  $("save").textContent = entry.status === "done" ? "更新する" : "記録する";
  $("memo").value = entry.memo || "";
  setRating(entry.rating || 0);
}

async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
}

async function init() {
  const data = await chrome.storage.local.get(["settings", "logs"]);
  settings = TT.normalizeSettings(data.settings);
  entry = (data.logs || []).find((x) => x.id === id);
  if (!entry) {
    $("missing").hidden = false;
    return;
  }
  $("main").hidden = false;
  renderHead();

  // ブラウザで開く設定のときは、ボタンの主従を入れ替える
  if (settings.client !== "app") {
    $("openWeb").classList.add("primary");
    $("openApp").classList.remove("primary");
  }

  if (entry.status === "done") showDone();
  else showForm();

  if (params.get("launch") === "1") {
    // 再読み込みで何度もアプリが開かないよう、URLから launch を消してから起動
    history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(id));
    launchApp();
  }
}

$("openApp").addEventListener("click", launchApp);
$("openWeb").addEventListener("click", openWeb);
$("copy").addEventListener("click", async () => {
  const ok = await copyText(entry.prompt);
  $("copy").textContent = ok ? "コピーしました" : "コピーできませんでした";
  setTimeout(() => ($("copy").textContent = "プロンプトをコピー"), 1500);
});
document.querySelectorAll(".rate").forEach((b) => b.addEventListener("click", () => setRating(Number(b.dataset.r))));
$("memo").addEventListener("input", validate);
$("memo").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("save").disabled) $("save").click();
});
$("save").addEventListener("click", async () => {
  await updateEntry({
    status: "done",
    doneAt: entry.doneAt || Date.now(),
    rating,
    memo: $("memo").value.trim(),
  });
  showDone();
});
$("edit").addEventListener("click", showForm);
document.querySelectorAll(".kbtn").forEach((b) =>
  b.addEventListener("click", async () => {
    await updateEntry({ kind: b.dataset.k, kindSource: "manual" });
    renderHead();
  })
);
$("close").addEventListener("click", closeTab);
$("skip").addEventListener("click", async () => {
  if (!confirm("この学習を記録から外します。よろしいですか？")) return;
  const logs = (await getLogs()).filter((x) => x.id !== id);
  await chrome.storage.local.set({ logs });
  closeTab();
});

init();
