const fs = require("fs");
const path = require("path");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { searchParcelRecords } = require(path.join(__dirname, "..", "src", "map", "loadParcels.ts"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const parcels = [
  { accountNum: "008052000B01A0000", address: "10300 SANDEN DR", ownerName: "SANDEN INTERNATIONAL USA INC", blockId: "B/8052", buildingClass: "STORAGE WAREHOUSE", totalValue: 40624920 },
  { accountNum: "00000155887000000", address: "1616 GREENVILLE AVE", ownerName: "GREENVILLE RETAIL OWNER LLC", businessName: "GREENVILLE RETAIL HOLDINGS", blockId: "K/1477", buildingClass: "RETAIL", totalValue: 1716000 },
  { accountNum: "00000155887000001", address: "10301 OTHER DR", ownerName: "OTHER OWNER LLC", blockId: "K/1478", buildingClass: "RETAIL", totalValue: 650000 },
];

assert(searchParcelRecords(parcels, "10300 SANDEN DR")[0]?.accountNum === "008052000B01A0000", "exact address must rank first");
assert(searchParcelRecords(parcels, "10300 SANDEN DR").length === 1, "exact street-number search must exclude weak street-suffix matches");
assert(searchParcelRecords(parcels, "SANDEN DR").length === 1, "multi-word search must require a meaningful majority of terms");
assert(searchParcelRecords(parcels, "008052000B01A0000").length === 1, "exact account search must remain available");
assert(searchParcelRecords(parcels, "GREENVILLE RETAIL OWNER")[0]?.accountNum === "00000155887000000", "owner-name token search must remain available");

console.log("White Rabbit parcel search relevance tests passed.");
