// Claudeのページが開いたら、預かっているプロンプトを入力欄に入れる
// （新しいチャットは ?q= で自動入力されるので、そのときは何もしない）
(function () {
  const FRESH_MS = 90 * 1000;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(200);
    }
    return null;
  }

  function findEditor() {
    return (
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('fieldset [contenteditable="true"]')
    );
  }

  function editorText(ed) {
    return (ed.innerText || "").replace(/\s+/g, "");
  }

  function insert(ed, text) {
    ed.focus();
    // まず貼り付けとして入れる（改行が段落として保たれる）
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) {}
    if (editorText(ed)) return true;
    try {
      document.execCommand("insertText", false, text);
    } catch (e) {}
    return !!editorText(ed);
  }

  function findSendButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => {
      const label = (b.getAttribute("aria-label") || "").toLowerCase();
      return label.includes("send") || label.includes("送信");
    });
  }

  function showBanner(prompt) {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:12px 14px;" +
      "background:#2b2a27;color:#f5f1e8;border-radius:10px;font:13px/1.5 system-ui,sans-serif;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.25)";
    box.innerHTML =
      "<div style='margin-bottom:8px'>TechTrainのプロンプトを自動で入力できませんでした。コピーして貼り付けてください。</div>";
    const copy = document.createElement("button");
    copy.textContent = "プロンプトをコピー";
    copy.style.cssText =
      "background:#d97757;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;margin-right:6px";
    copy.onclick = async () => {
      await navigator.clipboard.writeText(prompt);
      copy.textContent = "コピーしました";
    };
    const close = document.createElement("button");
    close.textContent = "閉じる";
    close.style.cssText = "background:transparent;color:#f5f1e8;border:1px solid #6b665c;border-radius:6px;padding:6px 10px;cursor:pointer";
    close.onclick = () => box.remove();
    box.append(copy, close);
    document.body.appendChild(box);
  }

  async function run() {
    const { pending } = await chrome.storage.local.get("pending");
    if (!pending || Date.now() - pending.at > FRESH_MS) return;
    await chrome.storage.local.remove("pending");

    const ed = await waitFor(findEditor, 15000);
    if (!ed) return showBanner(pending.prompt);

    // ?q= 付きで開いたときは、Claude側の自動入力を少し待つ（二重入力を防ぐ）
    const hasQ = new URLSearchParams(location.search).has("q");
    await waitFor(() => editorText(ed), hasQ ? 3000 : 600);
    if (!editorText(ed) && !insert(ed, pending.prompt)) return showBanner(pending.prompt);

    if (pending.autoSend) {
      const btn = await waitFor(() => {
        const b = findSendButton();
        return b && !b.disabled ? b : null;
      }, 5000);
      if (btn) btn.click();
    }
  }

  run();
})();
