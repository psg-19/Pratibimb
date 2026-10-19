/** Minimal Web Speech API wrapper (Chrome/Edge/Safari): dictation in English, Hindi or Kannada. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type Ctor = new () => SpeechRecognitionLike;

export function speechSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function startDictation(lang: string, onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void) {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!C) {
    onEnd('Voice input is not supported in this browser.');
    return () => {};
  }
  const r = new C();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final = e.results[i].isFinal;
    }
    onText(text, final);
  };
  r.onerror = (e) => onEnd(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Could not hear that — try again.');
  r.onend = () => onEnd();
  try { r.start(); }
  catch { onEnd('Voice input could not start. Try typing your meal instead.'); }
  return () => { try { r.stop(); } catch { /* Already stopped. */ } };
}

/** Shrinks a photo before upload (longest side 1568 px, JPEG). */
export async function shrinkImage(file: File, max = 1568): Promise<File> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // This browser cannot decode it (e.g. HEIC, or a damaged file): send it as it is and let the server judge it.
    return file;
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 3_000_000) { bmp.close(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return blob ? new File([blob], 'meal.jpg', { type: 'image/jpeg' }) : file;
}
