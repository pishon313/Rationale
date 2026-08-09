"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, type SortingState, useReactTable, type VisibilityState } from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/i18n-provider";
import { stockStatuses, type Stock, type StockComputed, withComputed } from "./types";
import type { StockAccountHolding } from "./stock-account-holdings";

type Props = { stocks: Stock[]; accountHoldingsByStockId: Map<string, StockAccountHolding[]>; onEdit: (stock: Stock) => void; onDelete: (stock: Stock) => void };

export function StockTable({ stocks, accountHoldingsByStockId, onEdit, onDelete }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [status, setStatus] = useState("전체");
  const [visibility, setVisibility] = useState<VisibilityState>({ sector: true, investmentType: true });
  const [columnMenu, setColumnMenu] = useState(false);
  const data = useMemo(() => stocks.map(withComputed).filter((s) => status === "전체" || s.status === status), [stocks, status]);

  const columns = useMemo<ColumnDef<StockComputed>[]>(() => {
    const money = (value: number, currency: Stock["currency"]) => formatNumber(value, {
      style: "currency",
      currency,
      minimumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
      maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
    });
    const date = (value: string | null) => value
      ? formatDate(`${value.slice(0, 10)}T00:00:00`, { year: "numeric", month: "short", day: "numeric" })
      : "—";
    return [
      { accessorKey: "name", header: t("종목"), cell: ({ row }) => <Link href={`/stocks/detail?id=${row.original.id}`} className="block min-w-36"><span className="font-medium hover:text-[var(--accent)]">{row.original.name}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{row.original.ticker} · {t(row.original.market)}</span></Link> },
      { accessorKey: "status", header: t("상태"), cell: ({ getValue }) => <span className="whitespace-nowrap rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">{t(getValue<string>())}</span> },
      { id: "accountHoldings", accessorFn: (stock) => stockHoldingAccountSortKey(accountHoldingsByStockId.get(stock.id) ?? []), header: t("보유 계좌"), cell: ({ row }) => {
        const names = stockHoldingAccountNames(accountHoldingsByStockId.get(row.original.id) ?? []);
        const fullNames = names.join(" · ");
        return <span title={fullNames || undefined} aria-label={names.length ? t("보유 계좌: {accounts}", { accounts: fullNames }) : t("현재 보유 계좌가 없습니다.")} className="block max-w-40 truncate">{formatStockAccountSummary(names, t)}</span>;
      } },
      { accessorKey: "currentPrice", header: t("현재가"), cell: ({ row }) => <div className="text-right"><Numeric>{money(row.original.currentPrice, row.original.currency)}</Numeric><small className="block text-[10px] text-[var(--muted)]">{t(row.original.priceStatus === "online" ? "자동 갱신" : row.original.priceStatus === "offline" ? "오프라인·저장 가격" : "수동 입력")}</small></div> },
      { accessorKey: "averagePrice", header: t("평균단가"), cell: ({ row }) => <Numeric>{row.original.quantity ? money(row.original.averagePrice, row.original.currency) : "—"}</Numeric> },
      { accessorKey: "quantity", header: t("수량"), cell: ({ getValue }) => <Numeric>{formatNumber(getValue<number>(), { maximumFractionDigits: 8 })}</Numeric> },
      { accessorKey: "marketValue", header: t("평가금액"), cell: ({ row }) => <Numeric strong>{money(row.original.marketValue, row.original.currency)}</Numeric> },
      { accessorKey: "unrealizedProfit", header: t("미실현손익"), cell: ({ row }) => <Numeric><span className={row.original.unrealizedProfit > 0 ? "text-emerald-600" : row.original.unrealizedProfit < 0 ? "text-red-600" : ""}>{row.original.unrealizedProfit > 0 ? "+" : ""}{money(row.original.unrealizedProfit, row.original.currency)}<small className="ml-1">({row.original.unrealizedProfitRate == null ? "—" : formatNumber(row.original.unrealizedProfitRate / 100, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1, minimumFractionDigits: 1 })})</small></span></Numeric> },
      { accessorKey: "sector", header: t("섹터") },
      { accessorKey: "investmentType", header: t("투자 유형"), cell: ({ getValue }) => t(getValue<string>()) },
      { accessorKey: "nextReviewDate", header: t("다음 검토"), cell: ({ getValue }) => date(getValue<string | null>()) },
      { id: "actions", enableSorting: false, header: "", cell: ({ row }) => <div className="flex justify-end gap-1"><Link aria-label={t("{name} 상세", { name: row.original.name })} href={`/stocks/detail?id=${row.original.id}`} className="grid size-8 place-items-center rounded-md hover:bg-[var(--surface-muted)]"><Eye size={15} /></Link><button aria-label={t("{name} 수정", { name: row.original.name })} onClick={() => onEdit(row.original)} className="grid size-8 place-items-center rounded-md hover:bg-[var(--surface-muted)]"><Pencil size={15} /></button><button aria-label={t("{name} 삭제", { name: row.original.name })} onClick={() => onDelete(row.original)} className="grid size-8 place-items-center rounded-md text-red-600 hover:bg-red-50"><Trash2 size={15} /></button></div> },
    ];
  }, [accountHoldingsByStockId, formatDate, formatNumber, onDelete, onEdit, t]);

  const table = useReactTable({ data, columns, state: { sorting, globalFilter, columnVisibility: visibility }, globalFilterFn: (row, _columnId, value) => stockMatchesSearch(row.original, String(value)), onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setVisibility, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel() });

  return <><div className="flex flex-wrap gap-2 border-b p-3"><input aria-label={t("종목 검색")} value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="h-9 min-w-56 flex-1 rounded-lg border bg-[var(--surface)] px-3 text-sm" placeholder={t("종목명, 티커, 시장 검색")} /><select aria-label={t("상태 필터")} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm"><option value="전체">{t("전체")}</option>{stockStatuses.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select><div className="relative"><button onClick={() => setColumnMenu((v) => !v)} className="flex h-9 items-center gap-2 rounded-lg border px-3 text-sm"><MoreHorizontal size={16} />{t("열 설정")}<ChevronDown size={14} /></button>{columnMenu && <div className="absolute right-0 top-11 z-20 w-44 rounded-lg border bg-[var(--surface)] p-2 shadow-xl">{table.getAllLeafColumns().filter((column) => column.getCanHide()).map((column) => <label key={column.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-muted)]"><input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />{String(column.columnDef.header)}</label>)}</div>}</div></div><div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{table.getHeaderGroups()[0]?.headers.map((header) => <th key={header.id} className="whitespace-nowrap border-b px-4 py-3 font-medium"><button disabled={!header.column.getCanSort()} onClick={header.column.getToggleSortingHandler()} className="flex items-center gap-1">{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getCanSort() && <ChevronsUpDown size={13} />}</button></th>)}</tr></thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="border-b last:border-0 hover:bg-[var(--surface-muted)]">{row.getVisibleCells().map((cell) => <td key={cell.id} className="whitespace-nowrap px-4 py-3.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>{table.getRowModel().rows.length === 0 && <div className="grid h-52 place-items-center text-center"><div><p className="font-medium">{t("조건에 맞는 종목이 없습니다")}</p><p className="mt-1 text-sm text-[var(--muted)]">{t("검색어나 필터를 변경해 보세요.")}</p></div></div>}</div><div className="border-t px-4 py-3 text-xs text-[var(--muted)]">{t("총 {count}개 종목 · 열 제목을 눌러 정렬", { count: formatNumber(table.getRowModel().rows.length) })}</div></>;
}

export function formatStockAccountSummary(names: string[], t: ReturnType<typeof useI18n>["t"]) {
  if (names.length === 0) return "—";
  if (names.length === 1) return names[0];
  return t("{name} 외 {count}", { name: names[0], count: names.length - 1 });
}

export function stockHoldingAccountNames(holdings: StockAccountHolding[]) {
  const names = new Map<string, string>();
  for (const holding of holdings) if (!names.has(holding.accountId)) names.set(holding.accountId, holding.accountName);
  return [...names.values()];
}

export function stockHoldingAccountSortKey(holdings: StockAccountHolding[]) {
  return stockHoldingAccountNames(holdings).join("\u0000");
}

export function stockMatchesSearch(stock: Stock, search: string) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  return [stock.name, stock.ticker, stock.market, stock.sector, stock.investmentType, stock.status]
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function Numeric({ children, strong }: { children: React.ReactNode; strong?: boolean }) { return <span className={`block text-right tabular-nums ${strong ? "font-medium" : ""}`}>{children}</span>; }
