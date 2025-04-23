import { readFileSync, writeFileSync } from "fs";

// Read minAppVersion from manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const minAppVersion = manifest.minAppVersion;
const currentVersion = manifest.version;

// Update versions.json with the minAppVersion and current version
let versions = {};
try {
  versions = JSON.parse(readFileSync("versions.json", "utf8"));
} catch (e) {}

versions[currentVersion] = minAppVersion;

writeFileSync("versions.json", JSON.stringify(versions, null, 2));
console.log(`Updated versions.json with ${currentVersion} -> ${minAppVersion}`);