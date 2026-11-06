// =========================================================
// diary/editCard.js
// 作業編集カードの生成（既存日誌を反映）
// =========================================================

import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js?v=20261103-status-2";
import { loadDiaryByDate } from "./loadDiary.js?v=20261103-status-2";
import { createSessionKey, loadTimestampRows } from "/common/timestamp.js?v=1";
import { getWorkToneClass } from "/common/work-tone.js";
import {
  renderDiaryParticipation, readDiaryParticipation, validateDiaryTimes, mergeDiaryParticipation,
  diaryPlanCandidates, loadDiaryPlanCandidates, loadDiaryShiftTimes, showDiaryTimeCandidates,
} from "./participation.js?v=20261106-collapse-1";

let timeSources = { plans: null, shifts: null, logs: [], autoList: [] };

// ---------------------------------------------------------
// 編集カードを描画
// ---------------------------------------------------------
export function renderEditCards(autoList, diary, timestampRows = []) {
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "card merge-toolbar print-hide";
  toolbar.innerHTML = `
    <h3 class="edit-title">作業カード</h3>
    <div class="merge-toolbar-row">
      <section class="merge-toolbar-group" aria-labelledby="diary-merge-title">
        <h4 id="diary-merge-title">カードをまとめる</h4>
        <p class="memo-desc" data-help="作業カードのまとめ方">時刻が無い過去データは、複数選択して1件にまとめられます。</p>
        <div class="merge-toolbar-actions">
          <button id="merge-selected-btn" class="secondary-btn" type="button" disabled>選択カードをマージ</button>
          <button id="merge-clear-btn" class="secondary-btn" type="button">選択解除</button>
        </div>
        <p id="merge-type-guide" class="merge-type-guide">同じ作業種類のカードを選択するとマージできます。</p>
      </section>
      <section class="merge-toolbar-group" aria-labelledby="diary-time-title">
        <h4 id="diary-time-title">時間の候補を読み込む</h4>
        <p class="memo-desc" data-help="作業時間の候補について">ログの登録時刻は作業時間に使いません。日別予定・シフトは候補を確認して取り込んでください。</p>
        <div class="merge-toolbar-actions">
          <button id="diary-load-plans" class="secondary-btn" type="button">日別予定の時間候補を読む</button>
          <button id="diary-load-shift" class="secondary-btn" type="button">シフトの目安を読む</button>
        </div>
        <p id="diary-time-source-status" role="status"></p>
      </section>
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

  // -------------------------------
  // 自動抽出された作業カード
  // -------------------------------
  autoList.forEach((item, idx) => {

    // ★ sourceKey 一致を優先、旧データは index でフォールバック
    const legacy = diary?.work?.[idx];
    const existing = existingBySourceKey[item.sourceKey] || (!legacy?.sourceKey ? legacy : null) || {};

    const start = String(item.start ?? existing.start ?? "").trim();
    const end = String(item.end ?? existing.end ?? "").trim();

    // ★ ログ由来の値を優先（同期を維持）
    const isSeedWork = isSowingWorkItem(item) || String(item?.folder || existing?.folder || "").trim() === "seed";
    const field = isSeedWork ? "" : (item.field || existing.field || "");
    const fieldText = normalizeMultiText(field) || "（未入力）";
    const workersText = normalizeMultiText(item.workers || existing.workers) || "（未入力）";
    const machine = String(item.machine ?? existing.machine ?? "").trim();
    const machineText = machine || "（未入力）";
    const hideField = isSeedWork;
    const sowingCategoryText = normalizeMultiText(
      item.sowingCategory
      || existing.sowingCategory
      || (Array.isArray(item.items) ? item.items.map(subItem => subItem?.sowingCategory || subItem?.workType || subItem?.type).join("／") : "")
      || item.workType
      || existing.workType
      || item.type
      || existing.type
    ) || "（未入力）";
    const subItems = Array.isArray(item.items) ? item.items : [];
    const fieldParts = hideField ? [] : getFieldParts(field, subItems);
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
                <span class="merged-work-field">${escapeHtml(normalizeMultiText(subItem.field) || "未入力圃場")}</span>
                <span class="merged-work-time">／ ${escapeHtml(subItem.end || subItem.start || "時間未記録")}</span>
              </li>
            `).join("")}
          </ul>
        </details>
      `
      : "";

    const card = document.createElement("div");
    card.className = `card edit-card ${getWorkToneClass(getWorkTypeText(item))}`;
    card.dataset.groupIndex = String(idx);
    card.dataset.workType = getWorkTypeText(item);
    card.dataset.mergeKey = buildMergeComparableKey({
      type: getWorkTypeText(item),
      workers: item.workers || existing.workers,
      machine
    });
    card.dataset.selected = "false";

    card.innerHTML = `
      ${unmergeButtonHtml ? `<div class="merge-card-head">${unmergeButtonHtml}</div>` : ""}
      <h3 class="edit-title edit-card-title ${getWorkToneClass(getWorkTypeText(item))}">${getWorkTypeText(item)}</h3>
      ${hideField ? "" : renderFieldBlock("圃場", fieldParts)}
      ${hideField
        ? `<p class="edit-line edit-field-line"><strong>播種区分：</strong> ${escapeHtml(sowingCategoryText)}</p>`
        : `<p class="edit-line edit-crew-line"><strong>従事者：</strong> ${workersText}　　<strong>作業機械：</strong> ${machineText}</p>`}
      ${subItemHtml}

      <input type="hidden" id="field_${idx}" value="${escapeHtml(field)}">
      <input type="hidden" id="machine_${idx}" value="${machine}">

      <div class="time-row edit-time-row">
        <label>作業全体の開始
        <input type="time" id="start_${idx}" class="form-input" value="${start}"></label>

        <label>終了
        <input type="time" id="end_${idx}" class="form-input" value="${end}"></label>
      </div>
    `;

    renderDiaryParticipation(card, { ...item, start, end });
    area.appendChild(card);
  });

  // -------------------------------
  // 日誌メモ（既存メモを反映）
  // -------------------------------
  const memoCard = document.createElement("div");
  memoCard.className = "card edit-card diary-memo";

  const memo = diary?.memo || "";

  memoCard.innerHTML = `
    <h3 class="edit-title edit-card-title">日誌メモ</h3>
    <p class="memo-desc" data-help="日誌メモの使い方">
      この日の作業ログがない場合や、未実装の作業がある場合はここに記入できます。
    </p>
    <p class="memo-desc diary-memo-example">
      記入例：午前　防鳥ネット張る（直輝／咲子）<br>
      　　　　午後　会合（雅彦）
    </p>

    <textarea id="freeMemo" class="form-textarea">${memo}</textarea>
  `;

  area.appendChild(memoCard);
  bindManualMergeControls(diary, timestampRows);
  bindTimeSources(autoList);
}

function drawTimeCandidates(groups) {
  [...document.querySelectorAll(".edit-card[data-group-index]")].forEach((card, index) => {
    const group = groups[index];
    const keys = new Set(getGroupSourceKeys(group));
    const logs = timeSources.autoList.filter(item => keys.has(item.sourceKey))
      .map(item => timeSources.logs[item.logIndex]).filter(Boolean);
    showDiaryTimeCandidates(card, group,
      timeSources.plans === null ? [] : diaryPlanCandidates(group, logs, timeSources.plans), timeSources.shifts);
  });
}

function bindTimeSources(groups) {
  if (timeSources.plans !== null || timeSources.shifts !== null) drawTimeCandidates(groups);
  const date = document.getElementById("diaryDate").value;
  for (const [id, kind, loader] of [
    ["diary-load-plans", "plans", loadDiaryPlanCandidates],
    ["diary-load-shift", "shifts", () => loadDiaryShiftTimes(date)],
  ]) {
    const button = document.getElementById(id);
    button.onclick = async () => {
      button.disabled = true;
      const notice = document.getElementById("diary-time-source-status");
      notice.textContent = "時間候補を読み込み中…";
      try {
        const result = await loader();
        if (!button.isConnected || document.getElementById("diaryDate").value !== date) return;
        timeSources[kind] = result;
        drawTimeCandidates(groups);
        notice.textContent = "候補を読み込みました。入力・保存済みの時間は変更していません。";
      } catch (error) {
        console.error("[diary] time candidates failed", error);
        if (button.isConnected) notice.textContent = `${error.message} 手入力できます。このボタンで再試行してください。`;
      } finally { button.disabled = false; }
    };
  }
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

function normalizeMergeScalar(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMergeList(value) {
  const text = normalizeMultiText(value);
  if (!text) return [];

  return text
    .split(/[\/／,，、]/)
    .map(v => normalizeMergeScalar(v))
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function buildMergeComparableKey({ type, workers, machine }) {
  const typeKey = normalizeMergeScalar(type);
  const workersKey = normalizeMergeList(workers).join("|");
  const machineKey = normalizeMergeList(machine).join("|");
  return `${typeKey}__${workersKey}__${machineKey}`;
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

function renderFieldBlock(label, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  const items = list.length
    ? list.length === 1
      ? `<span class="field-multi-single">${escapeHtml(list[0])}</span>`
      : `<span class="field-multi-list">${list.map((value, index) => `${index > 0 ? '<span class="field-multi-sep">／</span>' : ''}<span class="field-multi-item">${escapeHtml(value)}</span>`).join("")}</span>`
    : `<span class="field-multi-single">（未入力）</span>`;

  return `
    <p class="edit-line edit-field-line field-multi-block">
      <strong>${label}：</strong>
      ${items}
    </p>
  `;
}

function isSowingWorkItem(item) {
  return getWorkTypeText(item).includes("播種");
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
export async function initEditPage(options = {}) {
  const dateInput = document.getElementById("diaryDate");
  const date = String(options?.date || dateInput.value || "").trim();

  // ★ 既存の日誌を読み込む
  const diary = options?.diary !== undefined ? options.diary : await loadDiaryByDate(date);   // null の可能性あり

  // ★ 作業ログから自動抽出（type, workers, field, machine）
  const logs = Array.isArray(options?.logs) ? options.logs : await loadLogsByDate(date);
  const timestampRows = Array.isArray(options?.timestampRows) ? options.timestampRows : await loadTimestampRows(date);
  const autoList = extractWorkForEdit(logs, timestampRows);
  const hydratedList = mergeSavedDiaryGroups(diary, autoList);

  if (options.isCurrent && !options.isCurrent()) return;
  timeSources = { plans: null, shifts: null, logs, autoList };
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

  const coveredSourceKeys = new Set();

  const hydrateSavedItemWithFallback = (item, parentGroup) => {
    const key = String(item?.sourceKey || "").trim();
    const base = key ? fallbackBySourceKey.get(key) : null;
    if (key && base) coveredSourceKeys.add(key);

    return {
      ...item,
      sourceKey: String(item?.sourceKey || base?.sourceKey || "").trim(),
      sessionKey: String(item?.sessionKey || parentGroup?.sessionKey || base?.sessionKey || "").trim(),
      type: String(item?.type || item?.workType || base?.type || base?.workType || parentGroup?.type || "作業").trim(),
      workType: String(item?.workType || item?.type || base?.workType || base?.type || parentGroup?.workType || parentGroup?.type || "作業").trim(),
      field: normalizeMultiText(item?.field || base?.field || ""),
      workers: normalizeMultiText(item?.workers || base?.workers || ""),
      machine: String(item?.machine || base?.machine || parentGroup?.machine || "").trim(),
      start: String(item?.start || base?.start || parentGroup?.start || "").trim(),
      end: String(item?.end || base?.end || parentGroup?.end || "").trim(),
      timestampTime: String(item?.end || item?.start || base?.end || base?.start || parentGroup?.end || parentGroup?.start || "").trim()
    };
  };

  const mergedFromSaved = savedGroups.map(group => {
    const sourceItems = Array.isArray(group?.items) && group.items.length ? group.items : [group];
    const hydratedItems = sourceItems.map(item => hydrateSavedItemWithFallback(item, group));

    const firstStart = hydratedItems.map(item => String(item?.start || "").trim()).find(Boolean) || "";
    const firstEnd = hydratedItems.map(item => String(item?.end || "").trim()).reverse().find(Boolean) || "";

    return {
      ...group,
      sourceKey: String(group?.sourceKey || hydratedItems[0]?.sourceKey || "").trim(),
      type: String(group?.type || group?.workType || hydratedItems[0]?.type || "作業").trim(),
      workType: String(group?.workType || group?.type || hydratedItems[0]?.workType || hydratedItems[0]?.type || "作業").trim(),
      field: normalizeMultiText(group?.field || hydratedItems.map(item => item.field).filter(Boolean).join("／")),
      workers: normalizeMultiText(group?.workers || hydratedItems.map(item => item.workers).filter(Boolean).join("／")),
      machine: String(group?.machine || hydratedItems.map(item => item.machine).filter(Boolean).join("／") || "").trim(),
      start: String(group?.start ?? firstStart ?? "").trim(),
      end: String(group?.end ?? firstEnd ?? "").trim(),
      items: hydratedItems
    };
  });

  const remaining = fallbackList.filter(group => {
    const key = String(group?.sourceKey || "").trim();
    return !key || !coveredSourceKeys.has(key);
  });

  return [...mergedFromSaved, ...remaining];
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
    ...(Object.hasOwn(item || {}, "participation") ? { participation: structuredClone(item.participation) } : {}),
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
    ...(Object.hasOwn(item || {}, "participation") ? { participation: structuredClone(item.participation) } : {}),
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
    return Boolean(target.closest("input, button, textarea, select, option, a, summary"));
  };

  const getSelectedCards = () => cards.filter(card => card.dataset.selected === "true");

  const applySelectedVisual = (card, isSelected) => {
    if (!card) return;
    if (isSelected) {
      card.style.background = "linear-gradient(180deg, #ecfeff 0%, #ccfbf1 100%)";
      card.style.borderColor = "#14b8a6";
      card.style.borderLeftColor = "#0f766e";
      card.style.boxShadow = "0 0 0 2px rgba(20, 184, 166, 0.24)";
      return;
    }

    card.style.background = "";
    card.style.borderColor = "";
    card.style.borderLeftColor = "";
    card.style.boxShadow = "";
  };

  const updateButtonState = () => {
    const selectedCards = getSelectedCards();
    const count = selectedCards.length;
    const selectedMergeKey = count > 0 ? String(selectedCards[0]?.dataset.mergeKey || "") : "";

    cards.forEach(card => {
      const isSelected = card.dataset.selected === "true";
      const cardMergeKey = String(card?.dataset.mergeKey || "");
      const shouldDisable = Boolean(selectedMergeKey) && !isSelected && cardMergeKey !== selectedMergeKey;
      card.classList.toggle("merge-card-disabled", shouldDisable);
      card.classList.toggle("merge-card-selected", isSelected);
      card.classList.toggle("is-selected", isSelected);
      card.dataset.mergeDisabled = shouldDisable ? "true" : "false";
      applySelectedVisual(card, isSelected);
    });

    if (guideEl) {
      guideEl.textContent = count > 0
        ? `選択中: ${count}件（圃場以外が一致するカードのみ追加選択できます）`
        : "圃場以外（作業種類・従事者・作業機械）が一致するカードを選択してください。";
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

    try { syncGroupsFromCurrentInputs(); } catch (error) {
      console.error("[diary] merge time validation failed", error); alert(error.message); return;
    }

    const currentGroups = Array.isArray(window.__currentDiaryWorkGroups) ? [...window.__currentDiaryWorkGroups] : [];
    const selectedGroups = selectedIndexes.map(index => currentGroups[index]).filter(Boolean);
    const mergeKeySet = [...new Set(selectedGroups.map(group => buildMergeComparableKey({
      type: group?.type || group?.workType || "",
      workers: group?.workers || "",
      machine: group?.machine || ""
    })).filter(Boolean))];

    if (mergeKeySet.length > 1) {
      alert("圃場以外（作業種類・従事者・作業機械）が一致するカードのみマージできます。");
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

      try { syncGroupsFromCurrentInputs(); } catch (error) {
        console.error("[diary] unmerge time validation failed", error); alert(error.message); return;
      }

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

    group.start = startInput ? startInput.value : group.start || "";
    group.end = endInput ? endInput.value : group.end || "";
    const card = document.querySelector(`.edit-card[data-group-index="${index}"]`);
    if (card) group.participation = readDiaryParticipation(card);
    validateDiaryTimes(group);
    group.field = fieldInput?.value || group.field || "";
    group.machine = machineInput?.value || group.machine || "";

    const items = Array.isArray(group?.items) ? group.items : [];
    if (items.length === 1) {
      items[0].start = group.start;
      items[0].end = group.end;
      items[0].field = group.field || items[0].field || "";
      items[0].machine = group.machine || items[0].machine || "";
      if (group.participation) items[0].participation = structuredClone(group.participation);
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

  const splitMergeValues = value => {
    return normalizeMultiText(value)
      .split(/[\/／,，、]/)
      .map(v => normalizeMergeScalar(v))
      .filter(Boolean);
  };

  items.forEach(item => {
    normalizeMultiText(item?.field || "").split("／").map(v => v.trim()).filter(Boolean).forEach(v => fieldSet.add(v));
    splitMergeValues(item?.workers || "").forEach(v => workerSet.add(v));
    splitMergeValues(item?.machine || "").forEach(v => machineSet.add(v));
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
    .map(item => normalizeTime(item?.end))
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
    ...mergeDiaryParticipation(groups),
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
    ...(Object.hasOwn(item, "participation") ? { participation: structuredClone(item.participation) }
      : Object.hasOwn(group, "participation") ? { participation: structuredClone(group.participation) } : {}),
    items: [{
      ...item,
      start: String(item?.start || "").trim(),
      end: String(item?.end || "").trim()
    }]
  }));
}
