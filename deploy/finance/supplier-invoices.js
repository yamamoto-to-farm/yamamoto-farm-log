import { invoiceSuggestions, recognizeInvoice, supplierCategories } from "./supplier-ocr.js?v=20261121-paper-invoices-2";
import { annualComparison, formatYen, monthlyTotals } from "./finance-logic.js?v=20261107-dashboard-1";
import { todayLocalYmd } from "/common/date-utils.js?v=1";

const el = id => document.getElementById(id);
let previewUrl;
let records = [];
let working = false;
let uploaded;
let loaded = false;

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function rows() {
  return [...el("supplier-items").rows].map(row => {
    const [name, amount, category] = row.querySelectorAll("input,select");
    return { item_name: name.value.trim(), amount: parseAmount(amount.value), category: category.value, subcategory: "" };
  });
}

export function parseAmount(value) {
  const text = value.normalize("NFKC").trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return NaN;
  const number = Number(text.replace(/,/g, ""));
  return Number.isSafeInteger(number) ? number : NaN;
}

export function supplierKey(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");
}

export function classificationSuggestion(invoices, vendor, name) {
  const vendorKey = supplierKey(vendor), nameKey = supplierKey(name);
  if (!vendorKey || !nameKey) return null;
  const categories = new Set(invoices.filter(invoice => supplierKey(invoice.vendor_name) === vendorKey)
    .flatMap(invoice => invoice.items.filter(item => supplierKey(item.item_name) === nameKey
      && item.category !== "未分類").map(item => item.category)));
  return categories.size === 1 ? [...categories][0] : null;
}

function updateSum() {
  el("supplier-verified").checked = false;
  const items = rows();
  const complete = items.length && items.every(item => Number.isSafeInteger(item.amount));
  el("supplier-sum").textContent = complete ? `明細合計：${formatYen(items.reduce((sum, item) => sum + item.amount, 0))}` : "金額が未入力または不正な明細があります。";
  const total = el("supplier-total").valueAsNumber;
  el("supplier-total-display").textContent = Number.isSafeInteger(total) ? `請求額：${formatYen(total)}` : "";
}

function categorySelect(value = "未分類", includeUnclassified = true) {
  const select = node("select");
  if (!includeUnclassified) select.add(new Option("分類を選択", ""));
  for (const category of supplierCategories) {
    if (includeUnclassified || category !== "未分類") select.add(new Option(category, category));
  }
  select.value = value;
  return select;
}

function addRow(item = {}) {
  if (el("supplier-items").rows.length >= 100) throw new Error("明細は100行までです。");
  const name = node("input");
  name.setAttribute("aria-label", "品名");
  name.required = true;
  name.maxLength = 200;
  name.value = item.item_name || "";
  const amount = node("input");
  amount.setAttribute("aria-label", "明細金額");
  amount.type = "text";
  amount.inputMode = "numeric";
  amount.required = true;
  amount.value = Number.isSafeInteger(item.amount) ? item.amount.toLocaleString("ja-JP") : "";
  amount.onblur = () => {
    const value = parseAmount(amount.value);
    if (Number.isSafeInteger(value)) amount.value = value.toLocaleString("ja-JP");
  };
  const category = categorySelect(item.category);
  category.setAttribute("aria-label", "明細分類");
  const remove = node("button", "削除");
  remove.type = "button";
  remove.className = "secondary-btn";
  const row = node("tr");
  remove.onclick = () => { row.remove(); updateSum(); renderDraftGroups(); };
  for (const control of [name, amount, category, remove]) {
    const cell = node("td");
    cell.append(control);
    row.append(cell);
  }
  el("supplier-items").append(row);
  updateSum();
}

function renderDraftGroups() {
  const panel = el("supplier-draft-groups");
  panel.replaceChildren();
  const groups = new Map();
  for (const row of el("supplier-items").rows) {
    const [name] = row.querySelectorAll("input,select");
    const key = supplierKey(name.value);
    if (key) groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const wrapper = node("div", undefined);
    wrapper.className = "finance-toolbar";
    const name = group[0].querySelector("input").value.trim();
    const select = categorySelect("", false);
    select.setAttribute("aria-label", `${name}の一括分類`);
    const button = node("button", `${name}（${group.length}件）に適用`);
    button.type = "button";
    button.className = "secondary-btn";
    button.onclick = () => {
      if (!select.value) {
        el("supplier-status").textContent = "一括で適用する分類を選んでください。";
        el("supplier-status").classList.add("error");
        return;
      }
      for (const row of group) row.querySelector("select").value = select.value;
      updateSum();
      el("supplier-status").textContent = `${group.length}件に分類を反映しました。`;
      el("supplier-status").classList.remove("error");
    };
    wrapper.append(select, button);
    panel.append(wrapper);
  }
}

export function originalControl(api, invoiceNo) {
  const result = node("span");
  const button = node("button", "原本PDFのリンクを表示");
  button.type = "button";
  button.className = "secondary-btn";
  const status = node("span");
  status.setAttribute("role", "status");
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = "";
    try {
      const { url } = await api("/supplier-original", { invoice_no: invoiceNo });
      if (new URL(url).protocol !== "https:") throw new Error("原本のリンクが不正です。");
      const link = node("a", "原本PDFを開く（短時間有効）");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      status.replaceChildren(link);
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = false; }
  };
  result.append(button, status);
  return result;
}

export function supplierRows(invoices) {
  return invoices.flatMap(invoice => invoice.items.map(item => ({
    ...item, invoice_no: invoice.invoice_no, vendor_name: invoice.vendor_name,
    trade_date: invoice.issue_date, settlement_date: invoice.settlement_date || invoice.issue_date,
  })));
}

export function filterSupplierRows(items, { from, to, vendor, category, query }) {
  const search = supplierKey(query);
  return items.filter(item => {
    const month = item.trade_date.slice(0, 7);
    return (!from || month >= from) && (!to || month <= to)
      && (!vendor || item.vendor_name === vendor) && (!category || item.category === category)
      && (!search || supplierKey(item.item_name).includes(search));
  });
}

export function supplierGroups(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.category !== "未分類") continue;
    const key = JSON.stringify([supplierKey(item.vendor_name), supplierKey(item.item_name)]);
    if (!groups.has(key)) groups.set(key, { vendor_name: item.vendor_name, item_name: item.item_name, items: [], total: 0 });
    const group = groups.get(key);
    group.items.push(item);
    group.total += item.amount;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.item_name.localeCompare(b.item_name));
}

function selectedFile() {
  const file = el("supplier-pdf").files[0];
  if (!file || !/\.pdf$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
    throw new Error("20MB以下のPDFを選択してください。");
  }
  return file;
}

export function initSuppliers(api, onLoaded) {
  el("paper-invoice-content").append(el("supplier-panel-template").content.cloneNode(true));
  const result = el("supplier-status");
  const form = el("supplier-form");
  const dashboardStatus = el("supplier-dashboard-status");
  const act = async (task, target = result) => {
    if (working) return;
    working = true;
    form.inert = true;
    el("supplier-dashboard").inert = true;
    target.textContent = "";
    target.classList.remove("error");
    try { await task(); }
    catch (error) { target.textContent = error.message; target.classList.add("error"); }
    finally { working = false; form.inert = false; el("supplier-dashboard").inert = false; }
  };
  const saveClassifications = async (items, category) => {
    if (!category || !supplierCategories.includes(category)) throw new Error("分類を選択してください。");
    const invoiceNumbers = [...new Set(items.map(item => item.invoice_no))];
    let completed = 0;
    try {
      for (const invoiceNo of invoiceNumbers) {
        const index = records.findIndex(invoice => invoice.invoice_no === invoiceNo);
        if (index < 0) throw new Error("請求書が見つかりません。最新データを取得してください。");
        const targets = items.filter(item => item.invoice_no === invoiceNo);
        const response = await api("/classifications", {
          source: "paper", invoice_no: invoiceNo, signature: records[index].signature,
          items: targets.map(item => ({ line_seq: item.line_seq, category })),
        });
        if (response.saved !== true || response.invoice?.invoice_no !== invoiceNo
            || !Array.isArray(response.invoice.items) || typeof response.invoice.signature !== "string") {
          throw new Error("保存結果を確認できません。最新データを取得してください。");
        }
        records[index] = response.invoice;
        completed += targets.length;
      }
    } catch (error) {
      renderDashboard();
      onLoaded();
      throw new Error(`${completed}件を保存しました。残りは未確認です。${error.message}`);
    }
    renderDashboard();
    onLoaded();
    dashboardStatus.textContent = `${completed}件の分類を保存しました。銀行画面には最新データの更新後に反映されます。`;
  };
  const renderDashboard = () => {
    const all = supplierRows(records);
    const values = {
      from: el("supplier-from").value, to: el("supplier-to").value,
      vendor: el("supplier-filter-vendor").value, category: el("supplier-filter-category").value,
      query: el("supplier-query").value,
    };
    const valid = !values.from || !values.to || values.from <= values.to;
    const filtered = valid ? filterSupplierRows(all, values) : [];
    el("supplier-filter-status").textContent = valid
      ? `${filtered.length}明細を表示中。請求額・明細額には消費税や繰越残高を含みます。`
      : "開始月は終了月以前にしてください。";
    const overview = el("supplier-overview");
    overview.replaceChildren();
    for (const [label, value] of [
      ["保存済み請求書", `${records.length}件`],
      ["全請求額", formatYen(records.reduce((sum, invoice) => sum + invoice.total_amount, 0))],
      ["未分類の明細", `${all.filter(item => item.category === "未分類").length}件`],
    ]) {
      const card = node("div", undefined);
      card.className = "finance-stat";
      card.append(node("span", label), node("strong", value));
      overview.append(card);
    }
    const monthly = el("supplier-monthly");
    monthly.replaceChildren();
    const months = monthlyTotals(filtered, "trade");
    const maximum = Math.max(1, ...months.map(month => month.total));
    for (const month of months) {
      const row = node("tr");
      const trend = node("td");
      if (month.total >= 0) {
        const bar = node("progress");
        bar.max = maximum;
        bar.value = month.total;
        bar.setAttribute("aria-label", `${month.month}の明細額 ${formatYen(month.total)}`);
        trend.append(bar);
      } else trend.textContent = "マイナス";
      row.append(node("td", month.month), node("td", formatYen(month.total)), trend,
        node("td", Object.entries(month.categories).map(([category, amount]) => `${category} ${formatYen(amount)}`).join(" ／ ")));
      monthly.append(row);
    }
    const annual = el("supplier-annual");
    annual.replaceChildren();
    const year = Number(el("supplier-year").value);
    if (year) {
      const comparison = annualComparison(all, todayLocalYmd(), year);
      const current = comparison.current;
      el("supplier-annual-note").textContent = `${current.start}〜${current.end}の発行分：${formatYen(current.total)}。`
        + (comparison.difference === null ? "前年比較に必要なデータがありません。"
          : `前年同期との差：${formatYen(comparison.difference)}。`)
        + "未取り込み分は含まず、繰越残高等を含むため参考値です。";
      for (const value of current.rows.filter(row => row.amount !== 0)) {
        const row = node("tr");
        row.append(...[value.category, formatYen(value.amount),
          value.percent === null ? "—" : `${value.percent.toFixed(1)}%`].map(text => node("td", text)));
        annual.append(row);
      }
    }
    const groups = el("supplier-groups");
    groups.replaceChildren();
    for (const group of supplierGroups(filtered)) {
      const row = node("tr");
      const actions = node("td");
      const select = categorySelect("", false);
      select.setAttribute("aria-label", `${group.vendor_name} ${group.item_name}の分類`);
      const button = node("button", "まとめて保存");
      button.type = "button";
      button.className = "secondary-btn";
      button.onclick = () => act(() => saveClassifications(group.items, select.value), dashboardStatus);
      actions.append(select, button);
      row.append(node("td", `${group.vendor_name} ／ ${group.item_name}`),
        node("td", `${group.items.length}件 ／ ${formatYen(group.total)}`), actions);
      groups.append(row);
    }
    const savedItems = el("supplier-saved-items");
    savedItems.replaceChildren();
    for (const item of filtered) {
      const row = node("tr");
      const category = node("td");
      const select = categorySelect(item.category);
      select.setAttribute("aria-label", `${item.item_name}の分類`);
      category.append(select);
      const action = node("td");
      const save = node("button", "分類を保存");
      save.type = "button";
      save.className = "secondary-btn";
      save.onclick = () => act(() => saveClassifications([item], select.value), dashboardStatus);
      action.append(save);
      row.append(node("td", `${item.trade_date} ／ ${item.vendor_name}`), node("td", item.item_name),
        node("td", formatYen(item.amount)), category, action);
      savedItems.append(row);
    }
  };
  const refreshFilters = () => {
    const vendor = el("supplier-filter-vendor").value;
    const vendors = [...new Set(records.map(invoice => invoice.vendor_name))].sort();
    el("supplier-filter-vendor").replaceChildren(new Option("すべて", ""));
    for (const value of vendors) el("supplier-filter-vendor").add(new Option(value, value));
    el("supplier-filter-vendor").value = vendors.includes(vendor) ? vendor : "";
    const selected = el("supplier-year").value;
    const todayYear = Number(todayLocalYmd().slice(0, 4));
    const years = [...new Set([todayYear, ...records.map(invoice => Number(invoice.issue_date.slice(0, 4)))])]
      .filter(year => year <= todayYear).sort((a, b) => b - a);
    el("supplier-year").replaceChildren();
    for (const year of years) el("supplier-year").add(new Option(`${year}年`, String(year)));
    if (years.includes(Number(selected))) el("supplier-year").value = selected;
  };
  const load = async () => {
    const data = await api("/supplier-invoices");
    if (!Array.isArray(data.invoices)) throw new Error("紙請求書の一覧を取得できませんでした。");
    records = data.invoices;
    loaded = true;
    const list = el("supplier-invoices");
    list.replaceChildren();
    for (const invoice of records) {
      const row = node("p");
      const vendor = invoice.vendor_name || "仕入先未設定";
      const href = node("a", `${vendor} ／ ${invoice.issue_date}発行 ／ ${invoice.total_amount.toLocaleString("ja-JP")}円`);
      href.href = `?view=paper&source=paper&invoice=${encodeURIComponent(invoice.invoice_no)}#linked-invoice-panel`;
      row.append(href);
      list.append(row);
    }
    if (!records.length) list.append(node("p", "保存済み請求書はありません。"));
    refreshFilters();
    renderDashboard();
    onLoaded();
  };
  for (const category of supplierCategories) el("supplier-filter-category").add(new Option(category, category));
  for (const id of ["supplier-from", "supplier-to", "supplier-filter-vendor", "supplier-filter-category", "supplier-query", "supplier-year"]) {
    el(id).addEventListener("input", renderDashboard);
  }
  el("supplier-refresh").onclick = () => act(async () => { await load(); dashboardStatus.textContent = "最新データを取得しました。"; }, dashboardStatus);
  const clearDraft = () => {
    uploaded = undefined;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const link = el("supplier-local-pdf");
    link.removeAttribute("href");
    link.hidden = true;
    el("supplier-preview-frame").removeAttribute("src");
    el("supplier-preview").hidden = true;
    el("supplier-preview").open = false;
    previewUrl = undefined;
    for (const id of ["supplier-vendor", "supplier-issue", "supplier-settlement", "supplier-total", "supplier-text"]) {
      el(id).value = "";
    }
    el("supplier-text").textContent = "";
    el("supplier-text-panel").hidden = true;
    el("supplier-items").replaceChildren();
    addRow();
    renderDraftGroups();
  };
  el("supplier-pdf").onchange = () => {
    clearDraft();
    const file = el("supplier-pdf").files[0];
    if (file && /\.pdf$/i.test(file.name) && file.size && file.size <= 20 * 1024 * 1024) {
      const link = el("supplier-local-pdf");
      link.hidden = false;
      link.href = previewUrl = URL.createObjectURL(file);
      el("supplier-preview-frame").src = previewUrl;
      el("supplier-preview").hidden = false;
    }
  };
  form.oninput = event => {
    if (event.target === el("supplier-verified") || el("supplier-draft-groups").contains(event.target)) return;
    updateSum();
    if (event.target.matches('#supplier-items input[aria-label="品名"]')) renderDraftGroups();
  };
  el("supplier-add").onclick = () => {
    try { addRow(); renderDraftGroups(); }
    catch (error) { result.textContent = error.message; }
  };
  el("supplier-apply-suggestions").onclick = () => act(async () => {
    const vendor = el("supplier-vendor").value.trim();
    if (!vendor) throw new Error("先に仕入先名を入力してください。");
    if (!loaded) await load();
    let count = 0;
    for (const row of el("supplier-items").rows) {
      const [name, , category] = row.querySelectorAll("input,select");
      const suggestion = classificationSuggestion(records, vendor, name.value);
      if (category.value === "未分類" && suggestion) { category.value = suggestion; count++; }
    }
    updateSum();
    result.textContent = count ? `${count}件に分類候補を反映しました。内容を確認してください。`
      : "一致する分類候補はありません。分類が競合する品名も対象外です。";
  });
  el("supplier-ocr").onclick = () => act(async () => {
    const file = selectedFile();
    if ((el("supplier-issue").value || el("supplier-total").value || rows().some(item => item.item_name))
        && !confirm("入力済みの内容をOCR候補で置き換えますか？")) return;
    result.textContent = "ブラウザー内でOCRを準備しています…";
    const { text, items } = await recognizeInvoice(file, value => { result.textContent = `OCRで読み取り中… ${value}%`; });
    const draft = invoiceSuggestions(text, items);
    el("supplier-issue").value = draft.issue_date;
    el("supplier-settlement").value = draft.settlement_date;
    el("supplier-total").value = draft.total_amount;
    el("supplier-text").textContent = text;
    el("supplier-text-panel").hidden = !text.trim();
    el("supplier-items").replaceChildren();
    for (const item of draft.items.length ? draft.items : [{}]) addRow(item);
    renderDraftGroups();
    result.textContent = "原本と見比べて、空欄・誤読・抜けを修正してください。";
  });
  form.onsubmit = event => {
    event.preventDefault();
    return act(async () => {
      const file = selectedFile();
      const items = rows();
      const total = el("supplier-total").valueAsNumber;
      if (!el("supplier-verified").checked || !items.length || !Number.isSafeInteger(total) || total < 1
          || items.some(item => !item.item_name || !Number.isSafeInteger(item.amount))
          || items.reduce((sum, item) => sum + item.amount, 0) !== total) {
        throw new Error("原本との照合を確認し、明細合計を請求額と一致させてください。");
      }
      result.textContent = "請求書を保存しています…";
      if (!uploaded) {
        const { key, upload } = await api("/supplier-uploads", {});
        const body = new FormData();
        for (const [field, value] of Object.entries(upload.fields)) body.append(field, value);
        body.append("file", file);
        const response = await fetch(upload.url, { method: "POST", body });
        if (!response.ok) throw new Error(`原本PDFの保存に失敗しました（${response.status}）。`);
        uploaded = key;
      }
      const saved = await api("/supplier-invoices", {
        source_file: uploaded, vendor_name: el("supplier-vendor").value.trim(),
        issue_date: el("supplier-issue").value,
        settlement_date: el("supplier-settlement").value || null, total_amount: total, items, verified: true,
      });
      if (saved.saved !== true || saved.source !== "paper" || !/^[a-f0-9]{32}$/.test(saved.invoice_no)) {
        throw new Error("請求書の保存結果を確認できません。最新データを更新してください。");
      }
      form.reset();
      clearDraft();
      result.textContent = "照合した請求書を保存しました。";
      try { await load(); }
      catch (error) { result.textContent = `請求書は保存済みですが、一覧の更新に失敗しました。${error.message}`; }
    });
  };
  addRow();
  const details = el("paper-invoice-upload");
  let started = false;
  details.addEventListener("toggle", () => {
    if (details.open && !started) { started = true; void act(load, dashboardStatus); }
  });
  return {
    get: number => records.find(invoice => invoice.invoice_no === number),
    loadLinked: () => { started = true; return load(); },
    load: () => {
      if (!started) { started = true; void act(load, dashboardStatus); }
    },
    open: () => { details.open = true; details.scrollIntoView({ block: "start" }); },
  };
}
