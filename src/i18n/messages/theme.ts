import type { MessageCatalog } from "../types";

const entries = [
  ["외관", "外観", "Appearance", "Apparence", "Aspetto", "Apariencia"],
  ["색상 테마", "カラーテーマ", "Color theme", "Thème de couleur", "Tema colore", "Tema de color"],
  ["민트", "ミント", "Mint", "Menthe", "Menta", "Menta"],
  ["차분하고 집중된", "穏やかで集中しやすい", "Calm and focused", "Calme et concentré", "Calmo e concentrato", "Sereno y enfocado"],
  ["로즈 퍼플", "ローズパープル", "Rose Purple", "Rose violet", "Rosa porpora", "Rosa púrpura"],
  ["따뜻하고 현대적인", "温かくモダン", "Warm and modern", "Chaleureux et moderne", "Caldo e moderno", "Cálido y moderno"],
  ["현재 테마", "現在のテーマ", "Current theme", "Thème actuel", "Tema attuale", "Tema actual"],
] as const;

export const themeMessages: MessageCatalog = {
  ja: Object.fromEntries(entries.map(([ko, ja]) => [ko, ja])),
  en: Object.fromEntries(entries.map(([ko, , en]) => [ko, en])),
  fr: Object.fromEntries(entries.map(([ko, , , fr]) => [ko, fr])),
  it: Object.fromEntries(entries.map(([ko, , , , it]) => [ko, it])),
  es: Object.fromEntries(entries.map(([ko, , , , , es]) => [ko, es])),
};
