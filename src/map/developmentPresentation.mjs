export const DEVELOPMENT_PRESENTATION_VERSION = "wr-development-presentation-v1";

function clean(value) {
  return String(value || "").trim();
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

export function toIndexedDevelopmentPresentation(record = {}) {
  const parcelId = clean(record.parcelId);
  if (!parcelId) return null;
  return Object.freeze({
    schemaVersion: DEVELOPMENT_PRESENTATION_VERSION,
    id: `indexed-development-${parcelId}`,
    title: clean(record.parcelPropertyName) || clean(record.parcelAddress) || `Development parcel ${parcelId}`,
    linkedAccount: parcelId,
    address: clean(record.parcelAddress),
    type: "development_signal",
    stage: Array.isArray(record.stages) && record.stages.length ? record.stages.join(", ") : "development signal",
    summary: `${formatCount(record.signalCount)} development signal(s)${record.latestActivityDate ? ` through ${record.latestActivityDate}` : ""}.`,
    sourceIds: [],
    sources: [],
    signalCount: Number(record.signalCount || 0),
    score: Number(record.score || 0),
    latestActivityDate: clean(record.latestActivityDate),
    indexedDevelopment: record,
  });
}

export function resolveSelectedDevelopmentRecord({ embeddedRecords = [], indexedRecords = new Map(), selectedDevelopmentId = "", parcelAccountId = "", parcelGisId = "" } = {}) {
  const account = clean(parcelAccountId);
  const gisId = clean(parcelGisId);
  const selectedId = clean(selectedDevelopmentId);
  const indexed = indexedRecords.get(account) || indexedRecords.get(gisId) || null;
  const indexedPresentation = indexed ? toIndexedDevelopmentPresentation(indexed) : null;
  const selectedIndexed = selectedId.startsWith("indexed-development-");
  if (selectedIndexed && indexedPresentation?.id === selectedId) return indexedPresentation;
  const embedded = embeddedRecords.find((record) => clean(record.id) === selectedId)
    || embeddedRecords.find((record) => clean(record.linkedAccount) === account || clean(record.linkedAccount) === gisId)
    || null;
  return embedded || indexedPresentation;
}
