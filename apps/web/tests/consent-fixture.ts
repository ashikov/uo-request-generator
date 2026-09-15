import { randomUUID } from "node:crypto";
import { vi } from "vitest";

export const acceptedConsent = {
  consentAccepted: true,
  consentVersion: "c1-2026-09-15-r1",
} as const;

// Изолированный dependency для прежних route tests; production fallback отсутствует.
export function createTestConsentLedger() {
  return {
    accept: vi.fn((requestId: string, consentVersion: string) => ({
      consentReceiptId: randomUUID(),
      requestId,
      consentVersion,
      serverTimestamp: "2026-09-15T00:00:00.000Z",
      status: "accepted" as const,
    })),
  };
}
