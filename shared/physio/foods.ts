/**
 * Approximate carbohydrate per typical serving for common Indian foods, plus how fast each is
 * absorbed relative to a medium meal. These are rough reference values for a prototype —
 * meal logs show them as estimates the patient can correct, never as exact figures.
 */
export interface FoodRef {
  id: string;
  name: string;
  /** Other names (English, Hindi, Kannada transliterations) used by the offline parser. */
  aliases: string[];
  serving: string;
  carbs: number;
  /** Relative absorption speed (1 = medium; refined grains > 1, millets and pulses < 1). */
  speed: number;
}

export const FOODS: readonly FoodRef[] = [
  { id: 'rice', name: 'White rice', aliases: ['rice', 'chawal', 'anna', 'annam', 'saadam'], serving: '1 cup cooked', carbs: 45, speed: 1.35 },
  { id: 'brown-rice', name: 'Brown rice', aliases: ['brown rice'], serving: '1 cup cooked', carbs: 42, speed: 1.05 },
  { id: 'chapati', name: 'Chapati', aliases: ['chapati', 'chapathi', 'roti', 'phulka', 'rotti'], serving: '1 medium', carbs: 15, speed: 1.0 },
  { id: 'paratha', name: 'Paratha', aliases: ['paratha', 'parotta', 'porotta'], serving: '1 medium', carbs: 30, speed: 0.95 },
  { id: 'idli', name: 'Idli', aliases: ['idli', 'idly'], serving: '1 piece', carbs: 15, speed: 1.3 },
  { id: 'dosa', name: 'Plain dosa', aliases: ['dosa', 'dose', 'dosai'], serving: '1 medium', carbs: 30, speed: 1.25 },
  { id: 'masala-dosa', name: 'Masala dosa', aliases: ['masala dosa', 'masale dose'], serving: '1 large', carbs: 50, speed: 1.2 },
  { id: 'upma', name: 'Upma', aliases: ['upma', 'uppittu'], serving: '1 cup', carbs: 40, speed: 1.15 },
  { id: 'poha', name: 'Poha', aliases: ['poha', 'avalakki', 'aval'], serving: '1 cup', carbs: 45, speed: 1.2 },
  { id: 'sambar', name: 'Sambar', aliases: ['sambar', 'saaru', 'huli'], serving: '1 cup', carbs: 15, speed: 0.8 },
  { id: 'rasam', name: 'Rasam', aliases: ['rasam', 'saaru'], serving: '1 cup', carbs: 6, speed: 1.0 },
  { id: 'dal', name: 'Dal', aliases: ['dal', 'daal', 'bele', 'paruppu'], serving: '1 cup', carbs: 20, speed: 0.7 },
  { id: 'sabzi', name: 'Vegetable sabzi', aliases: ['sabzi', 'sabji', 'palya', 'poriyal', 'bhindi', 'curry'], serving: '1 cup', carbs: 10, speed: 0.8 },
  { id: 'curd', name: 'Curd', aliases: ['curd', 'dahi', 'mosaru', 'yogurt'], serving: '1 cup', carbs: 8, speed: 0.8 },
  { id: 'curd-rice', name: 'Curd rice', aliases: ['curd rice', 'mosaranna', 'thayir sadam'], serving: '1 cup', carbs: 40, speed: 1.1 },
  { id: 'khichdi', name: 'Foxtail-millet khichdi', aliases: ['khichdi', 'millet khichdi', 'navane'], serving: '1 cup', carbs: 40, speed: 0.85 },
  { id: 'ragi-mudde', name: 'Ragi mudde', aliases: ['ragi mudde', 'ragi ball', 'ragi'], serving: '1 ball', carbs: 45, speed: 0.95 },
  { id: 'biryani', name: 'Biryani', aliases: ['biryani', 'biriyani'], serving: '1 plate', carbs: 80, speed: 1.15 },
  { id: 'pongal', name: 'Pongal', aliases: ['pongal'], serving: '1 cup', carbs: 40, speed: 1.15 },
  { id: 'tea-sugar', name: 'Tea with sugar', aliases: ['tea', 'chai', 'chaha'], serving: '1 cup', carbs: 10, speed: 1.6 },
  { id: 'coffee-sugar', name: 'Filter coffee with sugar', aliases: ['coffee', 'kaapi', 'kapi'], serving: '1 cup', carbs: 10, speed: 1.6 },
  { id: 'biscuit', name: 'Biscuits', aliases: ['biscuit', 'biscuits', 'marie'], serving: '2 pieces', carbs: 12, speed: 1.4 },
  { id: 'banana', name: 'Banana', aliases: ['banana', 'kela', 'balehannu'], serving: '1 medium', carbs: 25, speed: 1.2 },
  { id: 'milk', name: 'Milk', aliases: ['milk', 'doodh', 'haalu'], serving: '1 glass', carbs: 12, speed: 0.9 },
  { id: 'sweets', name: 'Festival sweets', aliases: ['sweet', 'sweets', 'mithai', 'laddu', 'mysore pak', 'jalebi', 'payasam', 'kheer'], serving: '2 pieces', carbs: 45, speed: 1.5 },
  { id: 'samosa', name: 'Samosa', aliases: ['samosa'], serving: '1 piece', carbs: 25, speed: 1.1 },
  { id: 'fruit', name: 'Fruit bowl', aliases: ['fruit', 'apple', 'papaya', 'guava'], serving: '1 cup', carbs: 18, speed: 1.0 },
];

/** Weighted absorption speed for a set of items. */
export function blendSpeed(items: { carbs: number; speed: number }[]): number {
  const total = items.reduce((a, i) => a + i.carbs, 0);
  if (total <= 0) return 1;
  return items.reduce((a, i) => a + i.carbs * i.speed, 0) / total;
}

/** Find a reference food by any alias contained in the text (longest alias wins). */
export function matchFood(text: string): FoodRef | undefined {
  const t = text.toLowerCase();
  let best: { f: FoodRef; len: number } | undefined;
  for (const f of FOODS) {
    for (const a of [f.name.toLowerCase(), ...f.aliases]) {
      if (new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t) && (!best || a.length > best.len)) {
        best = { f, len: a.length };
      }
    }
  }
  return best?.f;
}
