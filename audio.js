/* Luke's Dose Compass — her voice.

   She asked to talk through the medications while giving them, rather than tap
   nine buttons at 4 AM. Recording works with no network; reading the recording
   back does not, reliably, on iOS. So the rule here is simple and absolute:

       THE RECORDING IS KEPT, ALWAYS. The transcript is a bonus.

   A failed transcript costs a convenience. A discarded recording costs her own
   voice describing his last weeks, which is not recoverable later.

   Audio lives in IndexedDB — the first thing in this app that genuinely needs
   it, since localStorage cannot hold a blob. Events stay in localStorage and
   reference a recording by id. */

const DB = 'luke-audio';
const STORE = 'notes';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    // A failing transaction hands back a null error more often than not, and a
    // caller reading .message off null throws inside its own catch — which is
    // how a photo once failed with no message at all. Always a real Error.
    const failed = (what) => () => reject(t.error
      || new Error(`the browser ${what} this write to its storage`));
    t.onerror = failed('refused');
    t.onabort = failed('cancelled');
  });
}

/* WEBKIT CANNOT STORE A BLOB IN INDEXEDDB. Measured here, not assumed: in
   Playwright's WebKit an ArrayBuffer and a Uint8Array store fine, while a Blob
   and a File both fail the transaction — and fail it with a null error, so
   nothing reaches the screen. Chromium stores all four.

   That is the engine closest to Safari, and this same store holds her voice
   recordings. So nothing is stored as a Blob: bytes and a MIME type go in, and
   the Blob is rebuilt on the way out. Bytes are portable everywhere.

   Anything stored before this change is still a Blob, so a read accepts both. */
export async function putAudio(id, blob) {
  const bytes = await blob.arrayBuffer();
  return tx('readwrite', (s) => s.put({ bytes, type: blob.type || '' }, id));
}

export async function getAudio(id) {
  const got = await tx('readonly', (s) => s.get(id));
  if (!got) return null;
  if (got instanceof Blob) return got;                 // stored before this change
  return new Blob([got.bytes], { type: got.type || '' });
}

export const allAudioIds = () => tx('readonly', (s) => s.getAllKeys());

/* Safari's supported formats vary by version, so ask rather than assume. */
export function pickMimeType() {
  const wanted = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const type of wanted) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* keep looking */ }
  }
  return '';   // let the browser choose
}

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined'
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/* One recorder at a time. Returns a handle with stop(), which resolves to the
   blob and whatever transcript we managed to get alongside it. */
export async function startRecording() {
  if (!recordingSupported()) throw new Error('this browser cannot record');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    // Permission denied, or no microphone. The buttons still work; say so.
    throw new Error(err && err.name === 'NotAllowedError'
      ? 'the microphone is blocked for this site — the buttons below still work'
      : 'no microphone available — the buttons below still work');
  }

  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();

  const startedAt = Date.now();
  const speech = startSpeech();

  return {
    startedAt,
    stop: () => new Promise((resolve) => {
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const transcript = await speech.stop();
        // Even a zero-length recording resolves: the screen must never claim
        // a note was saved when nothing was captured, and it decides that by
        // looking at the blob rather than by assuming.
        resolve({
          blob: new Blob(chunks, { type: mimeType || 'audio/mp4' }),
          transcript,
          ms: Date.now() - startedAt,
        });
      };
      try { rec.stop(); } catch { resolve({ blob: null, transcript: null, ms: Date.now() - startedAt }); }
    }),
  };
}

/* Speech recognition is a bonus and is treated as one. iOS has documented
   trouble with it — the microphone not releasing, continuous mode failing,
   silent fallback to Apple's servers when there is no signal. So every path
   here resolves rather than rejects, and a null transcript is normal. */
function startSpeech() {
  const Ctor = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!Ctor) return { stop: async () => null };

  let text = '';
  let rec;
  try {
    rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript + ' ';
      }
    };
    rec.onerror = () => { /* a failed transcript is not a failed note */ };
    rec.start();
  } catch {
    return { stop: async () => null };
  }

  return {
    stop: async () => {
      try { rec.stop(); } catch { /* already stopped */ }
      await new Promise((r) => setTimeout(r, 250));   // let a final result land
      const trimmed = text.trim();
      return trimmed || null;
    },
  };
}

/* The same store holds photographs. A picture of how he was standing, or of a
   lump, is the kind of thing a vet can act on and words cannot carry — and it
   is also the kind of thing she will want later. Same rules as a recording:
   kept, never pruned, and referenced from the log by id. */
export const putMedia = putAudio;
export const getMedia = getAudio;

/* Photographs from a phone are large. Stored full size this would fill a
   device inside a month, so they are scaled down to something a vet can still
   read. The original is not kept: she has it in her own camera roll. */
export async function shrinkImage(file, maxEdge = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return { blob, width: w, height: h };
}
