import type { Locale, MessageCatalog } from "../types";
import { appMessages } from "./app";
import { commonMessages } from "./common";
import { journalMessages } from "./journal";
import { stockMessages } from "./stocks";
import { tradeMessages } from "./trades";

const catalogs: MessageCatalog[] = [commonMessages, appMessages, stockMessages, tradeMessages, journalMessages];

export function translate(locale: Locale, key: string) {
  if (locale === "ko") return key;
  for (const catalog of catalogs) {
    const message = catalog[locale][key];
    if (message) return message;
  }
  return key;
}
