const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const extractedDir = path.join(dataDir, "extracted");

const sources = [
  ["PARCEL_GEOM.zip", "parcel_geom"],
  ["DCAD2026_CURRENT.ZIP", "dcad_current"],
  ["BLKID (1).zip", "blkid"],
  ["ParcelDimension (1).zip", "parcel_dimension"],
];

function extract(zipName, folderName) {
  const zipFile = path.join(dataDir, zipName);
  const destination = path.join(extractedDir, folderName);
  if (!fs.existsSync(zipFile)) throw new Error(`Missing ${path.relative(root, zipFile)}`);
  fs.mkdirSync(destination, { recursive: true });
  const hasFiles = fs.readdirSync(destination).length > 0;
  if (hasFiles) {
    console.log(`${path.relative(root, destination)} already contains extracted files`);
    return;
  }
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`Failed to extract ${zipName}`);
}

fs.mkdirSync(extractedDir, { recursive: true });
sources.forEach(([zipName, folderName]) => extract(zipName, folderName));
console.log("DCAD source ZIP extraction verified.");
