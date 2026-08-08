import type { Locale, MessageCatalog } from "../types";
import { appMessages } from "./app";
import { commonMessages } from "./common";
import { journalMessages } from "./journal";
import { securityMessages } from "./security";
import { stockMessages } from "./stocks";
import { tradeMessages } from "./trades";
import { redesignMessages } from "./redesign";
import { dashboardMessages } from "./dashboard";

const catalogs: MessageCatalog[] = [commonMessages, appMessages, stockMessages, tradeMessages, journalMessages, securityMessages, redesignMessages, dashboardMessages];

export function translate(locale: Locale, key: string) {
  if (locale === "ko") return key;
  for (const catalog of catalogs) {
    const message = catalog[locale][key];
    if (message) return message;
  }
  return key;
}
