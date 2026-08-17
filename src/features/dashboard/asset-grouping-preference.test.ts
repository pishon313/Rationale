// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_GROUPING_EVENT,
  ASSET_GROUPING_KEY,
  DEFAULT_ASSET_GROUPING,
  getAssetGroupingServerSnapshot,
  getAssetGroupingSnapshot,
  setAssetGrouping,
  subscribeAssetGrouping,
} from "./asset-grouping-preference";

afterEach(() => window.localStorage.clear());

describe("dashboard asset-grouping preference", () => {
  it("저장값이 없거나 유효하지 않으면 내 분류 보기를 기본값으로 사용한다", () => {
    expect(DEFAULT_ASSET_GROUPING).toBe("portfolio-category");
    expect(getAssetGroupingSnapshot()).toBe("portfolio-category");
    window.localStorage.setItem(ASSET_GROUPING_KEY, "tags");
    expect(getAssetGroupingSnapshot()).toBe("portfolio-category");
    expect(getAssetGroupingServerSnapshot()).toBe("portfolio-category");
  });

  it("유효한 저장값을 읽고 설정 시 같은 문서 소비자에게 이벤트를 보낸다", () => {
    window.localStorage.setItem(ASSET_GROUPING_KEY, "market-sector");
    expect(getAssetGroupingSnapshot()).toBe("market-sector");
    const callback = vi.fn();
    const unsubscribe = subscribeAssetGrouping(callback);
    setAssetGrouping("portfolio-category");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(ASSET_GROUPING_KEY)).toBe("portfolio-category");
    unsubscribe();
    window.dispatchEvent(new Event(ASSET_GROUPING_EVENT));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("다른 탭의 관련 storage 이벤트만 구독한다", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeAssetGrouping(callback);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    window.dispatchEvent(new StorageEvent("storage", { key: ASSET_GROUPING_KEY, newValue: "market-sector" }));
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
