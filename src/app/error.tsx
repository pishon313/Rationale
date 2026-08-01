"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><h1 className="text-xl font-semibold">화면을 불러오지 못했습니다</h1><p className="mt-2 text-sm text-[var(--muted)]">잠시 후 다시 시도해 주세요.</p><button className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-white" onClick={reset}>다시 시도</button></div></main>;
}
