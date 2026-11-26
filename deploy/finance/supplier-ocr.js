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
    });
    const texts = [];
    const layouts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(`OCRで読み取り中…（${i}/${pdf.numPages}ページ）`);
      const page = await pdf.getPage(i);
      const native = (await page.getTextContent()).items.map(item => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`).join("");
      if (native.trim().length > 100) {
        texts.push(native);
        layouts.push(null);
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
        const recognition = (await ocr.recognize(canvas, {}, { text: true, blocks: true })).data;
        const text = recognition.text;
        progress(`明細を解析中…（${i}/${pdf.numPages}ページ）`);
        layouts.push(await recognizeRuledTable(canvas, ocr, tesseract, recognition.blocks));
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
              const details = summaryValues(summary);
              if (details) {
                extra += `\n請求内訳: ${details.join(" | ")}`;
              } else {
                const cell = (await ocr.recognize(canvas, { rectangle: region(.81, .204, .124, .019) })).data.text.replace(/\s+/g, "");
                if (/^(?:\d{1,3}(?:,\d{3})+|\d{1,9})$/.test(cell)) extra += `\n当月御請求額：${yen(cell)}`;
              }
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
    progress("明細を解析中…");
    return {
      text: texts.join("\n"),
      items: layouts.every(items => items !== null) ? layouts.flat() : null,
    };
  } finally {
    try { if (worker) await worker.terminate(); }
    finally { await loading.destroy(); }
  }
}

export const supplierCategories = ["未分類", "種苗費", "農薬費", "肥料費", "資材・消耗品", "機械部品・装備", "機械整備工賃"];

function green(data, index) {
  return data[index + 1] > 60 && data[index + 1] > data[index] * 1.07
    && data[index + 1] > data[index + 2] * 1.04;
}

export function ruledTableColumns(image, headerBottom) {
  const { width, height, data } = image;
  const top = Math.ceil(headerBottom + 2);
  const bottom = Math.min(height, top + Math.floor(height * .22));
  if (bottom - top < height * .15) return null;
  const groups = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    let count = 0;
    if (x < width) {
      for (let y = top; y < bottom; y += 2) {
        if (green(data, (y * width + x) * 4)) count++;
      }
    }
    const hit = count > (bottom - top) / 2 * .4;
    if (hit && start < 0) start = x;
    if (!hit && start >= 0) {
      groups.push(Math.round((start + x - 1) / 2));
      start = -1;
    }
  }
  if (groups.length !== 10) return null;
  const total = groups[9] - groups[0];
  const sizes = groups.slice(1).map((value, i) => (value - groups[i]) / total);
  if (total < width * .5 || sizes[2] < .25 || sizes[2] > .55
      || sizes.some(size => size < .01 || size > .55)
      || sizes.slice(5, 8).some(size => size < .04 || size > .15)) return null;
  return groups;
}

function tableNumber(value) {
  const text = value.normalize("NFKC").replace(/\s/g, "");
  if (!/^(?:\d+|\d{1,3}(?:[,.]{1,2}\d{3})+)$/.test(text)) return null;
  const number = Number(text.replace(/[,.]/g, ""));
  return Number.isSafeInteger(number) ? number : null;
}

function ruledTableRows(blocks, columns, left) {
  const rows = [];
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) {
    for (const line of paragraph.lines || []) {
      const cells = Array.from({ length: 9 }, () => []);
      for (const word of line.words || []) {
        const center = left + (word.bbox.x0 + word.bbox.x1) / 2;
        const index = columns.findIndex((column, i) => i < 9 && center >= column && center < columns[i + 1]);
        if (index >= 0) cells[index].push(word.text);
      }
      const date = cells[0].join("").normalize("NFKC");
      const item_name = cells[2].join("").replace(/\s+/g, "");
      const kind = cells[1].join("") + item_name;
      if ((date.match(/\d/g) || []).length < 2 || !/[ぁ-んァ-ヶ一-龠]/.test(item_name)
          || /メモ|繰越|入金|値引|合計|小計/.test(kind)) continue;
      const quantity = tableNumber(cells[3].join(""));
      const price = tableNumber(cells[5].join(""));
      const amount = tableNumber(cells[6].join(""));
      const verifiedAmount = quantity > 0 && price > 0 && amount > 0 && quantity * price === amount ? amount : "";
      const centers = (line.words || []).map(word => (word.bbox.y0 + word.bbox.y1) / 2).sort((a, b) => a - b);
      const heights = (line.words || []).map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b);
      const numbers = [3, 5, 6].map(index => {
        const values = [tableNumber(cells[index].join(""))];
        if (index === 3) {
          const digits = cells[index].filter(word => /^\d+$/.test(word.normalize("NFKC")));
          if (digits.length === 1) values.push(tableNumber(digits[0]));
        }
        return values.filter(value => value !== null);
      });
      rows.push({ item: {
        item_name,
        amount: verifiedAmount,
        category: /播種|種苗|プラグ苗|種子/.test(item_name) ? "種苗費" : "未分類",
        ...(verifiedAmount !== "" ? {
          quantity: String(quantity), unit_price: String(price),
          unit: cells[4].join("").trim().slice(0, 40),
        } : {}),
      }, numbers, center: centers[Math.floor(centers.length / 2)], height: heights[Math.floor(heights.length / 2)] });
    }
  }
  return rows;
}

export function ruledTableItems(blocks, columns, left) {
  return ruledTableRows(blocks, columns, left).map(row => row.item);
}

export async function recognizeRuledTable(canvas, worker, tesseract, blocks) {
  const lines = (blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
  const header = lines.find(line => /月日.*品名.*規.*単価/.test(line.text.replace(/\s+/g, "")));
  if (!header) return null;
  const context = canvas.getContext("2d");
  const columns = ruledTableColumns(context.getImageData(0, 0, canvas.width, canvas.height), header.bbox.y1);
  if (!columns) return null;
  const left = Math.max(0, columns[0] - 4);
  const top = Math.min(canvas.height, header.bbox.y1 + 1);
  const table = document.createElement("canvas");
  table.width = Math.min(canvas.width - left, columns[9] - left + 5);
  table.height = canvas.height - top;
  try {
    const tableContext = table.getContext("2d");
    tableContext.drawImage(canvas, left, top, table.width, table.height, 0, 0, table.width, table.height);
    const image = tableContext.getImageData(0, 0, table.width, table.height);
    for (let i = 0; i < image.data.length; i += 4) {
      if (green(image.data, i)) image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
    }
    tableContext.putImageData(image, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK, tessedit_char_whitelist: "" });
    const result = await worker.recognize(table, {}, { text: true, blocks: true });
    const rows = ruledTableRows(result.data.blocks, columns, left);
    if (!rows.length) return null;
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE, tessedit_char_whitelist: "0123456789,." });
    try {
      for (const row of rows) {
        if (row.item.amount !== "") continue;
        for (const [index, column] of [3, 5, 6].entries()) {
          const rectangle = {
            left: Math.max(0, columns[column] - left + 3),
            top: Math.max(0, Math.floor(row.center - row.height * .8)),
            width: columns[column + 1] - columns[column] - 6,
            height: Math.max(1, Math.ceil(row.height * 1.6)),
          };
          if (rectangle.top + rectangle.height > table.height || rectangle.width < 1) break;
          const value = tableNumber((await worker.recognize(table, { rectangle })).data.text);
          if (value !== null) row.numbers[index].push(value);
        }
        const [quantities, prices, amounts] = row.numbers;
        const matches = new Set(amounts.filter(amount => amount > 0
          && quantities.some(quantity => quantity > 0
            && prices.some(price => price > 0 && quantity * price === amount))));
        if (matches.size === 1) {
          row.item.amount = [...matches][0];
          const pairs = new Map();
          for (const quantity of quantities) for (const price of prices) {
            if (quantity > 0 && price > 0 && quantity * price === row.item.amount) {
              pairs.set(`${quantity}:${price}`, [quantity, price]);
            }
          }
          if (pairs.size === 1) {
            const [quantity, price] = [...pairs.values()][0];
            row.item.quantity = String(quantity);
            row.item.unit_price = String(price);
          }
        }
      }
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK, tessedit_char_whitelist: "" });
    }
    return rows.map(row => row.item);
  } finally {
    table.width = table.height = 0;
  }
}

function yen(value) {
  const clean = value.normalize("NFKC").replace(/[,\s円¥]/g, "").replace(/^[△▲−]/, "-");
  return /^-?\d+$/.test(clean) && Number.isSafeInteger(Number(clean)) ? Number(clean) : null;
}

function summaryValues(line) {
  const cells = line.trim().replace(/,\s+(?=\d{3}(?:\s|$|[|｜]))/g, ",").split(/[\s|｜]+/).filter(Boolean);
  if (cells.length !== 6 || cells.some(cell => !/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(cell))) return null;
  const [previous, credits, carry, purchases, tax, total] = cells.map(yen);
  return cells.every(cell => yen(cell) !== null) && previous - credits === carry && carry + purchases + tax === total
    ? [previous, credits, carry, purchases, tax, total] : null;
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

export function invoiceSuggestions(text, layoutItems = null) {
  const lines = text.normalize("NFKC").split(/\r?\n/);
  const issue_date = findDate(lines, /発行日|請求日/);
  const settlement_date = findDate(lines, /引落予定日|支払(?:期日|期限|予定日)|振込期限/);
  let total_amount = "";
  let summary;
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].replace(/\s+/g, "");
    const explicit = normalized.match(/(?:当月御請求額|今回御請求額|ご請求金額|請求金額|請求合計)[:：¥]?((?:\d{1,3}(?:,\d{3})+|\d+))(?:円|$)/);
    if (explicit) total_amount = yen(explicit[1]);
    if (!total_amount && /前回御請求額.*消費税額.*当月御請求/.test(normalized)) {
      summary = summaryValues(lines[i + 1] || "") ?? summary;
      total_amount = summary?.[5] ?? "";
    }
    if (/^請求内訳:/.test(normalized)) summary = summaryValues(normalized.slice("請求内訳:".length)) ?? summary;
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
    items.push({ item_name, amount: amount ?? "", category, subcategory: "",
      ...(amount !== null ? { quantity: String(Number(quantity)), unit: unit.slice(0, 40), unit_price: String(yen(price)) } : {}),
    });
  }
  const candidates = [...(layoutItems ?? items)];
  if (summary) {
    total_amount = summary[5];
    if (summary[2]) candidates.push({ item_name: "繰越残高", amount: summary[2], category: "未分類" });
    if (summary[4]) candidates.push({ item_name: "消費税", amount: summary[4], category: "未分類" });
  }
  return { issue_date, settlement_date, total_amount, items: candidates.slice(0, 100) };
}
