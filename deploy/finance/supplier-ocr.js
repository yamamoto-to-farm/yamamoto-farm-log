const assets = "/finance/ocr-assets";
let tesseractScript;

function loadTesseract() {
  if (!tesseractScript) {
    tesseractScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${assets}/tesseract.min.js`;
      script.onload = () => resolve(globalThis.Tesseract);
      script.onerror = () => {
        tesseractScript = null;
        script.remove();
        reject(new Error("OCRを読み込めませんでした。"));
      };
      document.head.append(script);
    });
  }
  return tesseractScript;
}

export async function recognizeInvoice(file, progress) {
  const [pdfjs, tesseract] = await Promise.all([import(`${assets}/pdf.mjs`), loadTesseract()]);
  pdfjs.GlobalWorkerOptions.workerSrc = `${assets}/pdf.worker.mjs`;
  const loading = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  let worker;
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 10) throw new Error("OCRできるPDFは10ページまでです。");
    const getWorker = async () => worker ??= await tesseract.createWorker("jpn", 1, {
      workerPath: `${assets}/worker.min.js`, corePath: assets, langPath: assets, cacheMethod: "none",
      logger: ({ status, progress: value }) => {
        if (status === "recognizing text") progress(Math.floor(value * 100));
      },
    });
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const native = (await page.getTextContent()).items.map(item => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`).join("");
      if (native.trim().length > 100) {
        texts.push(native);
        continue;
      }
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 3300 / Math.max(original.width, original.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const ocr = await getWorker();
        const text = (await ocr.recognize(canvas)).data.text;
        const draft = invoiceSuggestions(text);
        let extra = "";
        if (i === 1 && /前回御請求.*消費税.*当月御請求/.test(text.replace(/[^\S\n]+/g, ""))) {
          // On this layout the issue date and summary figures are small relative to the page.
          const region = (x, y, w, h) => ({
            left: Math.floor(canvas.width * x), top: Math.floor(canvas.height * y),
            width: Math.floor(canvas.width * w), height: Math.floor(canvas.height * h),
          });
          if (!draft.issue_date) {
            const date = (await ocr.recognize(canvas, { rectangle: region(.66, .024, .17, .018) })).data.text;
            extra += `\n${date}`;
          }
          if (!draft.total_amount) {
            await ocr.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE, tessedit_char_whitelist: "0123456789, " });
            try {
              const summary = (await ocr.recognize(canvas, { rectangle: region(.075, .201, .86, .025) })).data.text;
              let amount = summaryTotal(summary);
              if (!amount) {
                const cell = (await ocr.recognize(canvas, { rectangle: region(.81, .204, .124, .019) })).data.text.replace(/\s+/g, "");
                if (/^(?:\d{1,3}(?:,\d{3})+|\d{1,9})$/.test(cell)) amount = yen(cell);
              }
              if (amount) extra += `\n当月御請求額：${amount}`;
            } finally {
              await ocr.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK, tessedit_char_whitelist: "" });
            }
          }
        }
        texts.push(text + extra);
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
    return texts.join("\n");
  } finally {
    try { if (worker) await worker.terminate(); }
    finally { await loading.destroy(); }
  }
}

export const supplierCategories = ["未分類", "種苗費", "農薬費", "肥料費", "資材・消耗品", "機械部品・装備", "機械整備工賃"];

function yen(value) {
  const clean = value.normalize("NFKC").replace(/[,\s円¥]/g, "").replace(/^[△▲−]/, "-");
  return /^-?\d+$/.test(clean) && Number.isSafeInteger(Number(clean)) ? Number(clean) : null;
}

function summaryTotal(line) {
  const cells = line.trim().split(/[\s|｜]+/).filter(Boolean);
  if (cells.length !== 6 || cells.some(cell => !/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(cell))) return null;
  const [previous, credits, carry, purchases, tax, total] = cells.map(yen);
  return cells.every(cell => yen(cell) !== null) && previous - credits === carry && carry + purchases + tax === total ? total : null;
}

function findDate(lines, label) {
  const pattern = /(?:(令和)(元|\d{1,2})|(\d{4}))[年/.-](\d{1,2})[月/.-](\d{1,2})/;
  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    const source = compact.split(label)[1];
    const parts = source?.match(pattern);
    if (!parts) continue;
    const year = parts[1] ? 2018 + (parts[2] === "元" ? 1 : Number(parts[2])) : Number(parts[3]);
    const date = `${year}-${parts[4].padStart(2, "0")}-${parts[5].padStart(2, "0")}`;
    if (new Date(date).toJSON()?.slice(0, 10) === date) return date;
  }
  return "";
}

export function invoiceSuggestions(text) {
  const lines = text.normalize("NFKC").split(/\r?\n/);
  const issue_date = findDate(lines, /発行日|請求日/);
  const settlement_date = findDate(lines, /引落予定日|支払(?:期日|期限|予定日)|振込期限/);
  let total_amount = "";
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].replace(/\s+/g, "");
    const explicit = normalized.match(/(?:当月御請求額|今回御請求額|ご請求金額|請求金額|請求合計)[:：¥]?((?:\d{1,3}(?:,\d{3})+|\d+))(?:円|$)/);
    if (explicit) total_amount = yen(explicit[1]);
    if (!total_amount && /前回御請求額.*消費税額.*当月御請求/.test(normalized)) {
      total_amount = summaryTotal(lines[i + 1] || "") ?? "";
    }
    const row = lines[i].match(/^\s*[|｜]?\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})[\s|｜」]+(.+)$/);
    if (!row || +row[1] < 1 || +row[1] > 12 || +row[2] < 1 || +row[2] > 31
        || /入\s*金|繰\s*越|小\s*計|合\s*計|値\s*引|メ\s*モ/.test(row[3])) continue;
    const cells = row[3].split(/[|｜]/).map(cell => cell.trim());
    const nameCell = cells.findIndex(cell => /[ぁ-んァ-ヶ一-龠]/.test(cell));
    if (nameCell < 0) continue;
    const item_name = cells[nameCell].split(/\s+[△▲−-]?\d{1,3}\s*,/)[0].replace(/\s+/g, "");
    if (!/[ぁ-んァ-ヶ一-龠]/.test(item_name)) continue;
    // Plant/goods rows have distinct quantity, unit, unit price, line amount, tax, and running balance cells.
    const tail = cells.slice(nameCell + 1);
    const [quantity, unit, price, lineAmount, tax, balance] = tail;
    const amount = tail.length === 6 && /\D/.test(unit) && /^\d+$/.test(quantity)
      && yen(price) > 0 && yen(lineAmount) === Number(quantity) * yen(price)
      && (!tax || yen(tax) !== null) && yen(balance) !== null ? yen(lineAmount) : null;
    const category = /播種|種苗|プラグ苗|種子/.test(item_name) ? "種苗費" : "未分類";
    items.push({ item_name, amount: amount ?? "", category, subcategory: "" });
  }
  return { issue_date, settlement_date, total_amount, items: items.slice(0, 100) };
}
