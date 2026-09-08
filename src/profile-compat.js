const fs = require("fs");
const path = require("path");

const CORE_WEB_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
const CORE = new Set(CORE_WEB_BUNDLES);

function webPkgPath(dshHome) {
  return path.join(dshHome, "profiles", "web", "package.json");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function listBundles(pkg) {
  const bundles = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
  return Array.isArray(bundles) ? bundles.filter((b) => typeof b === "string" && b) : [];
}

function isPluginBootError(e) {
  const text = [e && e.message, e && e.output].filter(Boolean).join("\n");
  return /plugin tree failed to load|failed to import loader entry|does not provide an export named|failed to apply loader entry/i.test(
    text,
  );
}

function extraBundles(dshHome) {
  const file = webPkgPath(dshHome);
  if (!fs.existsSync(file)) return [];
  return listBundles(readJson(file)).filter((b) => !CORE.has(b));
}

function mentionedExtraBundles(e, dshHome) {
  const text = [e && e.message, e && e.output].filter(Boolean).join("\n");
  return extraBundles(dshHome).filter((b) => text.includes(b));
}

function parkExtraWebBundles(dshHome, only) {
  const file = webPkgPath(dshHome);
  if (!fs.existsSync(file)) return [];
  const pkg = readJson(file);
  const bundles = listBundles(pkg);
  let extra = bundles.filter((b) => !CORE.has(b));
  if (Array.isArray(only) && only.length) {
    const want = new Set(only);
    extra = extra.filter((b) => want.has(b));
  }
  if (!extra.length) return [];
  if (!pkg.dsh) pkg.dsh = {};
  if (!pkg.dsh.profile) pkg.dsh.profile = {};
  if (!pkg.dsh.profile.desktopPark) {
    pkg.dsh.profile.desktopPark = { bundles: bundles.slice() };
  }
  const drop = new Set(extra);
  pkg.dsh.profile.bundles = bundles.filter((b) => !drop.has(b));
  if (!pkg.dsh.profile.bundles.length) pkg.dsh.profile.bundles = CORE_WEB_BUNDLES.slice();
  writeJson(file, pkg);
  return extra;
}

function restoreParkedWebBundles(dshHome) {
  const file = webPkgPath(dshHome);
  if (!fs.existsSync(file)) return;
  const pkg = readJson(file);
  const bak = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.desktopPark;
  if (!bak || !Array.isArray(bak.bundles)) return;
  pkg.dsh.profile.bundles = bak.bundles;
  delete pkg.dsh.profile.desktopPark;
  writeJson(file, pkg);
}

module.exports = {
  CORE_WEB_BUNDLES,
  isPluginBootError,
  mentionedExtraBundles,
  parkExtraWebBundles,
  restoreParkedWebBundles,
};
