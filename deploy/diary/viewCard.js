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
  return initViewPageWithOptions({});
}

export async function initViewPageWithOptions(options = {}) {
  const date = String(options?.date || document.getElementById("diaryDate")?.value || "").trim();
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "読み込み中…";

  const diary = await loadDiaryByDate(date);
  const logs = Array.isArray(options?.logs) ? options.logs : await loadLogsByDate(date);
  const timestampRows = await loadTimestampRows(date);
  const autoList = extractWorkForEdit(logs, timestampRows);
  const workList = Array.isArray(diary?.work) && diary.work.length
    ? normalizeViewGroups(diary.work)
    : normalizeViewGroups(mergeWorkEntries(autoList, timestampRows));

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
  area.innerHTML = "";
  const frag = document.createDocumentFragment();

  workList.forEach(w => {
    frag.appendChild(createViewWorkCard(w));
  });

  frag.appendChild(createMemoCard(diary.memo));
  area.appendChild(frag);
}

function createViewWorkCard(w) {
  const title = String(w?.type || w?.workType || "").trim();
  const isSowing = isSowingWorkItem(w);
  const fieldLine = isSowing ? "（未入力）" : (normalizeMultiText(w?.field) || "（未入力）");
  const workerLine = normalizeMultiText(w?.workers) || "（未入力）";
  const machineLine = String(w?.machine || "").trim() || "（未入力）";
  const sowingCategoryLine = normalizeSowingCategoryText(w);

  const card = document.createElement("div");
  card.className = "card view-card";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  card.appendChild(h3);

  if (!isSowing) {
    card.appendChild(createLine("圃場", fieldLine));
    card.appendChild(createWorkerMachineLine(workerLine, machineLine));
  } else {
    card.appendChild(createLine("播種区分", sowingCategoryLine));
  }
  card.appendChild(createStartEndLine(String(w?.start || ""), String(w?.end || "")));

  const subItems = Array.isArray(w?.items) ? w.items : [];
  if (subItems.length > 1) {
    card.appendChild(createSubItemsDetails(subItems, isSowing));
  }

  return card;
}

function createMemoCard(memoValue) {
  const card = document.createElement("div");
  card.className = "card view-card diary-memo";

  const h3 = document.createElement("h3");
  h3.textContent = "日誌メモ";
  card.appendChild(h3);

  const p = document.createElement("p");
  p.style.whiteSpace = "pre-line";
  p.textContent = memoValue ? String(memoValue) : "（メモなし）";
  card.appendChild(p);

  return card;
}

function createLine(label, value) {
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}：`;
  p.appendChild(strong);
  p.appendChild(document.createTextNode(` ${value}`));
  return p;
}

function createWorkerMachineLine(workerLine, machineLine) {
  const p = document.createElement("p");
  const sw = document.createElement("strong");
  sw.textContent = "従事者：";
  p.appendChild(sw);
  p.appendChild(document.createTextNode(` ${workerLine}　　`));

  const sm = document.createElement("strong");
  sm.textContent = "作業機械：";
  p.appendChild(sm);
  p.appendChild(document.createTextNode(` ${machineLine}`));
  return p;
}

function createStartEndLine(start, end) {
  const p = document.createElement("p");
  const ss = document.createElement("strong");
  ss.textContent = "開始：";
  p.appendChild(ss);
  p.appendChild(document.createTextNode(` ${start}　`));

  const se = document.createElement("strong");
  se.textContent = "終了：";
  p.appendChild(se);
  p.appendChild(document.createTextNode(` ${end}`));
  return p;
}

function createSubItemsDetails(subItems, hideField = false) {
  const details = document.createElement("details");
  details.className = "merged-work-details";

  const summary = document.createElement("summary");
  summary.textContent = `内訳 ${subItems.length}件`;
  details.appendChild(summary);

  const ul = document.createElement("ul");
  ul.className = "merged-work-list";

  subItems.forEach(subItem => {
    const li = document.createElement("li");

    const field = document.createElement("span");
    field.textContent = hideField ? "未入力圃場" : (normalizeMultiText(subItem?.field) || "未入力圃場");
    li.appendChild(field);

    const time = document.createElement("span");
    time.textContent = String(subItem?.end || subItem?.start || subItem?.timestampTime || "-");
    li.appendChild(time);

    ul.appendChild(li);
  });

  details.appendChild(ul);
  return details;
}

function isSowingWorkItem(w) {
  const title = String(w?.type || w?.workType || "").trim();
  return title.includes("播種");
}

function normalizeSowingCategoryText(w) {
  const direct = normalizeMultiText(w?.sowingCategory);
  if (direct) return direct;

  const nested = Array.isArray(w?.items)
    ? w.items.map(item => normalizeMultiText(item?.sowingCategory || item?.workType || item?.type)).filter(Boolean).join("／")
    : "";
  if (nested) return nested;

  return normalizeMultiText(w?.workType || w?.type) || "（未入力）";
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

