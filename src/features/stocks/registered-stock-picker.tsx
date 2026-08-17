"use client";

import { ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { searchRegisteredStocks } from "./stock-search";
import type { Stock } from "./types";

export type RegisteredStockPickerProps = {
  stocks: readonly Stock[];
  value: string | null;
  onChange: (stockId: string | null) => void;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  includeDeletedSelected?: boolean;
  includeDeletedIds?: readonly string[];
  noResultsAction?: React.ReactNode;
  missingValueLabel?: string;
  className?: string;
};

const emptyOptionKey = "empty";

export function RegisteredStockPicker({
  stocks,
  value,
  onChange,
  label,
  ariaLabel,
  placeholder,
  allowEmpty = false,
  emptyLabel,
  required = false,
  disabled = false,
  includeDeletedSelected = false,
  includeDeletedIds = [],
  noResultsAction,
  missingValueLabel,
  className = "",
}: RegisteredStockPickerProps) {
  const { t } = useI18n();
  const generatedId = useId().replaceAll(":", "");
  const inputId = `registered-stock-picker-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const searchPlaceholder = placeholder ?? t("종목명 또는 티커 검색");
  const directInputLabel = emptyLabel ?? t("종목에 연결하지 않고 직접 입력");
  const selectedStock = stocks.find((stock) => stock.id === value);
  const results = useMemo(() => searchRegisteredStocks(stocks, query, {
    selectedStockId: value,
    includeDeletedSelected,
    includeDeletedIds,
  }), [includeDeletedIds, includeDeletedSelected, query, stocks, value]);
  const options = [
    ...(allowEmpty ? [{ key: emptyOptionKey, stock: null }] : []),
    ...results.map((stock) => ({ key: `stock:${stock.id}`, stock })),
  ];
  const optionKeys = options.map((option) => option.key);
  const activeKey = highlightedKey && optionKeys.includes(highlightedKey) ? highlightedKey : optionKeys[0] ?? null;
  const activeIndex = activeKey ? optionKeys.indexOf(activeKey) : -1;
  const selectedDisplay = selectedStock
    ? stockDisplay(selectedStock, t("삭제됨"))
    : value ? missingValueLabel ?? "" : allowEmpty ? directInputLabel : "";

  function initialActiveKey(nextResults = results) {
    if (value && nextResults.some((stock) => stock.id === value)) return `stock:${value}`;
    if (!value && allowEmpty) return emptyOptionKey;
    return nextResults[0] ? `stock:${nextResults[0].id}` : allowEmpty ? emptyOptionKey : null;
  }

  function openPicker() {
    if (disabled) return;
    setQuery("");
    setHighlightedKey(initialActiveKey());
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    setQuery("");
    setHighlightedKey(null);
  }

  function selectKey(key: string) {
    if (key === emptyOptionKey) onChange(null);
    else onChange(key.slice("stock:".length));
    closePicker();
  }

  function moveHighlight(direction: 1 | -1) {
    if (!open) {
      openPicker();
      return;
    }
    if (!optionKeys.length) return;
    const currentIndex = activeIndex < 0 ? 0 : activeIndex;
    const nextIndex = (currentIndex + direction + optionKeys.length) % optionKeys.length;
    setHighlightedKey(optionKeys[nextIndex]);
  }

  return <div
    className={`relative ${className}`}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closePicker();
    }}
  >
    {label && <label htmlFor={inputId} className="block text-sm font-medium">{label}</label>}
    <div className={`${label ? "mt-1" : ""} relative`}>
      <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
      <input
        id={inputId}
        role="combobox"
        type="text"
        value={open ? query : selectedDisplay}
        placeholder={searchPlaceholder}
        disabled={disabled}
        aria-label={ariaLabel ?? (label ? undefined : searchPlaceholder)}
        aria-required={required}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        autoComplete="off"
        className="h-10 w-full rounded-lg border bg-[var(--surface)] pl-9 pr-10 text-sm disabled:cursor-not-allowed disabled:opacity-70"
        onFocus={openPicker}
        onClick={() => { if (!open) openPicker(); }}
        onChange={(event) => {
          const nextQuery = event.target.value;
          const nextResults = searchRegisteredStocks(stocks, nextQuery, {
            selectedStockId: value,
            includeDeletedSelected,
            includeDeletedIds,
          });
          setQuery(nextQuery);
          setOpen(true);
          setHighlightedKey(nextResults[0] ? `stock:${nextResults[0].id}` : allowEmpty ? emptyOptionKey : null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); moveHighlight(1); }
          else if (event.key === "ArrowUp") { event.preventDefault(); moveHighlight(-1); }
          else if (event.key === "Enter" && open && activeKey) { event.preventDefault(); selectKey(activeKey); }
          else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); closePicker(); }
          else if (event.key === "Tab") closePicker();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={t("종목 목록 열기")}
        className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-[var(--muted)] disabled:opacity-50"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => open ? closePicker() : openPicker()}
      >
        <ChevronDown aria-hidden="true" size={17} />
      </button>
    </div>
    {open && <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-[var(--surface)] shadow-xl">
      <div id={listboxId} role="listbox" aria-label={ariaLabel ?? label ?? searchPlaceholder} className="max-h-72 overflow-y-auto p-1">
        {options.map((option, index) => {
          const selected = option.stock ? option.stock.id === value : value === null;
          const optionLabel = option.stock ? stockDisplay(option.stock, t("삭제됨")) : directInputLabel;
          return <button
            key={option.key}
            id={`${listboxId}-option-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-label={optionLabel}
            aria-selected={selected}
            className={`block w-full rounded-md px-3 py-2 text-left text-sm ${activeKey === option.key ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "hover:bg-[var(--surface-muted)]"}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlightedKey(option.key)}
            onClick={() => selectKey(option.key)}
          >
            {option.stock ? <><span className="font-medium">{option.stock.ticker}</span><span className="ml-3">{option.stock.name}</span>{option.stock.deletedAt && <span className="ml-2 text-xs text-[var(--muted)]">· {t("삭제됨")}</span>}<span className="mt-0.5 block text-xs text-[var(--muted)]">{t(option.stock.market)} · {option.stock.currency}</span></> : optionLabel}
          </button>;
        })}
        {results.length === 0 && <div className="px-3 py-3 text-sm text-[var(--muted)]">
          <p>{t("등록된 종목에서 찾을 수 없습니다.")}</p>
          {noResultsAction && <div className="mt-1">{noResultsAction}</div>}
        </div>}
      </div>
    </div>}
  </div>;
}

function stockDisplay(stock: Stock, deletedLabel: string) {
  return `${stock.ticker} · ${stock.name}${stock.deletedAt ? ` · ${deletedLabel}` : ""}`;
}
