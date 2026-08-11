// =========================================================
// diary/viewCard.js — 閲覧専用カード（マージ表示対応）
// =========================================================

import { loadDiaryByDate } from "./loadDiary.js";
import { loadLogsByDate, extractWorkForEdit, mergeWorkEntries } from "./work-summary.js";
import { loadTimestampRows } from "/common/timestamp.js?v=1";
import { getWorkToneClass } from "/common/work-tone.js";

const WORK_LOG_TYPE_BY_CARD = [
  { pattern: /手作業除草/, type: "hand-weeding" },
  { pattern: /除草|草刈/, type: "weeding" },
  { pattern: /土づくり|耕起|耕うん|ロータリー|プラソイラ|スタブルカルチ/, type: "tillage" },
  { pattern: /圃場整備/, type: "field-maintenance" },
  { pattern: /防除/, type: "pesticide" },
  { pattern: /施肥/, type: "fertilizer" },
  { pattern: /潅水|灌水/, type: "watering" }
];

const WORK_LIST_LINK_RULES = [
  { pattern: /収穫/, href: "/performance/harvest-kpi.html", kind: "kpi" },
  { pattern: /播種|定植/, href: "/list/list.html", kind: "list" },
  { pattern: /施肥/, href: "/fertilizer/list/list.html", kind: "list" },
  { pattern: /防除/, href: "/pesticide/list/list.html", kind: "list" },
  { pattern: /土づくり|耕起|耕うん|ロータリー|プラソイラ|スタブルカルチ/, href: "/field/tillage/list.html", kind: "list" },
  { pattern: /手作業除草|除草（手作業）/, href: "/", kind: "fallback" },
  { pattern: /除草|草刈/, href: "/field/weeding/list.html", kind: "list" }
];

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

  const diary = options?.diary !== undefined ? options.diary : await loadDiaryByDate(date);
  const logs = Array.isArray(options?.logs) ? options.logs : await loadLogsByDate(date);
  const timestampRows = Array.isArray(options?.timestampRows) ? options.timestampRows : await loadTimestampRows(date);
  const autoList = extractWorkForEdit(logs, timestampRows);
  const autoSowingCategoryMap = buildSowingCategoryMap(autoList);
  const workList = Array.isArray(diary?.work) && diary.work.length
    ? normalizeViewGroups(hydrateSowingCategoryForView(diary.work, autoSowingCategoryMap))
    : normalizeViewGroups(mergeWorkEntries(autoList, timestampRows));

  if (!diary && !workList.length) {
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

  if (!diary && workList.length) {
    const infoCard = document.createElement("div");
    infoCard.className = "card view-card diary-memo";
    infoCard.innerHTML = `
      <h3 class="view-card-title">作業内容</h3>
      <p>この日の保存済み日誌はありません。作業ログから自動表示しています。</p>
    `;
    frag.appendChild(infoCard);
  }

  workList.forEach(w => {
    frag.appendChild(createViewWorkCard(w));
  });

  if (diary) {
    frag.appendChild(createMemoCard(diary.memo));
  }
  area.appendChild(frag);
}

function createViewWorkCard(w) {
  const title = String(w?.type || w?.workType || "").trim();
  const isSowing = isSowingWorkItem(w);
  const workerLine = normalizeMultiText(w?.workers) || "（未入力）";
  const machineLine = String(w?.machine || "").trim() || "（未入力）";
  const sowingCategoryLine = normalizeSowingCategoryText(w);
  const subItems = Array.isArray(w?.items) ? w.items : [];
  const fieldParts = isSowing ? [] : getFieldParts(w?.field, subItems);
  const date = String(document.getElementById("diaryDate")?.value || "").trim();
  const workLogType = resolveWorkLogType(title);

  const card = document.createElement("div");
  card.className = `card view-card ${getWorkToneClass(title)}`;

  const h3 = document.createElement("h3");
  h3.className = `view-card-title ${getWorkToneClass(title)}`;
  const titleLinkInfo = resolveWorkTitleLink(title);
  if (titleLinkInfo?.href) {
    const titleLink = document.createElement("a");
    titleLink.className = "work-title-link";
    if (titleLinkInfo.kind === "fallback") {
      titleLink.classList.add("is-fallback");
      titleLink.title = "専用一覧未対応のためトップページへ移動";
    }
    titleLink.href = titleLinkInfo.href;
    titleLink.textContent = title;
    h3.appendChild(titleLink);
  } else {
    h3.textContent = title;
  }
  card.appendChild(h3);

  if (!isSowing) {
    card.appendChild(createFieldBlock("圃場", fieldParts, {
      extraClass: "view-field-line",
      linkBuilder: field => buildFieldWorkLogsUrl({ field, end: date, type: workLogType })
    }));
    card.appendChild(createWorkerMachineLine(workerLine, machineLine, "view-crew-line"));
  } else {
    card.appendChild(createLine("播種区分", sowingCategoryLine, "view-field-line"));
  }
  card.appendChild(createStartEndLine(String(w?.start || ""), String(w?.end || ""), "view-time-line"));

  if (subItems.length > 1) {
    card.appendChild(createSubItemsDetails(subItems, isSowing));
  }

  return card;
}

function createMemoCard(memoValue) {
  const card = document.createElement("div");
  card.className = "card view-card diary-memo";

  const h3 = document.createElement("h3");
  h3.className = "view-card-title";
  h3.textContent = "日誌メモ";
  card.appendChild(h3);

  const p = document.createElement("p");
  p.style.whiteSpace = "pre-line";
  p.textContent = memoValue ? String(memoValue) : "（メモなし）";
  card.appendChild(p);

  return card;
}

function buildSowingCategoryMap(autoList) {
  const map = new Map();
  (Array.isArray(autoList) ? autoList : []).forEach(item => {
    const key = String(item?.sourceKey || "").trim();
    if (!key || map.has(key)) return;
    const category = normalizeMultiText(item?.sowingCategory || item?.workType || item?.type);
    if (!category) return;
    map.set(key, category);
  });
  return map;
}

function hydrateSowingCategoryForView(workList, categoryMap) {
  return (Array.isArray(workList) ? workList : []).map(work => {
    const next = { ...(work || {}) };
    const selfKey = String(next.sourceKey || "").trim();
    if (!next.sowingCategory && selfKey && categoryMap.has(selfKey)) {
      next.sowingCategory = categoryMap.get(selfKey);
    }

    if (Array.isArray(next.items) && next.items.length) {
      next.items = next.items.map(item => {
        const child = { ...(item || {}) };
        const childKey = String(child.sourceKey || "").trim();
        if (!child.sowingCategory && childKey && categoryMap.has(childKey)) {
          child.sowingCategory = categoryMap.get(childKey);
        }
        return child;
      });
    }

    return next;
  });
}

function createLine(label, value, extraClass = "") {
  const p = document.createElement("p");
  if (extraClass) p.className = extraClass;
  const strong = document.createElement("strong");
  strong.textContent = `${label}：`;
  p.appendChild(strong);
  p.appendChild(document.createTextNode(` ${value}`));
  return p;
}

function createFieldBlock(label, values, options = "") {
  const p = document.createElement("p");
  const extraClass = typeof options === "string" ? options : String(options?.extraClass || "").trim();
  const linkBuilder = typeof options === "object" ? options?.linkBuilder : null;
  if (extraClass) p.className = `${extraClass} field-multi-block`;

  const strong = document.createElement("strong");
  strong.textContent = `${label}：`;
  p.appendChild(strong);

  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) {
    p.appendChild(document.createTextNode(" （未入力）"));
    return p;
  }

  if (list.length === 1) {
    p.appendChild(document.createTextNode(" "));
    p.appendChild(createFieldValueNode(list[0], linkBuilder));
    return p;
  }

  const wrapper = document.createElement("span");
  wrapper.className = "field-multi-list";
  list.forEach((value, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "field-multi-sep";
      sep.textContent = "／";
      wrapper.appendChild(sep);
    }
    wrapper.appendChild(createFieldValueNode(value, linkBuilder));
  });
  p.appendChild(wrapper);
  return p;
}

function createFieldValueNode(value, linkBuilder) {
  const text = String(value || "").trim();
  if (!text) {
    const span = document.createElement("span");
    span.className = "field-multi-item";
    span.textContent = "（未入力）";
    return span;
  }

  const href = typeof linkBuilder === "function" ? linkBuilder(text) : "";
  if (!href) {
    const span = document.createElement("span");
    span.className = "field-multi-item";
    span.textContent = text;
    return span;
  }

  const link = document.createElement("a");
  link.className = "field-multi-item field-log-link";
  link.href = href;
  link.textContent = text;
  return link;
}

function createWorkerMachineLine(workerLine, machineLine, extraClass = "") {
  const p = document.createElement("p");
  if (extraClass) p.className = extraClass;
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

function createStartEndLine(start, end, extraClass = "") {
  const p = document.createElement("p");
  if (extraClass) p.className = extraClass;
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
    field.className = "merged-work-field";
    field.textContent = hideField ? "未入力圃場" : (normalizeMultiText(subItem?.field) || "未入力圃場");
    li.appendChild(field);

    const time = document.createElement("span");
    time.className = "merged-work-time";
    time.textContent = `／ ${String(subItem?.end || subItem?.start || subItem?.timestampTime || "-")}`;
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

function resolveWorkLogType(title) {
  const text = String(title || "").trim();
  const matched = WORK_LOG_TYPE_BY_CARD.find(entry => entry.pattern.test(text));
  return matched?.type || "all";
}

function resolveWorkTitleLink(title) {
  const text = String(title || "").trim();
  if (!text) return { href: "/", kind: "fallback" };

  const matched = WORK_LIST_LINK_RULES.find(rule => rule.pattern.test(text));
  if (matched?.href) {
    return { href: matched.href, kind: matched.kind || "list" };
  }

  return { href: "/", kind: "fallback" };
}

function normalizeFieldLinkParam(field) {
  return String(field || "")
    .replace(/[()（）]/g, "")
    .trim();
}

function buildFieldWorkLogsUrl({ field, end, type }) {
  const normalizedField = normalizeFieldLinkParam(field);
  if (!normalizedField) return "";

  const params = new URLSearchParams({
    field: normalizedField,
    start: "",
    end: String(end || "").trim(),
    type: String(type || "all").trim() || "all"
  });

  return `/fields/work-logs.html?${params.toString()}`;
}

function getFieldParts(fieldValue, subItems = []) {
  const subFields = (Array.isArray(subItems) ? subItems : [])
    .map(item => normalizeMultiText(item?.field))
    .filter(Boolean);
  if (subFields.length > 1) return [...new Set(subFields)];

  if (Array.isArray(fieldValue)) {
    return fieldValue.map(v => String(v || "").trim()).filter(Boolean);
  }

  const text = String(fieldValue || "").trim();
  if (!text) return [];
  if (!/[／/]/.test(text)) return [text];

  return text
    .split(/[／/]/)
    .map(v => v.trim())
    .filter(Boolean);
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

