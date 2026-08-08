import { describe, expect, it, vi } from "vitest";
import { buildLongTermPerformance } from "@/domain/account-performance";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Trade } from "@/features/trades/types";
import { buildAccountTransfer, saveAccountTransfer } from "./account-transfer";
import type { InvestmentAccount } from "./types";

const now="2026-01-01T00:00:00.000Z";
const accounts:InvestmentAccount[]=["a","b"].map((id,index)=>({id,name:id.toUpperCase(),institution:"",kind:"brokerage",subtype:"",baseCurrency:"KRW",isDefault:index===0,archivedAt:null,memo:"",createdAt:now,updatedAt:now}));
const cash=(id:string,accountId:string,type:"입금"|"출금",amount:number,kind?:Trade["cashFlowKind"]):Trade=>({id,stockId:null,stockName:"",planId:null,tradeType:type,tradedAt:now,quantity:0,price:0,amount,currency:"KRW",exchangeRate:1,fee:0,tax:0,accountId,accountName:accountId.toUpperCase(),cashFlowKind:kind,memo:"",emotion:"평온",emotionIntensity:1,confidenceScore:3,ruleComplianceScore:5,createdAt:now,updatedAt:now,deletedAt:null});
const rates={KRW:1,USD:1400,JPY:9,EUR:1600};

describe("cash flow semantics",()=>{
 it("reconciliation changes cash but not contributions",()=>{const trades=[cash("r","a","입금",30000,"reconciliation")];const ledger=buildTradingLedger(trades,accounts);const result=buildLongTermPerformance(trades,[],ledger,rates,new Date("2027-01-01"),accounts);expect(ledger.cashBalances[0].balance).toBe(30000);expect(result.netContributionsKrw).toBe(0);expect(result.xirrPercent).toBeNull();});
 it("legacy external deposit increases cash and contributions",()=>{const trades=[cash("d","a","입금",100000)];const ledger=buildTradingLedger(trades,accounts);const result=buildLongTermPerformance(trades,[],ledger,rates,new Date("2027-01-01"),accounts);expect(result.cashKrw).toBe(100000);expect(result.netContributionsKrw).toBe(100000);});
 it("transfer preserves portfolio cash and aggregate contributions but affects each account",()=>{const opening=cash("d","a","입금",100000,"external");const pair=buildAccountTransfer(accounts,{sourceAccountId:"a",targetAccountId:"b",amount:40000,currency:"KRW",tradedAt:now,memo:""},now,"t");const trades=[opening,...pair];const ledger=buildTradingLedger(trades,accounts);const result=buildLongTermPerformance(trades,[],ledger,rates,new Date("2027-01-01"),accounts);expect(result.cashKrw).toBe(100000);expect(result.netContributionsKrw).toBe(100000);expect(result.accounts.find(a=>a.accountId==="a")?.netContributionsKrw).toBe(60000);expect(result.accounts.find(a=>a.accountId==="b")?.netContributionsKrw).toBe(40000);});
 it("rejects invalid transfers and writes the pair in one collection save",async()=>{expect(()=>buildAccountTransfer(accounts,{sourceAccountId:"a",targetAccountId:"a",amount:1,currency:"KRW",tradedAt:now,memo:""})).toThrow();const save=vi.fn().mockRejectedValue(new Error("disk"));const existing=[cash("d","a","입금",1)];await expect(saveAccountTransfer(existing,accounts,{sourceAccountId:"a",targetAccountId:"b",amount:1,currency:"KRW",tradedAt:now,memo:""},save)).rejects.toThrow("disk");expect(save).toHaveBeenCalledTimes(1);expect(existing).toHaveLength(1);});
});
