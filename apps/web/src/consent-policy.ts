export const C1_CONSENT_VERSION = "c1-2026-09-15-r1";

type ConsentEvidenceEvent =
  | { status: "accepted"; serverTimestamp: string }
  | { status: "revoked"; serverTimestamp: string; revocationTimestamp: string };

export function consentEvidenceExpiresAt(event: ConsentEvidenceEvent): string {
  return threeCalendarYearsAfter(
    event.status === "revoked" ? event.revocationTimestamp : event.serverTimestamp,
  );
}

export function threeCalendarYearsAfter(timestamp: string): string {
  const expiry = new Date(timestamp);
  const month = expiry.getUTCMonth();
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 3);
  // Для 29 февраля годовщина приходится на последний день февраля.
  if (expiry.getUTCMonth() !== month) expiry.setUTCDate(0);
  return expiry.toISOString();
}
