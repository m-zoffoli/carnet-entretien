// Lecture du texte d'une photo (tableau de bord, facture), entièrement sur le téléphone.
// Le moteur (7 Mo, hébergé avec l'app) n'est chargé qu'à la première photo.

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const MAX_SIDE = 2000;

let engine = null;

function loadEngine() {
  engine ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}tesseract.min.js`;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { engine = null; reject(new Error('Moteur de lecture indisponible.')); };
    document.head.append(script);
  });
  return engine;
}

/** Niveaux de gris à contraste maximal, en texte sombre sur fond clair comme l'attend le moteur. */
async function prepare(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

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

export async function readPhotoText(file) {
  const Tesseract = await loadEngine();
  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${BASE}worker.min.js`,
    corePath: `${BASE}tesseract-core-simd-lstm.wasm.js`,
    langPath: BASE.replace(/\/$/, ''),
    workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(await prepare(file));
    return data.text;
  } finally {
    await worker.terminate();
  }
}
