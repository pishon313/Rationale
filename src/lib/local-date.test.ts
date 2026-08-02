import { describe, expect, it } from "vitest";
import { localDateTimeValue, localDateValue, localMonthValue } from "./local-date";

describe("local date inputs", () => {
  it("uses local calendar fields instead of UTC fields", () => {
    const value = new Date(2026, 7, 2, 3, 4, 5);
    expect(localDateValue(value)).toBe("2026-08-02");
    expect(localDateTimeValue(value)).toBe("2026-08-02T03:04");
    expect(localMonthValue(value)).toBe("2026-08");
  });
});
