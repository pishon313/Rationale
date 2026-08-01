export type Observation = {
  id: string; stockId: string; stockName: string; observedAt: string; title: string; content: string;
  marketCondition: string; stockView: "강세" | "중립" | "약세" | "판단 보류"; tags: string[];
  attachmentUrls: string[]; createdAt: string; updatedAt: string; deletedAt: string | null;
};
