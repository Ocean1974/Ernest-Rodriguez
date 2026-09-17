const BUSINESS_ENTITY_PATTERN = /\b(LLC|L\.L\.C\.|LP|L\.P\.|LLP|L\.L\.P\.|LTD|INC|INCORPORATED|CORP|CORPORATION|CO\.?|COMPANY|TRUST|BANK|ASSOCIATION|ASSOC|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|PROPERTY|VENTURES|INVESTMENTS|REAL ESTATE|REIT|GROUP|MANAGEMENT|DEVELOPMENT|DEVELOPER|CAPITAL|FUND|AUTHORITY|CITY OF|COUNTY OF|STATE OF|ISD|SCHOOL DISTRICT|CHURCH|MINISTRIES|FOUNDATION|UNIVERSITY)\b/i;
const PRIVATE_OWNER_HINT_PATTERN = /\b( ETAL| ET AL| & | AND | OR | LIFE ESTATE| ESTATE OF| REVOCABLE| LIVING TRUST)\b/i;

function compact(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return compact(value).replace(/\s+/g, " ").toUpperCase();
}

function normalizePhone(value) {
  return compact(value).replace(/\D+/g, "");
}

function normalizeEmail(value) {
  return compact(value).toLowerCase();
}

function isSuppressed(parcel, suppression) {
  const account = normalize(parcel.accountNum || parcel.accountNumber);
  const ownerName = normalize(parcel.ownerName || parcel.propertyName);
  const mailingAddress = normalize([parcel.ownerMailingAddress, parcel.ownerMailingAddress2, parcel.ownerCity, parcel.ownerState, parcel.ownerZip].filter(Boolean).join(" "));
  const phone = normalizePhone(parcel.ownerPhone);
  const email = normalizeEmail(parcel.ownerEmail);
  const matched = [];
  if (account && suppression.accounts.has(account)) matched.push("account");
  if (ownerName && suppression.ownerNames.has(ownerName)) matched.push("owner_name");
  if (mailingAddress && suppression.mailingAddresses.has(mailingAddress)) matched.push("mailing_address");
  if (phone && suppression.phones.has(phone)) matched.push("phone");
  if (email && suppression.emails.has(email)) matched.push("email");
  return { suppressed: matched.length > 0, matched };
}

function prepareSuppression(raw) {
  return {
    accounts: new Set((raw.suppressAccounts || []).map(normalize).filter(Boolean)),
    ownerNames: new Set((raw.suppressOwnerNames || []).map(normalize).filter(Boolean)),
    mailingAddresses: new Set((raw.suppressMailingAddresses || []).map(normalize).filter(Boolean)),
    phones: new Set((raw.suppressPhones || []).map(normalizePhone).filter(Boolean)),
    emails: new Set((raw.suppressEmails || []).map(normalizeEmail).filter(Boolean)),
  };
}

function classifyOwner(parcel) {
  const ownerName = compact(parcel.ownerName || parcel.propertyName);
  if (!ownerName) {
    return {
      category: "unknown",
      eligibleForBusinessContact: false,
      reason: "No owner name was present in the parcel record.",
    };
  }
  if (BUSINESS_ENTITY_PATTERN.test(ownerName)) {
    return {
      category: "business_entity_candidate",
      eligibleForBusinessContact: true,
      reason: "Owner name contains public business/entity indicators.",
    };
  }
  if (PRIVATE_OWNER_HINT_PATTERN.test(ownerName) || /^[A-Z][A-Z.'-]+ [A-Z][A-Z.'-]+/.test(ownerName)) {
    return {
      category: "private_individual_candidate",
      eligibleForBusinessContact: false,
      reason: "Owner name appears to identify a private individual or household.",
    };
  }
  return {
    category: "unclassified",
    eligibleForBusinessContact: false,
    reason: "No reliable business/entity indicator was found.",
  };
}

function provenance(source, field, value, sourceField, confidence = "source_record") {
  return {
    source,
    field,
    sourceField,
    valuePresent: compact(value).length > 0,
    confidence,
  };
}

function buildContactRecord(parcel, suppression, options = {}) {
  const ownerConfig = options.ownerConfig || {};
  const sourceLabel = ownerConfig.sourceLabel || "county appraisal owner source";
  const fields = ownerConfig.fields || {};
  const classification = classifyOwner(parcel);
  const suppressionResult = isSuppressed(parcel, suppression);
  const ownerName = compact(parcel.ownerName || parcel.propertyName);
  const mailingAddress = compact(parcel.ownerMailingAddress);
  const mailingAddress2 = compact(parcel.ownerMailingAddress2);
  const city = compact(parcel.ownerCity);
  const state = compact(parcel.ownerState);
  const zip = compact(parcel.ownerZip);
  const phone = compact(parcel.ownerPhone);
  const email = compact(parcel.ownerEmail);
  const includeBusinessContact = classification.eligibleForBusinessContact && !suppressionResult.suppressed;

  return {
    sourceCountyId: compact(parcel.sourceCountyId || ownerConfig.sourceCountyId),
    countyParcelId: compact(parcel.countyParcelId || [parcel.sourceCountyId || ownerConfig.sourceCountyId, parcel.accountNum || parcel.accountNumber].filter(Boolean).join(":")),
    accountNum: compact(parcel.accountNum || parcel.accountNumber),
    gisParcelId: compact(parcel.gisParcelId),
    propertyAddress: compact(parcel.address || parcel.propertyAddress),
    ownerName,
    ownerClassification: classification,
    suppression: {
      suppressed: suppressionResult.suppressed,
      matchedRules: suppressionResult.matched,
    },
    contacts: {
      businessEntity: includeBusinessContact
        ? {
            ownerName,
            mailingAddress,
            mailingAddress2,
            city,
            state,
            zip,
            phone,
            email,
          }
        : null,
      privateIndividual: classification.category === "private_individual_candidate"
        ? {
            excluded: true,
            reason: "Private individual contact fields are not exported by this enrichment pipeline.",
          }
        : null,
      permitParties: {
        excludedFromOwnerContact: true,
        reason: "Permit contractors/applicants are permit evidence only and are not property-owner contacts.",
      },
    },
    provenance: [
      provenance(sourceLabel, "ownerName", ownerName, fields.ownerName || "ownerName/propertyName"),
      provenance(sourceLabel, "mailingAddress", mailingAddress, fields.ownerMailingAddress || "ownerMailingAddress"),
      provenance(sourceLabel, "mailingAddress2", mailingAddress2, fields.ownerMailingAddress2 || "ownerMailingAddress2"),
      provenance(sourceLabel, "ownerCity", city, fields.ownerCity || "ownerCity"),
      provenance(sourceLabel, "ownerState", state, fields.ownerState || "ownerState"),
      provenance(sourceLabel, "ownerZip", zip, fields.ownerZip || "ownerZip"),
      provenance(sourceLabel, "ownerPhone", phone, fields.ownerPhone || "ownerPhone"),
      provenance("local enrichment policy", "ownerClassification", classification.category, "BUSINESS_ENTITY_PATTERN"),
      provenance("data/contact-suppression-list.json", "suppression", suppressionResult.suppressed ? suppressionResult.matched.join(", ") : "", "suppression arrays"),
    ],
    complianceFlags: [
      classification.eligibleForBusinessContact ? "business_entity_candidate" : "not_business_contact_eligible",
      suppressionResult.suppressed ? "suppressed" : "not_suppressed",
      "contractors_not_owner_contacts",
      "private_social_profiles_excluded",
    ],
  };
}

module.exports = {
  buildContactRecord,
  classifyOwner,
  compact,
  isSuppressed,
  normalize,
  prepareSuppression,
};
