import type { Locale, MessageCatalog } from "../types";
import { appMessages } from "./app";
import { commonMessages } from "./common";
import { journalMessages } from "./journal";
import { securityMessages } from "./security";
import { stockMessages } from "./stocks";
import { tradeMessages } from "./trades";
import { redesignMessages } from "./redesign";
import { dashboardMessages } from "./dashboard";
import { accountMessages } from "./accounts";
import { stockAccountMessages } from "./stock-accounts";
import { sampleDataMessages, sampleEscapedMessages } from "./sample-data";
import { systemLanguageMessages } from "./system-language";
import { marketObservationMessages } from "./market-observations";
import { importMessages } from "./import";
import { portfolioClassificationMessages } from "./portfolio-classification";
import { accountFeeMessages } from "./account-fees";

const catalogs: MessageCatalog[] = [accountFeeMessages, portfolioClassificationMessages, importMessages, marketObservationMessages, systemLanguageMessages, sampleEscapedMessages, sampleDataMessages, commonMessages, appMessages, stockMessages, stockAccountMessages, tradeMessages, journalMessages, securityMessages, redesignMessages, dashboardMessages, accountMessages];

export function translate(locale: Locale, key: string) {
  if (locale === "ko") return key;
  for (const catalog of catalogs) {
    const message = catalog[locale][key];
    if (message) return message;
  }
  return key;
}
