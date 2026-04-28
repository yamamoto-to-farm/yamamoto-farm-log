// kpi-filter.js
// KPI（年間・月次）共通フィルタエンジン

let selectedYears = [];
let selectedFields = [];
let selectedVarieties = [];

// KPI 用データ（harvest-kpi.js からセット）
let kpiFilterData = {
  years: [],
  fields: [],
  varieties: []
};

export function setKpiFilterData(data) {
  kpiFilterData = data;
}

/* ============================================================
   activeFilters の描画
============================================================ */
function renderActiveFilters() {
  const area = document.getElementById("activeFilters");
  area.innerHTML = "";

  selectedYears.forEach(y => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${y}<span class="filter-tag-remove" data-year="${y}">×</span>`;
    area.appendChild(div);
  });

  selectedFields.forEach(f => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${f}<span class="filter-tag-remove" data-field="${f}">×</span>`;
    area.appendChild(div);
  });

  selectedVarieties.forEach(v => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${v}<span class="filter-tag-remove" data-variety="${v}">×</span>`;
    area.appendChild(div);
  });

  if (selectedYears.length || selectedFields.length || selectedVarieties.length) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "filter-reset-btn";
    resetBtn.textContent = "全解除";
    resetBtn.onclick = () => resetKpiFilters();
    area.appendChild(resetBtn);
  }

  document.querySelectorAll(".filter-tag-remove").forEach(el => {
    if (el.dataset.year) {
      el.onclick = () => {
        selectedYears = selectedYears.filter(v => v !== el.dataset.year);
        applyKpiFilters();
      };
    }
    if (el.dataset.field) {
      el.onclick = () => {
        selectedFields = selectedFields.filter(v => v !== el.dataset.field);
        applyKpiFilters();
      };
    }
    if (el.dataset.variety) {
      el.onclick = () => {
        selectedVarieties = selectedVarieties.filter(v => v !== el.dataset.variety);
        applyKpiFilters();
      };
    }
  });
}

/* ============================================================
   全解除
============================================================ */
export function resetKpiFilters() {
  selectedYears = [];
  selectedFields = [];
  selectedVarieties = [];
  applyKpiFilters();
  window.dispatchEvent(new Event("kpi-filter:reset"));
}

/* ============================================================
   KPI フィルタ適用（年間・月次共通）
============================================================ */
function applyKpiFilters() {
  const state = {
    years: selectedYears,
    fields: selectedFields,
    varieties: selectedVarieties
  };
  renderActiveFilters();
  window.dispatchEvent(new CustomEvent("kpi-filter:apply", { detail: state }));
}

/* ============================================================
   ▼ 年フィルタモーダル
============================================================ */
export function openKpiYearModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>
        <h3>年度の選択</h3>

        ${kpiFilterData.years.map(y => `
          <div class="select-item" data-year="${y}">${y}</div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;

  initKpiYearModalEvents();
}

function initKpiYearModalEvents() {
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll("[data-year]").forEach(el => {
    el.onclick = () => {
      const y = el.dataset.year;
      if (selectedYears.includes(y)) {
        selectedYears = selectedYears.filter(v => v !== y);
      } else {
        selectedYears.push(y);
      }
      updateYearSelections();
    };
  });

  document.getElementById("clear").onclick = () => {
    selectedYears = [];
    updateYearSelections();
  };

  document.getElementById("apply").onclick = () => {
    applyKpiFilters();
    closeModal();
  };

  updateYearSelections();
}

function updateYearSelections() {
  document.querySelectorAll("[data-year]").forEach(el => {
    el.classList.toggle("selected", selectedYears.includes(el.dataset.year));
  });
}

/* ============================================================
   ▼ 圃場フィルタ（KPI 用）
============================================================ */
export function openKpiFieldModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>
        <h3>圃場の選択</h3>

        ${kpiFilterData.fields.map(f => `
          <div class="select-item" data-field="${f}">${f}</div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;

  initKpiFieldModalEvents();
}

function initKpiFieldModalEvents() {
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll("[data-field]").forEach(el => {
    el.onclick = () => {
      const f = el.dataset.field;
      if (selectedFields.includes(f)) {
        selectedFields = selectedFields.filter(v => v !== f);
      } else {
        selectedFields.push(f);
      }
      updateFieldSelections();
    };
  });

  document.getElementById("clear").onclick = () => {
    selectedFields = [];
    updateFieldSelections();
  };

  document.getElementById("apply").onclick = () => {
    applyKpiFilters();
    closeModal();
  };

  updateFieldSelections();
}

function updateFieldSelections() {
  document.querySelectorAll("[data-field]").forEach(el => {
    el.classList.toggle("selected", selectedFields.includes(el.dataset.field));
  });
}

/* ============================================================
   ▼ 品種フィルタ（KPI 用）
============================================================ */
export function openKpiVarietyModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>
        <h3>品種の選択</h3>

        ${kpiFilterData.varieties.map(v => `
          <div class="select-item" data-variety="${v}">${v}</div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;

  initKpiVarietyModalEvents();
}

function initKpiVarietyModalEvents() {
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll("[data-variety]").forEach(el => {
    el.onclick = () => {
      const v = el.dataset.variety;
      if (selectedVarieties.includes(v)) {
        selectedVarieties = selectedVarieties.filter(x => x !== v);
      } else {
        selectedVarieties.push(v);
      }
      updateVarietySelections();
    };
  });

  document.getElementById("clear").onclick = () => {
    selectedVarieties = [];
    updateVarietySelections();
  };

  document.getElementById("apply").onclick = () => {
    applyKpiFilters();
    closeModal();
  };

  updateVarietySelections();
}

function updateVarietySelections() {
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.classList.toggle("selected", selectedVarieties.includes(el.dataset.variety));
  });
}

/* ============================================================
   モーダルを閉じる
============================================================ */
function closeModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = "";
  container.style.display = "none";
}
