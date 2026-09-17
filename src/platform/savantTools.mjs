const text = (value) => String(value ?? "").trim();
const number = (value) => {
  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function validateResoListing(input = {}) {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const required = [
    ["ListingKey", "Stable listing identifier"],
    ["StandardStatus", "Standard listing status"],
    ["ListPrice", "List price"],
    ["PropertyType", "Property type"],
  ];
  const addressPresent = text(record.UnparsedAddress || record.StreetNumber || record.StreetName);
  const issues = required.filter(([field]) => !text(record[field])).map(([field, label]) => ({ field, reason: `${label} is missing` }));
  if (!addressPresent) issues.push({ field: "UnparsedAddress", reason: "A property address is missing" });
  const recognizedFields = Object.keys(record).filter((field) => text(record[field])).length;
  return {
    schemaVersion: "wr-reso-listing-validator-v1",
    valid: issues.length === 0,
    listingKey: text(record.ListingKey),
    recognizedFields,
    issues,
  };
}

export function evaluateOutreachReadiness(input = {}) {
  const phone = text(input.phone).replace(/\D/g, "");
  const channel = text(input.channel).toLowerCase() || "call";
  const blockers = [];
  if (phone.length < 10) blockers.push("A valid phone number is required");
  if (input.entitySuppressed === true) blockers.push("The contact is on the company suppression list");
  if (input.nationalDnc === true && input.existingBusinessRelationship !== true && input.writtenConsent !== true) blockers.push("National Do Not Call restriction requires a documented exception");
  if (["sms", "robocall"].includes(channel) && input.writtenConsent !== true) blockers.push("Written consent is required for automated calling or texting");
  return {
    schemaVersion: "wr-outreach-readiness-v1",
    ready: blockers.length === 0,
    normalizedPhone: phone.length === 10 ? `+1${phone}` : phone.startsWith("1") && phone.length === 11 ? `+${phone}` : phone,
    channel,
    blockers,
  };
}

export function evaluatePilotReadiness(input = {}) {
  const invited = number(input.invitedMembers);
  const active = number(input.activeMembers);
  const listings = number(input.listingsLoaded);
  const matches = number(input.matchesCreated);
  const followUps = number(input.followUpsCompleted);
  const dataErrors = number(input.openDataErrors);
  const checks = [
    { id: "members", label: "At least 5 active pilot members", passed: active >= 5 },
    { id: "activation", label: "At least 40% of invited members are active", passed: invited > 0 && active / invited >= 0.4 },
    { id: "listings", label: "At least 10 listings loaded", passed: listings >= 10 },
    { id: "matches", label: "At least 3 buyer/listing matches", passed: matches >= 3 },
    { id: "followups", label: "At least 5 follow-ups completed", passed: followUps >= 5 },
    { id: "quality", label: "No unresolved critical data errors", passed: dataErrors === 0 },
  ];
  const passed = checks.filter((check) => check.passed).length;
  return { schemaVersion: "wr-pilot-readiness-v1", ready: passed === checks.length, score: Math.round((passed / checks.length) * 100), checks };
}
