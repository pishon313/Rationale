import type { Review } from "./types";
export const sampleReviews: Review[] = [
  { id: "r1", stockId: "micron", stockName: "Micron Technology", tradeId: "t2", reviewedAt: "2026-07-22", result: "진입 후 완만한 상승", decisionQuality: "업황과 가격 조건을 함께 확인했다.", executionQuality: "예정 수량을 지켰다.", planCompliance: true, emotionState: "평온", strengths: "분할매수 원칙 준수", mistakes: "장 시작 직후 변동성을 충분히 보지 못함", nextAction: "다음 진입은 본장 30분 후 결정", lessons: "좋은 종목과 좋은 진입은 별개다.", evaluation: "좋은 판단, 좋은 결과", resultScore: 4, processScore: 4, createdAt: "2026-07-22T00:00:00Z", updatedAt: "2026-07-22T00:00:00Z", deletedAt: null },
];
