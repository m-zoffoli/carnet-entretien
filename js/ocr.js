// Lecture du texte d'une photo ou d'un PDF (tableau de bord, facture), entièrement sur le téléphone.
// Les moteurs, hébergés avec l'app, ne sont chargés qu'au premier document.

const TESSERACT = new URL('../vendor/tesseract/', import.meta.url).href;
const PDFJS = new URL('../vendor/pdfjs/', import.meta.url).href;
const MAX_SIDE = 2000;
const MAX_PDF_PAGES = 3;
const MIN_PDF_TEXT = 40; // en dessous, la page est un scan : il faut la lire comme une image

let tesseract = null;

function loadTesseract() {
  tesseract ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${TESSERACT}tesseract.min.js`;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { tesseract = null; reject(new Error('Moteur de lecture indisponible.')); };
    document.head.append(script);
  });
  return tesseract;
}

/** Niveaux de gris à contraste maximal, en texte sombre sur fond clair comme l'attend le moteur. */
function enhance(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  let low = 255;
  let high = 0;
  let sum = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = grey;
    low = Math.min(low, grey);
    high = Math.max(high, grey);
    sum += grey;
  }
  const invert = sum / pixels < 128; // écran de voiture : texte clair sur fond sombre
  const range = Math.max(high - low, 1);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = ((data[i] - low) / range) * 255;
    const value = invert ? 255 - stretched : stretched;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

async function imageCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function recognize(canvases) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${TESSERACT}worker.min.js`,
    corePath: `${TESSERACT}tesseract-core-simd-lstm.wasm.js`,
    langPath: TESSERACT.replace(/\/$/, ''),
    workerBlobURL: false,
  });
  try {
    const parts = [];
    for (const canvas of canvases) {
      const { data } = await worker.recognize(enhance(canvas));
      parts.push(data.text);
    }
    return parts.join('\n');
  } finally {
    await worker.terminate();
  }
}

/** Le texte d'une page PDF, ligne par ligne : les morceaux sont regroupés par hauteur sur la page. */
function pageLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.transform[4] - b.transform[4]).map((item) => item.str.trim()).join(' '))
    .join('\n');
}

async function pageCanvas(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(base.width, base.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport, intent: 'print' }).promise;
  return canvas;
}

/** Un PDF avec du vrai texte est lu directement ; un scan passe par la reconnaissance d'image. */
async function readPdf(file) {
  const pdfjs = await import(`${PDFJS}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n += 1) pages.push(await pdf.getPage(n));
    const texts = [];
    for (const page of pages) texts.push(pageLines((await page.getTextContent()).items));
    const direct = texts.join('\n');
    if (direct.replace(/\s/g, '').length >= MIN_PDF_TEXT) return direct;
    const canvases = [];
    for (const page of pages) canvases.push(await pageCanvas(page));
    return await recognize(canvases);
  } finally {
    await task.destroy();
  }
}

export async function readPhotoText(file) {
  if (file.type === 'application/pdf') return readPdf(file);
  return recognize([await imageCanvas(file)]);
}
