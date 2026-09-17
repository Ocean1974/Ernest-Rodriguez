import joinKeyReport from "../output/join-key-report.md?raw";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(joinKeyReport.includes("PARCEL_GEOM.Acct -> DCAD ACCOUNT_NUM"), "primary parcel/account join key is documented");
assert(joinKeyReport.includes("BLKID has a `TEXT` label field"), "BLKID join uncertainty is documented");
assert(joinKeyReport.includes("ParcelDimension has a `TEXT` measurement field"), "ParcelDimension join uncertainty is documented");
