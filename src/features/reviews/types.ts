export const reviewEvaluations = ["좋은 판단, 좋은 결과", "좋은 판단, 나쁜 결과", "나쁜 판단, 좋은 결과", "나쁜 판단, 나쁜 결과"] as const;
export type Review = {
  id: string; stockId: string; stockName: string; tradeId: string | null; reviewedAt: string;
  result: string; decisionQuality: string; executionQuality: string; planCompliance: boolean;
  emotionState: string; strengths: string; mistakes: string; nextAction: string; lessons: string;
  evaluation: (typeof reviewEvaluations)[number]; resultScore: number; processScore: number;
  createdAt: string; updatedAt: string; deletedAt: string | null;
};
