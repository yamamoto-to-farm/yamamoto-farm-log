// =========================================================
// diary/editCard.js
// 作業編集カードの生成（既存日誌を反映）
// =========================================================

import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js";
import { loadDiaryByDate } from "./loadDiary.js";
import { buildTimestampDefaults, createSessionKey, loadTimestampRows } from "/common/timestamp.js?v=1";

// ---------------------------------------------------------
// 編集カードを描画
// ---------------------------------------------------------
export function renderEditCards(autoList, diary, timestampRows = []) {
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "card merge-toolbar";
  toolbar.innerHTML = `
    <div class="merge-toolbar-row">
      <div>
        <h3 class="edit-title">作業カード</h3>
        <p class="memo-desc">時刻が無い過去データは、複数選択して1件にまとめられます。</p>
        <p id="merge-type-guide" class="merge-type-guide">同じ作業種類のカードを選択するとマージできます。</p>
      </div>
      <div class="merge-toolbar-actions">
        <button id="merge-selected-btn" class="secondary-btn" type="button" disabled>選択カードをマージ</button>
        <button id="merge-clear-btn" class="secondary-btn" type="button">選択解除</button>
      </div>
    </div>
  `;
  area.appendChild(toolbar);

  const existingBySourceKey = {};
  (diary?.work || []).forEach(w => {
    if (!w || typeof w !== "object") return;
    const key = String(w.sourceKey || "").trim();
    if (!key) return;
    existingBySourceKey[key] = w;
  });

  const timestampDefaults = buildTimestampDefaults(autoList, timestampRows);

  // -------------------------------
  // 自動抽出された作業カード
  // -------------------------------
  autoList.forEach((item, idx) => {

    // ★ sourceKey 一致を優先、旧データは index でフォールバック
    const existing = existingBySourceKey[item.sourceKey] || diary?.work?.[idx] || {};

    const defaults = timestampDefaults[idx] || { start: "", end: "" };
    const start = String(item.start || existing.start || defaults.start || "").trim();
    const end = String(item.end || existing.end || defaults.end || "").trim();

    // ★ ログ由来の値を優先（同期を維持）
    const field = item.field || existing.field || "";
    const fieldText = normalizeMultiText(field) || "（未入力）";
    const workersText = normalizeMultiText(item.workers || existing.workers) || "（未入力）";
    const machine = String(item.machine ?? existing.machine ?? "").trim();
    const machineText = machine || "（未入力）";
    const subItems = Array.isArray(item.items) ? item.items : [];
    const unmergeButtonHtml = subItems.length > 1
      ? `<button type="button" class="secondary-btn merge-unmerge-btn" data-group-index="${idx}">マージ解除</button>`
      : "";
    const subItemHtml = subItems.length > 1
      ? `
        <details class="merged-work-details">
          <summary>内訳 ${subItems.length}件</summary>
          <ul class="merged-work-list">
            ${subItems.map(subItem => `
              <li>
                <span>${escapeHtml(normalizeMultiText(subItem.field) || "未入力圃場")}</span>
                <span>${escapeHtml(subItem.timestampTime || subItem.start || "-")}</span>
              </li>
            `).join("")}
          </ul>
        </details>
      `
      : "";

    const card = document.createElement("div");
    card.className = "card edit-card";
    card.dataset.groupIndex = String(idx);
    card.dataset.workType = getWorkTypeText(item);
    card.dataset.selected = "false";

    card.innerHTML = `
      <div class="merge-card-head">
        <div class="merge-select-indicator" aria-hidden="true">クリックで選択</div>
        ${unmergeButtonHtml}
      </div>
      <h3 class="edit-title">${getWorkTypeText(item)}</h3>
      <p class="edit-workers"><strong>圃場：</strong> ${fieldText}</p>
      <p class="edit-workers"><strong>従事者：</strong> ${workersText}　　<strong>作業機械：</strong> ${machineText}</p>
      ${subItemHtml}

      <input type="hidden" id="field_${idx}" value="${field}">
      <input type="hidden" id="machine_${idx}" value="${machine}">

      <div class="time-row">
        <label>開始</label>
        <input type="time" id="start_${idx}" class="form-input" value="${start}">

        <label>終了</label>
        <input type="time" id="end_${idx}" class="form-input" value="${end}">
      </div>
    `;

    area.appendChild(card);
  });

  // -------------------------------
  // 日誌メモ（既存メモを反映）
  // -------------------------------
  const memoCard = document.createElement("div");
  memoCard.className = "card edit-card diary-memo";

  const memo = diary?.memo || "";

  memoCard.innerHTML = `
    <h3 class="edit-title">日誌メモ</h3>
    <p class="memo-desc">
      この日の作業ログがない場合や、未実装の作業がある場合はここに記入できます。
    </p>
    <p class="memo-desc" style="margin-top:6px; color:#666;">
      記入例：午前　防鳥ネット張る（直輝／咲子）
      午後　会合（雅彦）
    </p>

    <textarea id="freeMemo" class="form-textarea">${memo}</textarea>
  `;

  area.appendChild(memoCard);
  bindManualMergeControls(diary, timestampRows);
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

function getWorkTypeText(item) {
  return String(item?.type || item?.workType || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------
// 初期化（保存イベントは diary.js に集約）
// ---------------------------------------------------------
export async function initEditPage() {
  const dateInput = document.getElementById("diaryDate");
  const date = dateInput.value;

  // ★ 既存の日誌を読み込む
  const diary = await loadDiaryByDate(date);   // null の可能性あり

  // ★ 作業ログから自動抽出（type, workers, field, machine）
  const logs = await loadLogsByDate(date);
  const timestampRows = await loadTimestampRows(date);
  const autoList = extractWorkForEdit(logs, timestampRows);
  const hydratedList = mergeSavedDiaryGroups(diary, autoList);

  window.__currentDiaryWorkGroups = hydratedList;

  // ★ 既存日誌を反映して描画
  renderEditCards(hydratedList, diary, timestampRows);
}

function mergeSavedDiaryGroups(diary, fallbackGroups) {
  const fallbackList = Array.isArray(fallbackGroups) ? fallbackGroups : [];
  const savedGroups = Array.isArray(diary?.work) ? diary.work.map((item, index) => normalizeSavedGroup(item, index)) : [];
  if (!savedGroups.length) return fallbackList;
  if (!fallbackList.length) return savedGroups;

  const fallbackBySourceKey = new Map();
  fallbackList.forEach(group => {
    const key = String(group?.sourceKey || "").trim();
    if (!key || fallbackBySourceKey.has(key)) return;
    fallbackBySourceKey.set(key, group);
  });

  const mergedFromSaved = [];
  const coveredSourceKeys = new Set();

  savedGroups
    .flatMap((group, groupIndex) => expandGroupForManualOnly(group, groupIndex))
    .forEach(group => {
      const keys = getGroupSourceKeys(group);
      const matchedKey = keys.find(key => fallbackBySourceKey.has(key));
      if (!matchedKey || coveredSourceKeys.has(matchedKey)) return;

      const base = fallbackBySourceKey.get(matchedKey);
      mergedFromSaved.push({
        ...base,
        start: String(group?.start || base?.start || "").trim(),
        end: String(group?.end || base?.end || "").trim(),
        machine: String(group?.machine || base?.machine || "").trim()
      });
      coveredSourceKeys.add(matchedKey);
    });

  const remaining = fallbackList.filter(group => {
    const key = String(group?.sourceKey || "").trim();
    return !key || !coveredSourceKeys.has(key);
  });

  const unmatchedSaved = savedGroups
    .flatMap((group, groupIndex) => expandGroupForManualOnly(group, groupIndex))
    .filter(group => {
      const keys = getGroupSourceKeys(group);
      if (!keys.length) return true;
      return !keys.some(key => coveredSourceKeys.has(key));
    });

  return [...mergedFromSaved, ...unmatchedSaved, ...remaining];
}

function expandGroupForManualOnly(group, groupIndex) {
  const items = Array.isArray(group?.items) ? group.items : [];
  if (items.length <= 1) return [group];

  return items.map((item, itemIndex) => ({
    groupKey: String(item?.sourceKey || `${group.groupKey || `saved-${groupIndex}`}-${itemIndex}`).trim(),
    sessionKey: String(item?.sessionKey || "").trim(),
    sourceKey: String(item?.sourceKey || `${group.groupKey || `saved-${groupIndex}`}-${itemIndex}`).trim(),
    type: String(item?.type || item?.workType || group?.type || group?.workType || "作業").trim(),
    workType: String(item?.workType || item?.type || group?.workType || group?.type || "作業").trim(),
    field: normalizeMultiText(item?.field || ""),
    workers: normalizeMultiText(item?.workers || ""),
    machine: String(item?.machine || group?.machine || "").trim(),
    start: String(item?.start || group?.start || "").trim(),
    end: String(item?.end || group?.end || "").trim(),
    items: [{ ...item }]
  }));
}

function normalizeSavedGroup(item, index) {
  const normalizedItems = Array.isArray(item?.items) && item.items.length
    ? item.items.map((subItem, subIndex) => normalizeSavedSubItem(subItem, subIndex, item))
    : [normalizeSavedSubItem(item, 0, item)];

  return {
    groupKey: String(item?.sessionKey || item?.sourceKey || `saved-${index}`).trim(),
    sessionKey: String(item?.sessionKey || "").trim(),
    sourceKey: String(item?.sourceKey || normalizedItems[0]?.sourceKey || `saved-${index}`).trim(),
    type: String(item?.type || item?.workType || normalizedItems[0]?.type || normalizedItems[0]?.workType || "作業").trim(),
    workType: String(item?.workType || item?.type || normalizedItems[0]?.workType || normalizedItems[0]?.type || "作業").trim(),
    field: normalizeMultiText(item?.field || normalizedItems.map(v => v.field).join("／")),
    workers: normalizeMultiText(item?.workers || normalizedItems.map(v => v.workers).join("／")),
    machine: String(item?.machine || normalizedItems.map(v => v.machine).filter(Boolean).join("／") || "").trim(),
    start: String(item?.start || "").trim(),
    end: String(item?.end || "").trim(),
    items: normalizedItems
  };
}

function normalizeSavedSubItem(item, index, parent) {
  return {
    sourceKey: String(item?.sourceKey || parent?.sourceKey || `sub-${index}`).trim(),
    sessionKey: String(item?.sessionKey || parent?.sessionKey || "").trim(),
    type: String(item?.type || item?.workType || parent?.type || parent?.workType || "作業").trim(),
    workType: String(item?.workType || item?.type || parent?.workType || parent?.type || "作業").trim(),
    field: normalizeMultiText(item?.field || ""),
    workers: normalizeMultiText(item?.workers || ""),
    machine: String(item?.machine || parent?.machine || "").trim(),
    start: String(item?.start || parent?.start || "").trim(),
    end: String(item?.end || parent?.end || "").trim(),
    timestampTime: String(item?.end || item?.start || parent?.end || parent?.start || "").trim()
  };
}

function getGroupSourceKeys(group) {
  const keys = new Set();
  if (group?.sourceKey) keys.add(String(group.sourceKey).trim());
  (Array.isArray(group?.items) ? group.items : []).forEach(item => {
    if (item?.sourceKey) keys.add(String(item.sourceKey).trim());
  });
  return [...keys].filter(Boolean);
}

function bindManualMergeControls(diary, timestampRows) {
  const mergeBtn = document.getElementById("merge-selected-btn");
  const clearBtn = document.getElementById("merge-clear-btn");
  const guideEl = document.getElementById("merge-type-guide");
  const cards = [...document.querySelectorAll(".edit-card[data-group-index]")];
  const unmergeButtons = [...document.querySelectorAll(".merge-unmerge-btn")];
  if (!mergeBtn || !clearBtn || !cards.length) return;

  const isInteractiveTarget = target => {
    return Boolean(target.closest("input, button, textarea, select, option, summary, details, label, a"));
  };

  const getSelectedCards = () => cards.filter(card => card.dataset.selected === "true");

  const updateButtonState = () => {
    const selectedCards = getSelectedCards();
    const count = selectedCards.length;
    const selectedType = count > 0
      ? String(selectedCards[0]?.dataset.workType || "").trim()
      : "";

    cards.forEach(card => {
      const workType = String(card?.dataset.workType || "").trim();
      const isSelected = card.dataset.selected === "true";
      const shouldDisable = Boolean(selectedType) && !isSelected && workType !== selectedType;
      card.classList.toggle("merge-card-disabled", shouldDisable);
      card.classList.toggle("merge-card-selected", isSelected);
      card.dataset.mergeDisabled = shouldDisable ? "true" : "false";
    });

    if (guideEl) {
      guideEl.textContent = selectedType
        ? `選択中: ${selectedType} のカードのみ追加選択できます。`
        : "同じ作業種類のカードを選択するとマージできます。";
    }

    mergeBtn.disabled = count < 2;
  };

  cards.forEach(card => {
    card.addEventListener("click", event => {
      if (isInteractiveTarget(event.target)) return;
      if (card.dataset.mergeDisabled === "true") return;
      card.dataset.selected = card.dataset.selected === "true" ? "false" : "true";
      updateButtonState();
    });
  });

  clearBtn.addEventListener("click", () => {
    cards.forEach(card => {
      card.dataset.selected = "false";
    });
    updateButtonState();
  });

  mergeBtn.addEventListener("click", () => {
    const selectedIndexes = cards
      .filter(card => card.dataset.selected === "true")
      .map(card => Number(card.dataset.groupIndex))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (selectedIndexes.length < 2) return;

    syncGroupsFromCurrentInputs();

    const currentGroups = Array.isArray(window.__currentDiaryWorkGroups) ? [...window.__currentDiaryWorkGroups] : [];
    const selectedGroups = selectedIndexes.map(index => currentGroups[index]).filter(Boolean);
    const typeSet = [...new Set(selectedGroups.map(group => String(group?.type || "").trim()).filter(Boolean))];

    if (typeSet.length > 1) {
      alert("異なる作業種類は一度にマージできません。同じ作業種類で選択してください。");
      return;
    }

    const mergedGroup = buildManualMergedGroup(selectedGroups);
    const nextGroups = currentGroups.filter((_, index) => !selectedIndexes.includes(index));
    nextGroups.splice(selectedIndexes[0], 0, mergedGroup);

    window.__currentDiaryWorkGroups = nextGroups;
    const memo = document.getElementById("freeMemo")?.value || diary?.memo || "";
    renderEditCards(nextGroups, { ...(diary || {}), memo }, timestampRows);
  });

  unmergeButtons.forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
    });
    button.addEventListener("click", () => {
      const index = Number(button.dataset.groupIndex);
      if (!Number.isFinite(index)) return;

      syncGroupsFromCurrentInputs();

      const currentGroups = Array.isArray(window.__currentDiaryWorkGroups) ? [...window.__currentDiaryWorkGroups] : [];
      const group = currentGroups[index];
      if (!group) return;

      const expandedGroups = expandMergedGroup(group);
      if (expandedGroups.length <= 1) return;

      const nextGroups = currentGroups.filter((_, groupIndex) => groupIndex !== index);
      nextGroups.splice(index, 0, ...expandedGroups);

      window.__currentDiaryWorkGroups = nextGroups;
      const memo = document.getElementById("freeMemo")?.value || diary?.memo || "";
      renderEditCards(nextGroups, { ...(diary || {}), memo }, timestampRows);
    });
  });

  updateButtonState();
}

function syncGroupsFromCurrentInputs() {
  const groups = Array.isArray(window.__currentDiaryWorkGroups) ? window.__currentDiaryWorkGroups : [];
  groups.forEach((group, index) => {
    const startInput = document.getElementById(`start_${index}`);
    const endInput = document.getElementById(`end_${index}`);
    const fieldInput = document.getElementById(`field_${index}`);
    const machineInput = document.getElementById(`machine_${index}`);

    group.start = startInput?.value || group.start || "";
    group.end = endInput?.value || group.end || "";
    group.field = fieldInput?.value || group.field || "";
    group.machine = machineInput?.value || group.machine || "";

    const items = Array.isArray(group?.items) ? group.items : [];
    if (items.length === 1) {
      items[0].start = group.start;
      items[0].end = group.end;
      items[0].field = group.field || items[0].field || "";
      items[0].machine = group.machine || items[0].machine || "";
    }
  });
}

function buildManualMergedGroup(groups) {
  const sessionKey = createSessionKey();
  const items = groups.flatMap(group => {
    const groupStart = String(group?.start || "").trim();
    const groupEnd = String(group?.end || "").trim();
    const sourceItems = Array.isArray(group?.items) && group.items.length ? group.items : [group];

    return sourceItems.map(item => ({
      ...item,
      start: String(item?.start || groupStart || "").trim(),
      end: String(item?.end || groupEnd || "").trim()
    }));
  });
  const fieldSet = new Set();
  const workerSet = new Set();
  const machineSet = new Set();

  items.forEach(item => {
    normalizeMultiText(item?.field || "").split("／").map(v => v.trim()).filter(Boolean).forEach(v => fieldSet.add(v));
    normalizeMultiText(item?.workers || "").split("／").map(v => v.trim()).filter(Boolean).forEach(v => workerSet.add(v));
    const machine = String(item?.machine || "").trim();
    if (machine) machineSet.add(machine);
  });

  const sortedGroups = groups.slice().sort((a, b) => {
    const ta = String(a?.start || a?.end || "99:99");
    const tb = String(b?.start || b?.end || "99:99");
    return ta.localeCompare(tb);
  });

  const normalizeTime = value => {
    const text = String(value || "").trim();
    return /^\d{2}:\d{2}$/.test(text) ? text : "";
  };

  const nonEmptyStarts = items
    .map(item => normalizeTime(item?.start))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const nonEmptyEnds = items
    .map(item => normalizeTime(item?.end || item?.start || item?.timestampTime))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const mergedStart = nonEmptyStarts[0] || normalizeTime(sortedGroups[0]?.start || "");
  const mergedEnd = nonEmptyEnds.length
    ? nonEmptyEnds[nonEmptyEnds.length - 1]
    : normalizeTime(sortedGroups[sortedGroups.length - 1]?.end || "");

  return {
    groupKey: sessionKey,
    sessionKey,
    sourceKey: String(sortedGroups[0]?.sourceKey || sessionKey).trim(),
    type: String(sortedGroups[0]?.type || "作業").trim(),
    field: [...fieldSet].join("／"),
    workers: [...workerSet].join("／"),
    machine: [...machineSet].join("／"),
    start: mergedStart,
    end: mergedEnd,
    items: items.map(item => ({
      ...item,
      sessionKey: String(item?.sessionKey || sessionKey).trim()
    }))
  };
}

function expandMergedGroup(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  if (items.length <= 1) return [group];

  return items.map((item, index) => ({
    groupKey: String(item?.sourceKey || `${group?.groupKey || "group"}-${index}`).trim(),
    sessionKey: String(item?.sessionKey || "").trim(),
    sourceKey: String(item?.sourceKey || `${group?.sourceKey || "group"}-${index}`).trim(),
    type: String(item?.type || group?.type || "作業").trim(),
    field: normalizeMultiText(item?.field || group?.field || ""),
    workers: normalizeMultiText(item?.workers || group?.workers || ""),
    machine: String(item?.machine || group?.machine || "").trim(),
    start: String(item?.start || "").trim(),
    end: String(item?.end || "").trim(),
    items: [{
      ...item,
      start: String(item?.start || "").trim(),
      end: String(item?.end || "").trim()
    }]
  }));
}

