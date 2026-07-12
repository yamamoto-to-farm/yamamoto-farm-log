// admin/edit-json/card-edit-fields.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { loadCSV } from "/common/csv.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData } from "/common/filter/filter-core.js?v=1";
import { showSaveModal, updateSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const LOG_TYPES_WITH_ALL_CSV = [
  "bedmaking",
  "discard-planting",
  "fertilizer",
  "field-maintenance",
  "hand-weeding",
  "harvest",
  "intertill",
  "pesticide",
  "planting",
  "seed",
  "tillage",
  "watering",
  "weeding",
  "weight"
];

const LOG_TYPES_WITH_FIELD_JSON = [
  "bedmaking",
  "fertilizer",
  "field-maintenance",
  "hand-weeding",
  "intertill",
  "pesticide",
  "tillage",
  "watering",
  "weeding"
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAddressInput(raw) {
  return String(raw || "")
    .split(/[\n,/]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function createDefaultFieldDetail(templateField = {}) {
  return {
    size: "未入力（a）",
    thumbnail: "未設定",
    memo: "未入力",
    parcels: [
      {
        address: "未入力",
        officialArea: "未入力（㎡）",
        owner: "未入力",
        rightType: "未入力",
        rent: "未入力"
      }
    ],
    contracts: [
      {
        start: "未入力",
        end: "未入力",
        rent: "未入力",
        notes: "未入力"
      }
    ],
    ...templateField
  };
}

async function syncFieldDetailByFields(fieldsList) {
  let currentDetail = {};
  try {
    currentDetail = await loadJSON("/data/field-detail.json");
  } catch {
    currentDetail = {};
  }

  const templateField = createDefaultFieldDetail(currentDetail.TEMPLATE_FIELD || {});
  const nextDetail = { TEMPLATE_FIELD: templateField };

  fieldsList.forEach(field => {
    const name = (field.name || "").trim();
    if (!name) return;

    nextDetail[name] = currentDetail[name]
      ? { ...templateField, ...currentDetail[name] }
      : { ...templateField };
  });

  await saveJSON("data/field-detail.json", nextDetail);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const lines = [headers.map(toCsvCell).join(",")];

  rows.forEach(row => {
    const cols = headers.map(h => toCsvCell(row?.[h] ?? ""));
    lines.push(cols.join(","));
  });

  return `${lines.join("\n")}\n`;
}

function replaceFieldCellValue(rawValue, renameMap) {
  const raw = String(rawValue ?? "");
  if (!raw) return { value: raw, changed: false, replacedCount: 0 };

  let changed = false;
  let replacedCount = 0;

  const parts = raw.split(/([/／])/);
  const replaced = parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      const token = String(part || "").trim();
      if (!token || !renameMap.has(token)) return part;
      changed = true;
      replacedCount += 1;
      return renameMap.get(token);
    })
    .join("");

  return { value: replaced, changed, replacedCount };
}

async function loadTypeIndex(type) {
  const candidates = [
    { load: `/data/${type}/${type}-index.json`, save: `data/${type}/${type}-index.json` },
    { load: `/data/${type}-index.json`, save: `data/${type}-index.json` }
  ];

  for (const c of candidates) {
    try {
      const data = await loadJSON(c.load);
      if (data && typeof data === "object") {
        return { data, savePath: c.save };
      }
    } catch {
      // ignore and try next
    }
  }

  return null;
}

function mergeTypeIndexEntry(oldEntry, newEntry) {
  if (!oldEntry) return newEntry;
  if (!newEntry) return oldEntry;

  const merged = { ...newEntry };
  Object.keys(oldEntry).forEach(year => {
    const oldFiles = Array.isArray(oldEntry[year]) ? oldEntry[year] : [];
    const nextFiles = Array.isArray(merged[year]) ? merged[year] : [];
    merged[year] = Array.from(new Set([...nextFiles, ...oldFiles])).sort();
  });
  return merged;
}

async function migrateTypeIndexKeys(renamePairs) {
  const updatedTypes = new Set();
  const errors = [];

  for (const type of LOG_TYPES_WITH_FIELD_JSON) {
    try {
      const loaded = await loadTypeIndex(type);
      if (!loaded) continue;

      const nextIndex = { ...loaded.data };
      let changed = false;

      renamePairs.forEach(({ oldName, newName }) => {
        const oldSafe = safeFieldName(oldName);
        const newSafe = safeFieldName(newName);
        if (!oldSafe || !newSafe || oldSafe === newSafe) return;
        if (!(oldSafe in nextIndex)) return;

        nextIndex[newSafe] = mergeTypeIndexEntry(nextIndex[oldSafe], nextIndex[newSafe]);
        delete nextIndex[oldSafe];
        changed = true;
      });

      if (!changed) continue;

      await saveJSON(loaded.savePath, nextIndex);
      updatedTypes.add(type);
    } catch (e) {
      errors.push(`${type}-index: ${String(e?.message || e)}`);
    }
  }

  return { updatedTypes: Array.from(updatedTypes), errors };
}

async function migrateFieldAllCsv(renamePairs) {
  const renameMap = new Map(renamePairs.map(v => [v.oldName, v.newName]));
  const touchedTypes = [];
  const errors = [];
  let replacedCells = 0;

  for (const type of LOG_TYPES_WITH_ALL_CSV) {
    try {
      const rows = await loadCSV(`/logs/${type}/all.csv`).catch(() => []);
      if (!Array.isArray(rows) || rows.length === 0) continue;
      if (!Object.prototype.hasOwnProperty.call(rows[0], "field")) continue;

      let changed = false;
      const nextRows = rows.map(row => {
        const original = String(row.field ?? "");
        const replaced = replaceFieldCellValue(original, renameMap);
        if (replaced.changed) {
          changed = true;
          replacedCells += replaced.replacedCount;
          return { ...row, field: replaced.value };
        }
        return row;
      });

      if (!changed) continue;

      const csv = buildCsvFromRows(nextRows);
      await saveLog({
        type,
        suppressModal: true,
        replaceCsv: csv,
        fileName: "all.csv"
      });

      touchedTypes.push(type);
    } catch (e) {
      errors.push(`${type}/all.csv: ${String(e?.message || e)}`);
    }
  }

  return { touchedTypes, replacedCells, errors };
}

async function migratePerFieldLogs(renamePairs) {
  const touched = [];
  const errors = [];

  for (const { oldName, newName } of renamePairs) {
    const oldSafe = safeFieldName(oldName);
    const newSafe = safeFieldName(newName);
    if (!oldSafe || !newSafe || oldSafe === newSafe) continue;

    for (const type of LOG_TYPES_WITH_FIELD_JSON) {
      try {
        const src = await loadJSON(`/logs/${type}/${oldSafe}.json`).catch(() => null);
        if (!src || typeof src !== "object" || Object.keys(src).length === 0) continue;

        const next = {
          ...src,
          field: newSafe
        };

        await saveLog({
          type: "multi",
          suppressModal: true,
          files: [
            {
              path: `logs/${type}/${newSafe}.json`,
              content: JSON.stringify(next, null, 2)
            }
          ]
        });

        touched.push(`${type}:${oldSafe}->${newSafe}`);
      } catch (e) {
        errors.push(`${type}/${oldSafe}.json: ${String(e?.message || e)}`);
      }
    }
  }

  return { touched, errors };
}

async function migrateHistoricalFieldData(renamePairs) {
  const csv = await migrateFieldAllCsv(renamePairs);
  const json = await migratePerFieldLogs(renamePairs);
  const index = await migrateTypeIndexKeys(renamePairs);

  return {
    csv,
    json,
    index,
    errors: [...csv.errors, ...json.errors, ...index.errors]
  };
}

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "圃場基本情報（fields.json）";

  const params = new URLSearchParams(location.search);
  const initialField = String(params.get("field") || "").trim();

  let listData = Array.isArray(json)
    ? json.map(v => ({ ...v }))
    : Object.values(json || {}).map(v => ({ ...v }));

  let nameKeyword = "";
  let selectedFieldIndex = -1;

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>圃場一覧</h2>
      <p style="margin:0 0 12px; color:#555;">
        圃場名を追加・削除して保存すると、field-detail.json も同じ圃場名で自動同期されます。
      </p>

      <div class="sub-card" style="margin-bottom:14px; background:#f8fbff; border:1px solid #dbeafe;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div>
            <label class="form-label">圃場検索（部分一致）</label>
            <input id="field-name-search" class="form-input" style="min-width:220px;" placeholder="圃場名で検索">
          </div>
          <div>
            <label class="form-label">編集対象を選択</label>
            <button id="open-field-target-modal" class="secondary-btn" type="button" style="min-width:320px; text-align:left;">
              圃場を選択
            </button>
            <div id="field-target-current" style="margin-top:6px; color:#555;"></div>
          </div>
          <button id="add-field-btn" class="secondary-btn" type="button">＋ 圃場を追加</button>
        </div>
        <div id="field-visible-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <div id="field-list"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <button id="go-field-detail-btn" class="secondary-btn" type="button">圃場詳細情報へ</button>
        <button id="save-btn" class="primary-btn">保存する</button>
      </div>
    </div>
  `);

  const listEl = document.getElementById("field-list");
  const nameSearchEl = document.getElementById("field-name-search");
  const openTargetModalBtn = document.getElementById("open-field-target-modal");
  const targetCurrentEl = document.getElementById("field-target-current");
  const countEl = document.getElementById("field-visible-count");
  const goDetailBtn = document.getElementById("go-field-detail-btn");

  function normalizeRows() {
    listData = listData.map(v => ({
      name: String(v.name || "").trim(),
      __originalName: String(v.__originalName ?? (v.name || "")).trim(),
      area: String(v.area || "").trim(),
      address: Array.isArray(v.address) ? v.address : parseAddressInput(v.address || ""),
      lat: v.lat == null || v.lat === "" ? "" : String(v.lat),
      lng: v.lng == null || v.lng === "" ? "" : String(v.lng)
    }));
  }

  function syncVisibleRowToListData() {
    const card = listEl.querySelector(".sub-card");
    if (!card) return;

    const idx = Number(card.dataset.index);
    if (!Number.isInteger(idx) || !listData[idx]) return;

    const name = String(card.querySelector(".field-name")?.value || "").trim();
    const area = String(card.querySelector(".field-area")?.value || "").trim();
    const address = parseAddressInput(card.querySelector(".field-address")?.value || "");
    const latRaw = String(card.querySelector(".field-lat")?.value || "").trim();
    const lngRaw = String(card.querySelector(".field-lng")?.value || "").trim();

    listData[idx] = {
      ...listData[idx],
      name,
      area,
      address,
      lat: latRaw,
      lng: lngRaw
    };
  }

  function getNameFilteredRows() {
    const q = String(nameKeyword || "").trim().toLowerCase();
    const rows = listData.map((item, index) => ({ item, index }));
    if (!q) return rows;

    return rows.filter(({ item }) => {
      const name = String(item.name || "").toLowerCase();
      const area = String(item.area || "").toLowerCase();
      return name.includes(q) || area.includes(q);
    });
  }

  function getVisibleRows() {
    const rows = getNameFilteredRows();
    if (!Number.isInteger(selectedFieldIndex) || selectedFieldIndex < 0) return rows.slice(0, 1);
    const selected = rows.find(v => v.index === selectedFieldIndex);
    return selected ? [selected] : rows.slice(0, 1);
  }

  function getTargetRowsSorted() {
    return getNameFilteredRows()
      .sort((a, b) => {
        const areaCmp = String(a.item.area || "").localeCompare(String(b.item.area || ""), "ja");
        if (areaCmp !== 0) return areaCmp;
        return String(a.item.name || "").localeCompare(String(b.item.name || ""), "ja");
      });
  }

  function refreshTargetSelection() {
    const rows = getTargetRowsSorted();
    const indices = rows.map(v => v.index);

    if (!Number.isInteger(selectedFieldIndex) || !indices.includes(selectedFieldIndex)) {
      if (initialField) {
        const hit = rows.find(v => String(v.item.name || "").trim() === initialField);
        selectedFieldIndex = hit ? hit.index : (indices[0] ?? -1);
      } else {
        selectedFieldIndex = indices[0] ?? -1;
      }
    }

    const selected = rows.find(v => v.index === selectedFieldIndex);
    const label = selected
      ? `${String(selected.item.area || "").trim() || "(エリア未入力)"} / ${String(selected.item.name || "").trim() || "(圃場名未入力)"}`
      : "対象なし";

    if (targetCurrentEl) targetCurrentEl.textContent = `現在: ${label}`;
  }

  function openTargetSelectModal() {
    syncVisibleRowToListData();

    const rows = getTargetRowsSorted();
    if (rows.length === 0) {
      alert("表示対象の圃場がありません。エリア・圃場検索条件を見直してください。");
      return;
    }

    const parents = [];
    const children = {};

    rows.forEach(({ item }) => {
      const area = String(item.area || "").trim() || "(エリア未入力)";
      const name = String(item.name || "").trim() || "(圃場名未入力)";
      if (!children[area]) {
        children[area] = [];
        parents.push(area);
      }
      if (!children[area].includes(name)) children[area].push(name);
    });

    setFilterData({
      yearMonths: [],
      fields: { parents, children },
      varieties: { parents: [], children: {} }
    });

    openFieldModal({
      mode: "select",
      onSelect: selectedName => {
        const hit = rows.find(v => String(v.item.name || "").trim() === selectedName);
        if (!hit) return;
        selectedFieldIndex = hit.index;
        render();
      }
    });
  }

  function render() {
    normalizeRows();
    refreshTargetSelection();

    const searchableRows = getNameFilteredRows();
    const visibleRows = getVisibleRows();

    if (countEl) {
      countEl.textContent = `検索対象 ${searchableRows.length} 件 / 全体 ${listData.length} 件`;
    }

    if (goDetailBtn) {
      goDetailBtn.onclick = () => {
        if (!Number.isInteger(selectedFieldIndex) || selectedFieldIndex < 0 || !listData[selectedFieldIndex]) {
          alert("編集対象の圃場を選択してください。");
          return;
        }
        const name = String(listData[selectedFieldIndex].name || "").trim();
        if (!name) {
          alert("先に圃場名を入力してください。");
          return;
        }
        location.href = `?data=field-detail&field=${encodeURIComponent(name)}`;
      };
    }

    listEl.innerHTML = "";

    if (visibleRows.length === 0) {
      listEl.innerHTML = `
        <div class="sub-card" style="margin-bottom:12px; color:#666;">
          表示対象がありません。エリア・名称検索・編集対象の選択条件を見直してください。
        </div>
      `;
      return;
    }

    visibleRows.forEach(({ item, index }) => {
      const name = item.name ?? "";
      const area = item.area ?? "";
      const address = Array.isArray(item.address)
        ? item.address.join(" / ")
        : "";
      const lat = item.lat ?? "";
      const lng = item.lng ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" data-index="${index}" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">圃場名</label>
            <input class="form-input field-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">エリア</label>
            <input class="form-input field-area" data-index="${index}" value="${escapeHtml(area)}">
          </div>

          <div class="form-row">
            <label class="form-label">住所（/ または , 区切り）</label>
            <input class="form-input field-address" data-index="${index}" value="${escapeHtml(address)}">
          </div>

          <div class="form-row">
            <label class="form-label">緯度（lat）</label>
            <input class="form-input field-lat" data-index="${index}" value="${escapeHtml(lat)}">
          </div>

          <div class="form-row">
            <label class="form-label">経度（lng）</label>
            <input class="form-input field-lng" data-index="${index}" value="${escapeHtml(lng)}">
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <button class="secondary-btn delete-field-btn" data-index="${index}">
              削除
            </button>
          </div>
        </div>
      `);
    });

    document.querySelectorAll(".delete-field-btn").forEach(btn => {
      btn.onclick = () => {
        syncVisibleRowToListData();
        const idx = Number(btn.dataset.index);
        if (!confirm("この圃場を削除しますか？\n保存時に field-detail からも削除されます。")) return;
        listData.splice(idx, 1);
        if (Number.isInteger(selectedFieldIndex) && selectedFieldIndex === idx) {
          selectedFieldIndex = -1;
        } else if (Number.isInteger(selectedFieldIndex) && selectedFieldIndex > idx) {
          selectedFieldIndex -= 1;
        }
        render();
      };
    });
  }

  render();

  nameSearchEl.oninput = () => {
    syncVisibleRowToListData();
    nameKeyword = nameSearchEl.value || "";
    selectedFieldIndex = -1;
    render();
  };

  if (openTargetModalBtn) {
    openTargetModalBtn.onclick = openTargetSelectModal;
  }

  document.getElementById("add-field-btn").onclick = () => {
    syncVisibleRowToListData();
    listData.push({
      name: "",
      __originalName: "",
      area: "",
      address: [],
      lat: "",
      lng: ""
    });
    selectedFieldIndex = listData.length - 1;
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    syncVisibleRowToListData();

    const newList = [];
    const usedNames = new Set();
    const renamePairs = [];
    let validationError = "";

    for (const row of listData) {
      const name = String(row.name || "").trim();
      const area = String(row.area || "").trim();
      const address = Array.isArray(row.address) ? row.address : parseAddressInput(row.address || "");
      const latRaw = String(row.lat || "").trim();
      const lngRaw = String(row.lng || "").trim();

      // 空名行は、実質入力がなければ保存対象外としてスキップ
      if (!name && !address.length && !latRaw && !lngRaw) {
        continue;
      }

      if (!name) {
        validationError = "圃場名が空の行があります。圃場名を入力してください。";
        break;
      }

      if (usedNames.has(name)) {
        validationError = `圃場名「${name}」が重複しています。`;
        break;
      }
      usedNames.add(name);

      const oldName = String(row.__originalName || "").trim();
      if (oldName && oldName !== name) {
        renamePairs.push({ oldName, newName: name });
      }

      const lat = latRaw === "" ? null : Number(latRaw);
      const lng = lngRaw === "" ? null : Number(lngRaw);

      newList.push({
        name,
        __originalName: name,
        area,
        address,
        lat,
        lng
      });
    }

    if (validationError) {
      alert(validationError);
      return;
    }

    let shouldMigrateHistory = false;
    if (renamePairs.length > 0) {
      const preview = renamePairs
        .slice(0, 6)
        .map(v => `・${v.oldName} → ${v.newName}`)
        .join("\n");

      shouldMigrateHistory = confirm(
        [
          "圃場名の変更を検出しました。",
          "過去ログも新しい圃場名へ置換しますか？",
          "",
          preview,
          renamePairs.length > 6 ? `…ほか ${renamePairs.length - 6} 件` : "",
          "",
          "「OK」: all.csv の field列、圃場別ログJSON、index を置換",
          "「キャンセル」: fields / field-detail のみ保存"
        ].filter(Boolean).join("\n")
      );
    }

    showSaveModal("保存しています…");

    listData = newList.map(v => ({ ...v }));

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");

    try {
      await updateSaveModal("fields.json / field-detail.json を保存しています…");
      await saveJSON(savePath, newList);
      await syncFieldDetailByFields(newList);

      if (shouldMigrateHistory) {
        await updateSaveModal("過去ログの圃場名を置換しています…");
        const migrated = await migrateHistoricalFieldData(renamePairs);

        const summary = [
          `all.csv更新: ${migrated.csv.touchedTypes.length} 種類`,
          `field列置換: ${migrated.csv.replacedCells} 箇所`,
          `圃場別JSON移行: ${migrated.json.touched.length} 件`,
          `index更新: ${migrated.index.updatedTypes.length} 種類`
        ].join(" / ");

        if (migrated.errors.length > 0) {
          alert([
            "保存は完了しましたが、一部の過去ログ置換でエラーがありました。",
            "",
            summary,
            "",
            "エラー例:",
            ...migrated.errors.slice(0, 8),
            migrated.errors.length > 8 ? `…ほか ${migrated.errors.length - 8} 件` : ""
          ].filter(Boolean).join("\n"));
        }

        completeSaveModal(`保存が完了しました（${summary}）`);
      } else {
        completeSaveModal("保存が完了しました");
      }
    } catch (e) {
      alert(String(e?.message || e || "保存に失敗しました。"));
      return;
    }
    render();
  };
}
