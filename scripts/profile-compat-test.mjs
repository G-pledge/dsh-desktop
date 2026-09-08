import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isPluginBootError, parkExtraWebBundles, restoreParkedWebBundles } = require("../src/profile-compat.js");

if (!isPluginBootError({ message: "dsh 提前退出，退出码 1", output: "plugin tree failed to load: failed to import loader entry dsh-redteam-model" })) {
  throw new Error("should detect plugin tree errors");
}
if (isPluginBootError({ message: "等待服务超时" })) {
  throw new Error("should ignore unrelated errors");
}

const root = mkdtempSync(join(tmpdir(), "dsh-park-"));
const web = join(root, "profiles", "web");
mkdirSync(web, { recursive: true });
const src = {
  name: "dsh-profile-web",
  dsh: {
    profile: {
      bundles: [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@dsh-external/dsh-redteam-model",
        "dsh-side-panels",
      ],
    },
  },
};
writeFileSync(join(web, "package.json"), JSON.stringify(src, null, 2) + "\n");

const parked = parkExtraWebBundles(root, ["@dsh-external/dsh-redteam-model"]);
if (parked.join(",") !== "@dsh-external/dsh-redteam-model") {
  throw new Error("park named: " + parked.join(","));
}
const after = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
if (after.dsh.profile.bundles.join(",") !== "@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,dsh-side-panels") {
  throw new Error("should keep other extras: " + after.dsh.profile.bundles.join(","));
}
const rest = parkExtraWebBundles(root);
if (rest.join(",") !== "dsh-side-panels") throw new Error("park rest: " + rest.join(","));

restoreParkedWebBundles(root);
const back = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
if (back.dsh.profile.bundles.join(",") !== src.dsh.profile.bundles.join(",")) {
  throw new Error("restore mismatch");
}
if (back.dsh.profile.desktopPark) throw new Error("park leftover");

rmSync(root, { recursive: true, force: true });
console.log("ok");
