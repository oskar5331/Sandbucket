// Initial-JS budget (docs/prd.md §8, enforced in CI per §29).
//
// Chunk names are content hashes, so the file list is read from the build output
// rather than written by hand: for every app route, its first load is the shared
// runtime (`rootMainFiles`) plus the route's own entry chunks (`entryJSFiles` in the
// route's client-reference manifest). Each route is checked separately, so one heavy
// page fails on its own name.
//
// Sizes are gzip, because that is what `next start` sends over the wire. The raw
// shared runtime alone exceeds 200 KB, so an uncompressed reading of §8 is not
// achievable with Next.js.
//
// Run after `next build`.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import vm from "node:vm";

// The one place the §8 number lives in code.
const INITIAL_JS_LIMIT = "200 KB";

const NEXT_DIR = ".next";
const SERVER_APP_DIR = join(NEXT_DIR, "server", "app");
const MANIFEST_SUFFIX = "_client-reference-manifest.js";

if (!existsSync(join(NEXT_DIR, "build-manifest.json"))) {
  throw new Error("No build output in .next/ — run `pnpm build` before `pnpm size`.");
}

const buildManifest = JSON.parse(readFileSync(join(NEXT_DIR, "build-manifest.json"), "utf8"));
const sharedFiles = buildManifest.rootMainFiles;

function findRouteManifests(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return findRouteManifests(path);
    return name.endsWith(MANIFEST_SUFFIX) ? [path] : [];
  });
}

// The manifest is a script that assigns to globalThis.__RSC_MANIFEST; run it in an
// isolated context instead of requiring it into this process.
function readRouteManifest(path) {
  const context = { globalThis: {} };
  context.globalThis.__RSC_MANIFEST = {};
  vm.runInNewContext(readFileSync(path, "utf8"), context);
  const entries = Object.entries(context.globalThis.__RSC_MANIFEST);
  if (entries.length !== 1) throw new Error(`Expected one route in ${path}, found ${entries.length}`);
  return entries[0];
}

const routeManifests = findRouteManifests(SERVER_APP_DIR).filter(
  // Next's built-in error boundaries are not pages a user lands on.
  (path) => !relative(SERVER_APP_DIR, path).startsWith("_global-error"),
);

if (routeManifests.length === 0) throw new Error(`No route manifests found under ${SERVER_APP_DIR}`);

export default routeManifests.map((path) => {
  const [route, manifest] = readRouteManifest(path);
  const routeFiles = Object.values(manifest.entryJSFiles).flat();
  const files = [...new Set([...sharedFiles, ...routeFiles])];
  return {
    name: `initial JS ${route}`,
    path: files.map((file) => join(NEXT_DIR, file)),
    limit: INITIAL_JS_LIMIT,
    gzip: true,
  };
});
