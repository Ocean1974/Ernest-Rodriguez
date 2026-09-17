export const CRM_IMPORT_VERSION = "wr-crm-lead-import-v1";

const STAGES = ["Lead", "Qualified", "Underwriting", "Due diligence", "Offer", "Closed"];
const CREXI_URL_PATTERN = /\b(?:https?:\/\/)?(?:www\.)?crexi\.com(?:\/[^\s,;|)\]}'\"]*)?/gi;

export function removeCrexiLinksFromText(value) {
  return String(value ?? "")
    .replace(CREXI_URL_PATTERN, "")
    .replace(/\s*([|;,])\s*([|;,])+/g, "$1")
    .replace(/^[\s|;,\-]+|[\s|;,\-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeCrmLead(record = {}) {
  const sanitized = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === "string" ? removeCrexiLinksFromText(value) : value]));
  sanitized.propertyLink = removeCrexiLinksFromText(record.propertyLink);
  sanitized.importedFields = Object.fromEntries(
    Object.entries(record.importedFields || {})
      .map(([label, value]) => [label, removeCrexiLinksFromText(value)])
      .filter(([, value]) => value),
  );
  return sanitized;
}

function normalizedHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseCsvRows(source) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const text = String(source || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function fieldValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[normalizedHeader(alias)];
    if (String(value || "").trim()) return String(value).trim();
  }
  return "";
}

function fieldValues(record, aliases) {
  return [...new Set(aliases.map((alias) => String(record[normalizedHeader(alias)] || "").trim()).filter(Boolean))];
}

function parsedDate(value, fallback = "") {
  if (!String(value || "").trim()) return fallback;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function parsedMoney(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return 0;
  const number = Number(source.replace(/[$,\s]/g, "").replace(/[km]$/, ""));
  if (!Number.isFinite(number)) return 0;
  if (source.endsWith("m")) return Math.round(number * 1_000_000);
  if (source.endsWith("k")) return Math.round(number * 1_000);
  return Math.max(0, number);
}

function normalizedStage(value) {
  const source = String(value || "").trim().toLowerCase();
  return STAGES.find((stage) => stage.toLowerCase() === source) || "Lead";
}

function leadIdentities(record) {
  const emailValues = Array.isArray(record.emails) && record.emails.length ? record.emails : [record.email];
  const phoneValues = Array.isArray(record.phones) && record.phones.length ? record.phones : [record.phone];
  const emails = [...new Set(emailValues.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  const phones = [...new Set(phoneValues.map((value) => String(value || "").replace(/\D/g, "")).filter(Boolean))];
  const contact = String(record.contact || record.name || "").trim().toLowerCase();
  const address = String(record.address || "").trim().toLowerCase();
  return [
    ...emails.map((email) => `email:${email}`),
    ...phones.map((phone) => `phone:${phone}`),
    ...(contact || address ? [`name-address:${contact}|${address}`] : []),
  ];
}

function mergeContactDetails(existing, incoming) {
  const existingEmails = existing.emails?.length ? existing.emails : [existing.email];
  const incomingEmails = incoming.emails?.length ? incoming.emails : [incoming.email];
  const existingPhones = existing.phones?.length ? existing.phones : [existing.phone];
  const incomingPhones = incoming.phones?.length ? incoming.phones : [incoming.phone];
  const emails = [...new Set([...existingEmails, ...incomingEmails].filter(Boolean))];
  const phones = [...new Set([...existingPhones, ...incomingPhones].filter(Boolean))];
  return sanitizeCrmLead({
    ...incoming,
    ...existing,
    importedFields: { ...(existing.importedFields || {}), ...(incoming.importedFields || {}) },
    email: emails.join(" · "),
    emails,
    phone: phones.join(" · "),
    phones,
    address: existing.address || incoming.address,
    contact: existing.contact || incoming.contact,
    name: existing.name || incoming.name,
    source: existing.source || incoming.source,
    propertyLink: existing.propertyLink || incoming.propertyLink,
    propertyType: existing.propertyType || incoming.propertyType,
    apn: existing.apn || incoming.apn,
    unit: existing.unit || incoming.unit,
    city: existing.city || incoming.city,
    zipCode: existing.zipCode || incoming.zipCode,
    state: existing.state || incoming.state,
    county: existing.county || incoming.county,
    saleDate: existing.saleDate || incoming.saleDate,
    soldPrice: existing.soldPrice || incoming.soldPrice,
  });
}

export function importCrmLeadsFromCsv(csvText, existingRecords = [], options = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return { schemaVersion: CRM_IMPORT_VERSION, records: [...existingRecords], imported: 0, skipped: 0, invalid: 0, issues: [{ row: 1, reason: "The CSV does not contain a header and lead rows." }], error: "The CSV does not contain a header and lead rows." };
  const displayHeaders = rows[0].map((header) => String(header || "").trim());
  const headers = displayHeaders.map(normalizedHeader);
  const now = options.now || new Date().toISOString();
  const nextExistingRecords = existingRecords.map(sanitizeCrmLead);
  const identityIndex = new Map();
  nextExistingRecords.forEach((record, index) => leadIdentities(record).forEach((identity) => identityIndex.set(identity, { bucket: "existing", index })));
  const importedRecords = [];
  let skipped = 0;
  let invalid = 0;
  let updated = 0;
  const issues = [];

  rows.slice(1).forEach((values, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const importedFields = Object.fromEntries(displayHeaders.map((header, index) => [header, removeCrexiLinksFromText(values[index])]).filter(([header, value]) => header && value));
    const firstName = fieldValue(record, ["first name", "firstname"]);
    const lastName = fieldValue(record, ["last name", "lastname"]);
    const contact = fieldValue(record, ["name", "full name", "contact", "contact name", "person"]) || [firstName, lastName].filter(Boolean).join(" ");
    const address = fieldValue(record, ["property address", "address", "street address", "listing address"]);
    const emails = fieldValues(record, ["email", "email address", "primary email", "email 1", "email 2", "email 3", "email 4", "email 5"]);
    const phones = fieldValues(record, ["phone", "phone number", "mobile", "mobile phone", "primary phone", "phone 1", "phone 2", "phone 3", "phone 4", "phone 5"]);
    const email = emails.join(" · ");
    const phone = phones.join(" · ");
    if (!contact && !address && !email && !phone) { invalid += 1; issues.push({ row: rowIndex + 2, reason: "No contact, address, phone, or email data." }); return; }
    const sourceId = fieldValue(record, ["id", "lead id", "contact id", "person id"]);
    const lead = sanitizeCrmLead({
      id: sourceId ? `crm-import-${sourceId}` : `crm-import-${Date.parse(now) || Date.now()}-${rowIndex + 1}`,
      name: fieldValue(record, ["opportunity", "opportunity name", "deal", "deal name", "property", "property name"]) || address || `${contact || "Imported"} lead`,
      address,
      contact,
      email,
      emails,
      phone,
      phones,
      agent: fieldValue(record, ["agent", "assigned agent", "owner", "assigned to"]),
      source: fieldValue(record, ["source", "lead source", "pond", "source/pond"]) || "CSV import",
      value: parsedMoney(fieldValue(record, ["price", "value", "deal value", "estimated value", "listing price", "sold price"])),
      stage: normalizedStage(fieldValue(record, ["stage", "deal stage", "status"])),
      nextAction: fieldValue(record, ["next action", "task", "next task", "action"]),
      followUp: fieldValue(record, ["follow up", "follow-up", "follow up date", "next follow up"]),
      createdAt: parsedDate(fieldValue(record, ["created", "created date", "date created", "added"]), now),
      lastActivity: parsedDate(fieldValue(record, ["last activity", "last contacted", "updated", "last communication"]), now),
      propertyLink: removeCrexiLinksFromText(fieldValue(record, ["property link"])),
      propertyType: fieldValue(record, ["property type"]),
      apn: fieldValue(record, ["apn", "parcel number", "parcel id"]),
      unit: fieldValue(record, ["unit"]),
      city: fieldValue(record, ["city"]),
      zipCode: fieldValue(record, ["zip code", "zip", "postal code"]),
      state: fieldValue(record, ["state"]),
      county: fieldValue(record, ["county"]),
      saleDate: fieldValue(record, ["sale date", "sold date"]),
      soldPrice: parsedMoney(fieldValue(record, ["sold price", "sale price"])),
      importedFields,
    });
    const identities = leadIdentities(lead);
    const nameAddressIdentity = identities.find((identity) => identity.startsWith("name-address:"));
    const nameAddressMatch = nameAddressIdentity ? identityIndex.get(nameAddressIdentity) : null;
    const match = nameAddressMatch || identities.map((identity) => identityIndex.get(identity)).find(Boolean);
    if (match?.bucket === "imported") { skipped += 1; issues.push({ row: rowIndex + 2, reason: "Duplicate of another row in this file." }); return; }
    if (match?.bucket === "existing") {
      if (!nameAddressMatch) { skipped += 1; issues.push({ row: rowIndex + 2, reason: "Phone or email matches another lead, but the name or property differs; review manually." }); return; }
      const existing = nextExistingRecords[match.index];
      const merged = mergeContactDetails(existing, lead);
      const recordChanged = JSON.stringify(existing) !== JSON.stringify(merged);
      if (!recordChanged) { skipped += 1; issues.push({ row: rowIndex + 2, reason: "Existing lead already contains this information." }); return; }
      nextExistingRecords[match.index] = merged;
      leadIdentities(merged).forEach((identity) => identityIndex.set(identity, { bucket: "existing", index: match.index }));
      updated += 1;
      return;
    }
    const importedIndex = importedRecords.length;
    importedRecords.push(lead);
    identities.forEach((identity) => identityIndex.set(identity, { bucket: "imported", index: importedIndex }));
  });

  return { schemaVersion: CRM_IMPORT_VERSION, records: [...importedRecords, ...nextExistingRecords], imported: importedRecords.length, updated, skipped, invalid, issues, error: "" };
}
