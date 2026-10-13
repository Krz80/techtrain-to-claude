// 共通ロジック（background.js と popup.js の両方で使う）
(function (root) {
  const KINDS = {
    basic: { label: "基礎", full: "基礎知識を学ぶ" },
    applied: { label: "応用", full: "応用知識を学ぶ" },
    quiz: { label: "クイズ", full: "スキル定着クイズ" },
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    client: "app", // "app" = デスクトップアプリ / "web" = ブラウザ
    dest: "new", // "new" = 毎回新しいチャット / "fixed" = いつものチャットかプロジェクト
    targetUrl: "", // dest が "fixed" のときのチャット or プロジェクトのURL
    autoSend: false,
    weeklyGoal: 5,
  };

  // TechTrainのボタン行の見出しから種別を判定
  function kindFromHeading(text) {
    if (!text) return null;
    if (text.includes("スキル定着クイズ")) return "quiz";
    if (text.includes("応用知識を学ぶ")) return "applied";
    if (text.includes("基礎知識を学ぶ")) return "basic";
    return null;
  }

  // ボタン情報が取れなかったとき用に、プロンプト本文から推測
  function kindFromPrompt(prompt) {
    const p = prompt || "";
    if (/クイズ|3択|三択|選択肢/.test(p)) return "quiz";
    if (/応用|実務|実践的/.test(p)) return "applied";
    return "basic";
  }

  // 「・技術トピック：「…」」のような行から値を取り出す
  function pickLine(prompt, keys) {
    const lines = (prompt || "").split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*[・\-*]?\s*([^：:]+)[：:]\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      if (keys.some((k) => key.includes(k))) {
        return m[2].trim().replace(/^「(.*)」$/, "$1").trim();
      }
    }
    return "";
  }

  function parsePrompt(prompt) {
    return {
      topic: pickLine(prompt, ["技術トピック", "トピック", "テーマ"]),
      tech: pickLine(prompt, ["関連する技術", "関連技術", "技術カテゴリ"]),
      purpose: pickLine(prompt, ["目的"]),
    };
  }

  // ChatGPTのURLからプロンプトを取り出す（?prompt= と ?q= の両方に対応）
  function promptFromUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (!/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(host)) return null;
      const p = u.searchParams.get("prompt") || u.searchParams.get("q");
      return p && p.trim() ? p : null;
    } catch (e) {
      return null;
    }
  }

  // 古い設定（v1.1まで）を今の形に直す
  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    if (raw && raw.mode && !raw.client) {
      s.client = raw.mode === "app" ? "app" : "web";
      s.dest = raw.mode === "project" && raw.projectUrl ? "fixed" : "new";
      s.targetUrl = raw.projectUrl || "";
    }
    delete s.mode;
    delete s.projectUrl;
    return s;
  }

  // https://claude.ai/chat/… または https://claude.ai/project/… を読み取る
  function parseTargetUrl(url) {
    const m = String(url || "").trim().match(/^https:\/\/claude\.ai\/(chat|project)\/([0-9a-zA-Z-]{8,})/);
    if (!m) return null;
    return { type: m[1], id: m[2], url: "https://claude.ai/" + m[1] + "/" + m[2] };
  }

  function fixedTarget(settings) {
    return settings.dest === "fixed" ? parseTargetUrl(settings.targetUrl) : null;
  }

  // アプリで決まったチャットを開くときは、リンクでプロンプトを渡せないので手で貼り付ける
  function needsManualPaste(settings) {
    return settings.client === "app" && !!fixedTarget(settings);
  }

  function buildTargetUrl(prompt, settings) {
    const t = fixedTarget(settings);
    if (settings.client === "app") {
      // Claudeデスクトップアプリのリンク。新しいチャットなら入力欄に入った状態で開く（自動送信はされない）
      return t ? "claude://claude.ai/" + t.type + "/" + t.id : "claude://claude.ai/new?q=" + encodeURIComponent(prompt);
    }
    // ブラウザで決まったチャット・プロジェクトを開くときは、入力は claude.js が行う
    return t ? t.url : "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  }

  const RATINGS = {
    3: { emoji: "😆", label: "バッチリ" },
    2: { emoji: "🙂", label: "だいたい" },
    1: { emoji: "🤔", label: "もう一回" },
  };

  // 振り返りまで終わった記録だけを「学習した」とみなす
  function isDone(e) {
    return e.status === "done";
  }
  function doneLogs(logs) {
    return logs.filter(isDone).map((e) => Object.assign({}, e, { at: e.doneAt || e.at }));
  }
  function pendingLogs(logs) {
    return logs.filter((e) => !isDone(e));
  }

  // ローカル時刻での YYYY-MM-DD
  function dayKey(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function addDays(ms, n) {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  function countByDay(logs) {
    const map = {};
    for (const e of logs) {
      const k = dayKey(e.at);
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }

  // 連続学習日数。今日まだやっていなくても昨日まで続いていれば継続中とみなす
  function streak(logs, now) {
    const days = countByDay(logs);
    let cursor = now;
    let doneToday = !!days[dayKey(now)];
    if (!doneToday) cursor = addDays(now, -1);
    let n = 0;
    while (days[dayKey(cursor)]) {
      n++;
      cursor = addDays(cursor, -1);
    }
    return { days: n, doneToday };
  }

  function longestStreak(logs) {
    const keys = Object.keys(countByDay(logs)).sort();
    let best = 0, cur = 0, prev = null;
    for (const k of keys) {
      if (prev) {
        const next = dayKey(addDays(new Date(prev + "T12:00:00").getTime(), 1));
        cur = next === k ? cur + 1 : 1;
      } else cur = 1;
      best = Math.max(best, cur);
      prev = k;
    }
    return best;
  }

  // 週は月曜はじまり
  function startOfWeek(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }

  function thisWeekCount(logs, now) {
    const s = startOfWeek(now);
    return logs.filter((e) => e.at >= s && e.at <= now).length;
  }

  const api = {
    KINDS, RATINGS, DEFAULT_SETTINGS, normalizeSettings, parseTargetUrl, fixedTarget, needsManualPaste, isDone, doneLogs, pendingLogs, kindFromHeading, kindFromPrompt, parsePrompt,
    promptFromUrl, buildTargetUrl, dayKey, addDays, countByDay, streak,
    longestStreak, startOfWeek, thisWeekCount,
  };
  root.TT = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
