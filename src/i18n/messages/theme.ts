import type { MessageCatalog } from "../types";

const entries = [
  ["외관", "外観", "Appearance", "Apparence", "Aspetto", "Apariencia"],
  ["색상 테마", "カラーテーマ", "Color theme", "Thème de couleur", "Tema colore", "Tema de color"],
  ["민트", "ミント", "Mint", "Menthe", "Menta", "Menta"],
  ["차분하고 집중된", "穏やかで集中しやすい", "Calm and focused", "Calme et concentré", "Calmo e concentrato", "Sereno y enfocado"],
  ["로즈 퍼플", "ローズパープル", "Rose Purple", "Rose violet", "Rosa porpora", "Rosa púrpura"],
  ["따뜻하고 현대적인", "温かくモダン", "Warm and modern", "Chaleureux et moderne", "Caldo e moderno", "Cálido y moderno"],
  ["미드나이트", "ミッドナイト", "Midnight", "Minuit", "Mezzanotte", "Medianoche"],
  ["차갑고 정밀한", "クールで精密", "Cool and precise", "Frais et précis", "Freddo e preciso", "Frío y preciso"],
  ["Sierra Blue", "Sierra Blue", "Sierra Blue", "Sierra Blue", "Sierra Blue", "Sierra Blue"],
  ["차분하고 맑은 블루", "穏やかで澄んだブルー", "Calm and clear blue", "Bleu calme et limpide", "Blu calmo e limpido", "Azul sereno y claro"],
  ["레몬", "レモン", "Lemon", "Citron", "Limone", "Limón"],
  ["밝고 낙관적인", "明るく楽観的", "Bright and optimistic", "Lumineux et optimiste", "Luminoso e ottimista", "Luminoso y optimista"],
  ["Deep Black", "Deep Black", "Deep Black", "Deep Black", "Deep Black", "Deep Black"],
  ["절제되고 깊은 모노크롬", "深みのある洗練されたモノクローム", "Deep and refined monochrome", "Monochrome profond et raffiné", "Monocromia profonda e raffinata", "Monocromo profundo y refinado"],
  ["현재 테마", "現在のテーマ", "Current theme", "Thème actuel", "Tema attuale", "Tema actual"],
] as const;

export const themeMessages: MessageCatalog = {
  ja: Object.fromEntries(entries.map(([ko, ja]) => [ko, ja])),
  en: Object.fromEntries(entries.map(([ko, , en]) => [ko, en])),
  fr: Object.fromEntries(entries.map(([ko, , , fr]) => [ko, fr])),
  it: Object.fromEntries(entries.map(([ko, , , , it]) => [ko, it])),
  es: Object.fromEntries(entries.map(([ko, , , , , es]) => [ko, es])),
};
