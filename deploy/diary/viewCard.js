// =========================================================
// diary/viewCard.js — 閲覧専用カード（マージ表示対応）
// =========================================================

import { loadDiaryByDate } from "./loadDiary.js";
import { loadLogsByDate, extractWorkForEdit, mergeWorkEntries } from "./work-summary.js";
import { loadTimestampRows } from "/common/timestamp.js?v=1";

/**
 * 閲覧専用カードを描画する
 */
export async function initViewPage() {

  const date = document.getElementById("diaryDate").value;
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "読み込み中…";

  const diary = await loadDiaryByDate(date);
  const logs = await loadLogsByDate(date);
  const timestampRows = await loadTimestampRows(date);
  const autoList = extractWorkForEdit(logs, timestampRows);
  const workList = normalizeViewGroups(mergeWorkEntries(autoList, timestampRows));

  if (!diary) {
    area.innerHTML = `
      <div class="card view-card">
        <p>この日の作業日誌はありません。</p>
      </div>
    `;
    return;
  }

  // ---------------------------------------------
  // 作業カード（折りたたみなし）
  // ---------------------------------------------
  let html = "";

  workList.forEach(w => {

    // 配列/文字列どちらでも表示できるように正規化
    const fieldName = normalizeMultiText(w.field);
    const title = w.type;
    const fieldLine = fieldName || "（未入力）";

    const workerText = normalizeMultiText(w.workers);
    const workerLine = workerText || "（未入力）";
    const machineLine = String(w.machine || "").trim() || "（未入力）";
    const subItems = Array.isArray(w.items) ? w.items : [];
    const subItemHtml = subItems.length > 1
      ? `
        <details class="merged-work-details">
          <summary>内訳 ${subItems.length}件</summary>
          <ul class="merged-work-list">
            ${subItems.map(subItem => `
              <li>
                <span>${escapeHtml(normalizeMultiText(subItem.field) || "未入力圃場")}</span>
                <span>${escapeHtml(subItem.start || subItem.end || "-")}</span>
              </li>
            `).join("")}
          </ul>
        </details>
      `
      : "";

    html += `
      <div class="card view-card">
        <h3>${title}</h3>
        <p><strong>圃場：</strong> ${fieldLine}</p>
        <p><strong>従事者：</strong> ${workerLine}　　<strong>作業機械：</strong> ${machineLine}</p>
        <p><strong>開始：</strong> ${w.start}　<strong>終了：</strong> ${w.end}</p>
        ${subItemHtml}
      </div>
    `;
  });

  // ---------------------------------------------
  // メモ（閲覧専用）
  // ---------------------------------------------
  html += `
    <div class="card view-card diary-memo">
      <h3>日誌メモ</h3>
      <p style="white-space: pre-line;">${escapeHtml(diary.memo ? diary.memo : "（メモなし）")}</p>
    </div>
  `;

  area.innerHTML = html;
}

function normalizeMultiText(value) {
  if (Array.isArray(value)) {
    return value
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }

  return String(value || "").trim();
}

function normalizeViewGroups(workList) {
  const groups = [];

  (Array.isArray(workList) ? workList : []).forEach((item, index) => {
    if (Array.isArray(item?.items) && item.items.length > 0) {
      groups.push({
        ...item,
        start: item.start || item.items[0]?.start || "",
        end: item.end || item.items[item.items.length - 1]?.end || ""
      });
      return;
    }

    groups.push({
      ...item,
      items: [item],
      start: item?.start || "",
      end: item?.end || "",
      __index: index
    });
  });

  return groups.sort((a, b) => {
    const t1 = a.start || a.end || "99:99";
    const t2 = b.start || b.end || "99:99";
    const diff = t1.localeCompare(t2);
    if (diff !== 0) return diff;
    return String(a.type || "").localeCompare(String(b.type || ""), "ja");
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
