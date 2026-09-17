export type SkipTraceOwnerRequest = {
  accountNum?: string;
  ownerName?: string;
  businessName?: string;
  mailingAddress?: string;
  mailingAddress2?: string;
  ownerCity?: string;
  ownerState?: string;
  ownerZip?: string;
  propertyAddress?: string;
  propertyCity?: string;
  propertyZip?: string;
};

export type SkipTraceOwnerResult = {
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  source?: string;
  confidence?: string | number;
  matchedName?: string;
  matchedAddress?: string;
  raw?: unknown;
};

const configuredEndpoint = String((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SKIP_TRACE_ENDPOINT || "").trim();

export function hasSkipTraceEndpoint(): boolean {
  return configuredEndpoint.length > 0;
}

export async function skipTracePropertyOwner(payload: SkipTraceOwnerRequest): Promise<SkipTraceOwnerResult> {
  if (!configuredEndpoint) {
    throw new Error("Skip trace endpoint is not configured. Set VITE_SKIP_TRACE_ENDPOINT to a server-side proxy URL.");
  }

  const response = await fetch(configuredEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Skip trace request failed: ${response.status}`);
  }

  const result = await response.json();
  return {
    phone: result.phone || result.primaryPhone,
    phones: Array.isArray(result.phones) ? result.phones : undefined,
    email: result.email || result.primaryEmail,
    emails: Array.isArray(result.emails) ? result.emails : undefined,
    source: result.source || result.vendor,
    confidence: result.confidence || result.matchConfidence,
    matchedName: result.matchedName,
    matchedAddress: result.matchedAddress,
    raw: result,
  };
}

