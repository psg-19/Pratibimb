/**
 * Deterministic fallbacks used when no Gemini key is configured or Gemini is busy (free-tier
 * rate limits), so the app keeps working: a food-table meal parser, message templates in
 * English, Hindi and Kannada, and template explanations built only from the twin's own numbers.
 */
import type { Lang, MealEstimate, MealItem } from '../../shared/api';
import { blendSpeed, FOODS, matchFood, type FoodRef } from '../../shared/physio/foods';

/** Native-script names for common foods (the food table's aliases are romanised). */
const SCRIPT_ALIASES: Record<string, string> = {
  चावल: 'rice', भात: 'rice', रोटी: 'chapati', चपाती: 'chapati', दाल: 'dal', सब्ज़ी: 'sabzi', सब्जी: 'sabzi', इडली: 'idli', डोसा: 'dosa',
  पोहा: 'poha', उपमा: 'upma', दही: 'curd', चाय: 'tea', बिस्कुट: 'biscuit', केला: 'banana', दूध: 'milk', मिठाई: 'sweets', खिचड़ी: 'khichdi', सांबर: 'sambar',
  ಅನ್ನ: 'rice', ಚಪಾತಿ: 'chapati', ರೊಟ್ಟಿ: 'chapati', ಬೇಳೆ: 'dal', ಪಲ್ಯ: 'sabzi', ಇಡ್ಲಿ: 'idli', ದೋಸೆ: 'dosa', ಉಪ್ಪಿಟ್ಟು: 'upma', ಅವಲಕ್ಕಿ: 'poha',
  ಮೊಸರು: 'curd', ಮೊಸರನ್ನ: 'curd rice', ಸಾರು: 'rasam', ಸಾಂಬಾರ್: 'sambar', ಚಹಾ: 'tea', ಕಾಫಿ: 'coffee', ಬಿಸ್ಕತ್ತು: 'biscuit', ಬಾಳೆಹಣ್ಣು: 'banana',
  ಹಾಲು: 'milk', ಸಿಹಿ: 'sweets', ರಾಗಿ: 'ragi mudde', ಮುದ್ದೆ: 'ragi mudde',
};
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, half: 0.5, a: 1, an: 1,
  ek: 1, do: 2, teen: 3, char: 4, aadha: 0.5, एक: 1, दो: 2, तीन: 3, चार: 4, आधा: 0.5,
  ondu: 1, eradu: 2, mooru: 3, nalku: 4, ardha: 0.5, ಒಂದು: 1, ಎರಡು: 2, ಮೂರು: 3, ನಾಲ್ಕು: 4, ಅರ್ಧ: 0.5,
};

export function parseMealOffline(text: string): MealEstimate {
  let normalised = text;
  for (const [script, latin] of Object.entries(SCRIPT_ALIASES)) normalised = normalised.split(script).join(` ${latin} `);
  const chunks = normalised
    .toLowerCase()
    .split(/,|;|\+|&|\band\b|\bwith\b|\baur\b|\bmattu\b|और|ಮತ್ತು/)
    .map((c) => c.trim())
    .filter(Boolean);
  const items: MealItem[] = [];
  const unknown: string[] = [];
  for (const chunk of chunks) {
    const food: FoodRef | undefined = matchFood(chunk);
    if (!food) {
      unknown.push(chunk);
      continue;
    }
    const num = /(\d+(?:\.\d+)?)/.exec(chunk);
    const word = chunk.split(/\s+/).find((w) => w in NUMBER_WORDS);
    const qty = num ? Number(num[1]) : word ? NUMBER_WORDS[word] : 1;
    const carbs = Math.round((food.carbs * qty) / 5) * 5;
    items.push({ name: food.name, quantity: `${qty} × ${food.serving}`, carbs, speed: food.speed });
  }
  const total = items.reduce((a, i) => a + i.carbs, 0);
  return {
    items,
    totalCarbs: total,
    speed: Math.round(blendSpeed(items) * 100) / 100,
    confidence: unknown.length ? 'low' : 'medium',
    notes: unknown.length
      ? `Estimated from a built-in food table. Not recognised: ${unknown.join(', ')} — adjust the total if needed.`
      : 'Estimated from a built-in food table with typical household portions.',
    by: 'offline',
  };
}

export type DraftIntent = 'snack' | 'reminder' | 'call' | 'sensor' | 'checkin' | 'ack';

const TEMPLATES: Record<DraftIntent, Record<Lang, (n: string) => string>> = {
  snack: {
    en: (n) => `${n}, your twin expects your glucose to go low tonight while you sleep. Please have a small snack before bed — a glass of milk or a banana.`,
    hi: (n) => `${n} जी, आपका ट्विन बता रहा है कि आज रात सोते समय आपका शुगर कम हो सकता है। कृपया सोने से पहले थोड़ा सा कुछ खा लें — एक गिलास दूध या एक केला।`,
    kn: (n) => `${n} ಅವರೇ, ಇಂದು ರಾತ್ರಿ ನಿದ್ದೆಯಲ್ಲಿ ನಿಮ್ಮ ಸಕ್ಕರೆ ಮಟ್ಟ ಕಡಿಮೆಯಾಗಬಹುದು ಎಂದು ನಿಮ್ಮ ಟ್ವಿನ್ ಹೇಳುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಮಲಗುವ ಮೊದಲು ಸ್ವಲ್ಪ ಏನಾದರೂ ತಿನ್ನಿ — ಒಂದು ಲೋಟ ಹಾಲು ಅಥವಾ ಒಂದು ಬಾಳೆಹಣ್ಣು.`,
  },
  reminder: {
    en: (n) => `${n}, a reminder to take your evening metformin tonight. Your twin sees your glucose staying high when it is missed.`,
    hi: (n) => `${n} जी, आज रात की मेटफॉर्मिन लेना याद रखें। जब यह छूट जाती है तो आपका शुगर ऊँचा रहता है।`,
    kn: (n) => `${n} ಅವರೇ, ಇಂದು ರಾತ್ರಿಯ ಮೆಟ್‌ಫಾರ್ಮಿನ್ ತೆಗೆದುಕೊಳ್ಳಲು ಮರೆಯಬೇಡಿ. ಅದು ತಪ್ಪಿದಾಗ ನಿಮ್ಮ ಸಕ್ಕರೆ ಮಟ್ಟ ಹೆಚ್ಚಾಗಿಯೇ ಇರುತ್ತದೆ.`,
  },
  call: {
    en: (n) => `${n}, we will speak on the phone tonight about your sick-day plan. Keep drinking water and check your glucose until then.`,
    hi: (n) => `${n} जी, आज रात बीमारी के दिनों की योजना पर फ़ोन पर बात करेंगे। तब तक पानी पीते रहें और शुगर जाँचते रहें।`,
    kn: (n) => `${n} ಅವರೇ, ಅನಾರೋಗ್ಯದ ದಿನಗಳ ಯೋಜನೆಯ ಬಗ್ಗೆ ಇಂದು ರಾತ್ರಿ ಫೋನ್‌ನಲ್ಲಿ ಮಾತನಾಡೋಣ. ಅಲ್ಲಿಯವರೆಗೆ ನೀರು ಕುಡಿಯುತ್ತಿರಿ ಮತ್ತು ಸಕ್ಕರೆ ಮಟ್ಟ ಪರೀಕ್ಷಿಸುತ್ತಿರಿ.`,
  },
  sensor: {
    en: (n) => `${n}, your CGM sensor expires soon. Please change it before bed so your twin can keep watching overnight.`,
    hi: (n) => `${n} जी, आपका CGM सेंसर जल्द ही खत्म होने वाला है। कृपया सोने से पहले इसे बदल लें ताकि आपका ट्विन रात भर नज़र रख सके।`,
    kn: (n) => `${n} ಅವರೇ, ನಿಮ್ಮ CGM ಸೆನ್ಸರ್ ಶೀಘ್ರದಲ್ಲೇ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ. ರಾತ್ರಿಯಿಡೀ ನಿಮ್ಮ ಟ್ವಿನ್ ಗಮನಿಸಲು ದಯವಿಟ್ಟು ಮಲಗುವ ಮೊದಲು ಅದನ್ನು ಬದಲಿಸಿ.`,
  },
  checkin: {
    en: (n) => `${n}, how are you feeling tonight? Your twin expects your glucose to stay high for a while — a short walk after dinner can help.`,
    hi: (n) => `${n} जी, आज रात आप कैसा महसूस कर रहे हैं? आपके ट्विन के अनुसार शुगर कुछ समय तक ऊँचा रह सकता है — खाने के बाद थोड़ी देर टहलना मदद कर सकता है।`,
    kn: (n) => `${n} ಅವರೇ, ಇಂದು ರಾತ್ರಿ ಹೇಗಿದ್ದೀರಿ? ನಿಮ್ಮ ಟ್ವಿನ್ ಪ್ರಕಾರ ಸಕ್ಕರೆ ಮಟ್ಟ ಸ್ವಲ್ಪ ಸಮಯ ಹೆಚ್ಚಾಗಿರಬಹುದು — ಊಟದ ನಂತರ ಸ್ವಲ್ಪ ನಡಿಗೆ ಸಹಾಯ ಮಾಡಬಹುದು.`,
  },
  ack: {
    en: (n) => `${n}, your twin's forecast looks steady tonight. Keep up your usual routine.`,
    hi: (n) => `${n} जी, आज रात आपके ट्विन का अनुमान स्थिर है। अपनी रोज़ की दिनचर्या जारी रखें।`,
    kn: (n) => `${n} ಅವರೇ, ಇಂದು ರಾತ್ರಿ ನಿಮ್ಮ ಟ್ವಿನ್‌ನ ಮುನ್ಸೂಚನೆ ಸ್ಥಿರವಾಗಿದೆ. ನಿಮ್ಮ ದಿನಚರಿಯನ್ನು ಮುಂದುವರಿಸಿ.`,
  },
};

export function draftOffline(intent: DraftIntent, firstName: string, lang: Lang) {
  return { message: TEMPLATES[intent][lang](firstName), english: TEMPLATES[intent].en(firstName), by: 'offline' as const };
}

export const PLANNER_CANDIDATES = [
  { name: '2 chapati, dal, sabzi', items: '2 chapati, 1 cup dal, 1 cup vegetable sabzi', carbs: 50, speed: 0.95, why: 'Fewer refined carbs than a rice plate, with protein from the dal.' },
  { name: 'Foxtail-millet khichdi, curd', items: '1½ cups millet khichdi, ½ cup curd', carbs: 50, speed: 0.85, why: 'Millet and dal release glucose slowly.' },
  { name: 'Ragi mudde, saaru, palya', items: '1 small ragi ball, 1 cup saaru, 1 cup palya', carbs: 50, speed: 0.95, why: 'A familiar Karnataka dinner with a slower rise than white rice.' },
  { name: 'Smaller rice plate, extra dal', items: '¾ cup rice, 1½ cups dal, poriyal', carbs: 60, speed: 1.1, why: 'Keeps rice on the plate in a smaller portion.' },
  { name: 'Moong dal chilla, curd', items: '2 moong dal chilla, mint chutney, ½ cup curd', carbs: 35, speed: 0.8, why: 'Light, high in protein — pair with a bedtime snack if walking.' },
];

export { FOODS };
