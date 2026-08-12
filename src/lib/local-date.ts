export function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function localDateTimeValue(date = new Date(), includeSeconds = false) {
  return `${localDateValue(date)}T${two(date.getHours())}:${two(date.getMinutes())}${includeSeconds ? `:${two(date.getSeconds())}` : ""}`;
}

export function localMonthValue(date = new Date()) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
}

function two(value: number) {
  return String(value).padStart(2, "0");
}
