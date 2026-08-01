import type { Observation } from "./types";
export const sampleObservations: Observation[] = [
  { id: "o1", stockId: "micron", stockName: "Micron Technology", observedAt: "2026-07-29T23:20", title: "전고점 돌파 여부 확인", content: "장 초반 거래량은 증가했지만 종가까지 유지되는지 확인한다. 급등 시 추격하지 않는다.", marketCondition: "나스닥 상승", stockView: "강세", tags: ["거래량", "돌파"], attachmentUrls: [], createdAt: "2026-07-29T14:20:00Z", updatedAt: "2026-07-29T14:20:00Z", deletedAt: null },
  { id: "o2", stockId: "tesla", stockName: "Tesla", observedAt: "2026-07-28T23:50", title: "거래량 부족으로 추격 매수 보류", content: "갭 상승했지만 거래량이 평균보다 낮다. 20일선 지지 여부를 더 관찰한다.", marketCondition: "혼조", stockView: "판단 보류", tags: ["보류", "갭상승"], attachmentUrls: [], createdAt: "2026-07-28T14:50:00Z", updatedAt: "2026-07-28T14:50:00Z", deletedAt: null },
  { id: "o3", stockId: "samsung", stockName: "삼성전자", observedAt: "2026-07-26T10:30", title: "실적 발표 전 신규 매수 보류", content: "HBM 관련 가이던스 확인 전에는 기존 비중만 유지한다.", marketCondition: "코스피 보합", stockView: "중립", tags: ["실적"], attachmentUrls: [], createdAt: "2026-07-26T01:30:00Z", updatedAt: "2026-07-26T01:30:00Z", deletedAt: null },
];
