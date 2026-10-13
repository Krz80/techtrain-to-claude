// TechTrainのページで「プロンプトを生成」が押されたら、どの行のボタンかを拡張機能に伝える
(function () {
  const HEADINGS = ["基礎知識を学ぶ", "応用知識を学ぶ", "スキル定着クイズ"];

  function findKind(el) {
    // ボタンから親をたどり、見出しを1つだけ含む一番近い要素を探す
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      const text = node.innerText || "";
      const hits = HEADINGS.filter((h) => text.includes(h));
      if (hits.length === 1) {
        if (hits[0] === "スキル定着クイズ") return "quiz";
        if (hits[0] === "応用知識を学ぶ") return "applied";
        return "basic";
      }
      if (hits.length > 1) break;
      node = node.parentElement;
    }
    // 見つからなければ、ページ内の「プロンプトを生成」ボタンの順番（基礎→応用→クイズ）で判断する
    const all = Array.from(document.querySelectorAll("button, a")).filter((b) =>
      (b.innerText || "").includes("プロンプトを生成")
    );
    const order = ["basic", "applied", "quiz"];
    const idx = all.indexOf(el);
    return all.length === 3 && idx >= 0 ? order[idx] : null;
  }

  function pageName() {
    const h1 = document.querySelector("h1");
    const t = (h1 && h1.innerText.trim()) || document.title || "";
    return t.replace(/\s*[|｜].*TechTrain.*$/i, "").trim().slice(0, 80);
  }

  // 拡張機能の更新時に注入し直すので、古い見張り役を外してから付け直す
  if (window.__ttClickHandler) document.removeEventListener("click", window.__ttClickHandler, true);
  window.__ttClickHandler = onClick;
  document.addEventListener("click", onClick, true);

  function onClick(ev) {
    const btn = ev.target && ev.target.closest && ev.target.closest("button, a");
    if (!btn) return;
    if (!(btn.innerText || "").includes("プロンプトを生成")) return;
    try {
      chrome.runtime
        .sendMessage({ type: "tt-click", kind: findKind(btn), page: pageName() })
        .catch(() => {});
    } catch (e) {
      // 拡張機能の更新直後などは送れないことがある
    }
  }
})();
