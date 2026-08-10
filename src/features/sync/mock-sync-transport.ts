import type { SyncEnvelopeV1, SyncTransport } from "./sync-types";
export class MockSyncTransport implements SyncTransport {
  private records = new Map<string, SyncEnvelopeV1>();
  constructor(initial: readonly SyncEnvelopeV1[] = []) { initial.forEach((item) => this.records.set(item.recordName, structuredClone(item))); }
  async fetchChanges() { return [...this.records.values()].map((item) => structuredClone(item)); }
  async sendChanges(changes: readonly SyncEnvelopeV1[]) { changes.forEach((item) => this.records.set(item.recordName, structuredClone(item))); }
}
