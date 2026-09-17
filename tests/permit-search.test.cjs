const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypescriptModule(file) {
  const source = fs.readFileSync(file, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (request) => {
      if (request === "./permitSearch") return loadTypescriptModule(path.join(root, "src", "map", "permitSearch.ts"));
      if (request.startsWith(".")) return loadTypescriptModule(path.join(path.dirname(file), `${request}.ts`));
      return require(request);
    },
    console,
    fetch,
  });
  vm.runInContext(transpiled, context, { filename: file });
  return module.exports;
}

const permitSearch = loadTypescriptModule(path.join(root, "src", "map", "permitSearch.ts"));
const permitLoader = loadTypescriptModule(path.join(root, "src", "map", "loadPermits.ts"));

const permits = [
  {
    permitRecordId: "e7gq-4sah-1",
    sourceDataset: "e7gq-4sah",
    permitNumber: "2003133024",
    permitType: "Electrical Commercial Alteration",
    permitStatus: "Issued",
    address: "10300 SANDEN DR",
    parcelAccountNum: "008052000B01A0000",
    latitude: 32.89,
    longitude: -96.7,
  },
  {
    permitRecordId: "9qet-qt9e-1",
    sourceDataset: "9qet-qt9e",
    permitNumber: "CO-123",
    permitType: "Certificate Of Occupancy",
    permitStatus: "Final",
    address: "1616 GREENVILLE AVE",
    parcelAccountNum: "00000155887000000",
    latitude: 32.82,
    longitude: -96.78,
  },
];

assert(permitSearch.searchPermitRecords(permits, "2003133024").length === 1, "Permit search should find permit number");
assert(permitSearch.searchPermitRecords(permits, "certificate").length === 1, "Permit search should find permit type");
assert(permitSearch.searchPermitRecords(permits, "issued").length === 1, "Permit search should find status");
assert(permitSearch.searchPermitRecords(permits, "10300 sanden").length === 1, "Permit search should find address");
assert(permitSearch.permitsForParcel(permits, "008052000B01A0000").length === 1, "Parcel permit lookup should find account");

const visible = permitLoader.filterPermitRecordsForViewport(permits, {
  bounds: { minLng: -96.71, minLat: 32.88, maxLng: -96.69, maxLat: 32.9 },
});
assert(visible.length === 1, "Permit viewport loader should return only permits inside bounds");
assert(visible[0].permitNumber === "2003133024", "Permit viewport loader returned the wrong permit");

console.log("White Rabbit permit search tests passed.");
