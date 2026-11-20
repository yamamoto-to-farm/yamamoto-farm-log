const { copyFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const modules = process.argv[2] || join(__dirname, "node_modules");
const destination = process.argv[3] || join(__dirname, "..", "..", "deploy", "finance", "ocr-assets");
mkdirSync(destination, { recursive: true });

for (const [source, target] of [
  ["pdfjs-dist/build/pdf.mjs", "pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.mjs", "pdf.worker.mjs"],
  ["pdfjs-dist/LICENSE", "pdfjs-LICENSE"],
  ["tesseract.js/dist/tesseract.min.js", "tesseract.min.js"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js/LICENSE.md", "tesseract-LICENSE.md"],
  ["tesseract.js-core/LICENSE", "tesseract-core-LICENSE"],
  ["@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz", "jpn.traineddata.gz"],
  ...["", "simd-"].flatMap(variant => ["wasm.js", "wasm"].map(extension => {
    const name = `tesseract-core-${variant}lstm.${extension}`;
    return [`tesseract.js-core/${name}`, name];
  })),
]) copyFileSync(join(modules, source), join(destination, target));
