import { invoiceSuggestions, recognizeInvoice, supplierCategories } from "./supplier-ocr.js?v=20261121-paper-invoices-2";

const el = id => document.getElementById(id);
let previewUrl;
let records = [];
let working = false;
let uploaded;

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function rows() {
  return [...el("supplier-items").rows].map(row => {
    const [name, amount, category] = row.querySelectorAll("input,select");
    return { item_name: name.value.trim(), amount: amount.valueAsNumber, category: category.value, subcategory: "" };
  });
}

function updateSum() {
  el("supplier-verified").checked = false;
  const items = rows();
  const complete = items.length && items.every(item => Number.isSafeInteger(item.amount));
  el("supplier-sum").textContent = complete ? `明細合計：${items.reduce((sum, item) => sum + item.amount, 0).toLocaleString("ja-JP")}円` : "金額未入力の明細があります。";
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
  amount.type = "number";
  amount.required = true;
  amount.step = "1";
  amount.value = item.amount ?? "";
  const category = node("select");
  category.setAttribute("aria-label", "明細分類");
  for (const value of supplierCategories) category.add(new Option(value, value));
  category.value = item.category || "未分類";
  const remove = node("button", "削除");
  remove.type = "button";
  remove.className = "secondary-btn";
  const row = node("tr");
  remove.onclick = () => { row.remove(); updateSum(); };
  for (const control of [name, amount, category, remove]) {
    const cell = node("td");
    cell.append(control);
    row.append(cell);
  }
  el("supplier-items").append(row);
  updateSum();
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
  const act = async task => {
    if (working) return;
    working = true;
    form.inert = true;
    result.textContent = "";
    result.classList.remove("error");
    try { await task(); }
    catch (error) { result.textContent = error.message; result.classList.add("error"); }
    finally { working = false; form.inert = false; }
  };
  const load = async () => {
    const data = await api("/supplier-invoices");
    if (!Array.isArray(data.invoices)) throw new Error("紙請求書の一覧を取得できませんでした。");
    records = data.invoices;
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
    onLoaded();
  };
  el("supplier-refresh").onclick = () => act(load);
  const clearDraft = () => {
    uploaded = undefined;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const link = el("supplier-local-pdf");
    link.removeAttribute("href");
    link.hidden = true;
    previewUrl = undefined;
    for (const id of ["supplier-vendor", "supplier-issue", "supplier-settlement", "supplier-total", "supplier-text"]) {
      el(id).value = "";
    }
    el("supplier-text").textContent = "";
    el("supplier-text-panel").hidden = true;
    el("supplier-items").replaceChildren();
    addRow();
  };
  el("supplier-pdf").onchange = () => {
    clearDraft();
    const file = el("supplier-pdf").files[0];
    if (file && /\.pdf$/i.test(file.name) && file.size && file.size <= 20 * 1024 * 1024) {
      const link = el("supplier-local-pdf");
      link.hidden = false;
      link.href = previewUrl = URL.createObjectURL(file);
    }
  };
  form.oninput = event => {
    if (event.target !== el("supplier-verified")) updateSum();
  };
  el("supplier-add").onclick = () => {
    try { addRow(); }
    catch (error) { result.textContent = error.message; }
  };
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
    if (details.open && !started) { started = true; void act(load); }
  });
  return {
    get: number => records.find(invoice => invoice.invoice_no === number),
    loadLinked: () => { started = true; return load(); },
    load: () => {
      if (!started) { started = true; void act(load); }
    },
    open: () => { details.open = true; details.scrollIntoView({ block: "start" }); },
  };
}
