// Some versions must be written in more than one file because each tool reads
// its own (Docker, GitHub Actions, npm). `.node-version` is the one source; this
// test fails when any copy drifts from it. Each copy is checked by parsing the
// file it lives in, so a new copy has to be added here to be covered.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const nodeVersion = read(".node-version").trim();
const nodeMajor = nodeVersion.split(".")[0];

describe("Node version", () => {
  it(".node-version is an exact x.y.z version", () => {
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("package.json engines requires exactly that version or newer", () => {
    const pkg = JSON.parse(read("package.json")) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe(`>=${nodeVersion}`);
  });

  it("every node image in compose.yaml uses exactly that version", () => {
    const tags = [...read("compose.yaml").matchAll(/image:\s*node:(\S+)/g)].map((m) => m[1]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(new RegExp(`^${nodeVersion.replaceAll(".", "\\.")}-`));
  });

  it("every FROM node stage in the production Dockerfile uses exactly that version", () => {
    const tags = [...read("Dockerfile").matchAll(/^FROM node:(\S+)/gm)].map((m) => m[1]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(new RegExp(`^${nodeVersion.replaceAll(".", "\\.")}-`));
  });

  it("the devcontainer image uses the same major", () => {
    const tags = [...read(".devcontainer/Dockerfile").matchAll(/^FROM node:(\S+)/gm)].map((m) => m[1]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag?.split(/[.-]/)[0]).toBe(nodeMajor);
  });
});

describe("object storage config", () => {
  it(".env.example signs with the region Garage serves (a mismatch is a 403 SignatureDoesNotMatch)", () => {
    const serverRegion = read("compose/garage.toml").match(/^s3_region\s*=\s*"([^"]+)"/m)?.[1];
    const clientRegion = read(".env.example").match(/^AWS_REGION=(.*)$/m)?.[1];
    expect(serverRegion).toBeDefined();
    expect(clientRegion).toBe(serverRegion);
  });
});

describe("dbmate", () => {
  it("the Dockerfile installs the version pinned in docs/stack-versions.md", () => {
    const pinned = read("docs/stack-versions.md").match(/^\| dbmate \| (\S+) \|/m)?.[1];
    const installed = read("Dockerfile").match(/^ARG DBMATE_VERSION=(\S+)$/m)?.[1];
    expect(pinned).toBeDefined();
    expect(installed).toBe(pinned);
  });
});

describe("CI workflow", () => {
  const workflow = () => read(".github/workflows/pr.yml");

  it("takes Node from .node-version, never a hard-coded version", () => {
    expect(workflow()).toMatch(/node-version-file:\s*\.node-version/);
    expect(workflow()).not.toMatch(/^\s*node-version:/m);
  });

  it("pins every action to the exact tag listed in docs/stack-versions.md", () => {
    const uses = [...workflow().matchAll(/uses:\s*([\w-]+\/[\w-]+)@(\S+)/g)];
    expect(uses.length).toBeGreaterThan(0);
    const table = read("docs/stack-versions.md");
    for (const [, action, tag] of uses) {
      expect(tag, `${action} must use an exact vX.Y.Z tag`).toMatch(/^v\d+\.\d+\.\d+$/);
      const escaped = action!.replace("/", "\\/");
      const pinned = table.match(new RegExp(`^\\| \`${escaped}\` \\| (\\S+) \\|`, "m"))?.[1];
      expect(pinned, `${action} has no row in stack-versions.md`).toBeDefined();
      expect(tag).toBe(pinned);
    }
  });

  it("installs the same corepack version as the Dockerfile", () => {
    const inDocker = read("Dockerfile").match(/corepack@(\S+)/)?.[1];
    const inCi = [...workflow().matchAll(/corepack@(\S+)/g)].map((m) => m[1]);
    expect(inDocker).toBeDefined();
    expect(inCi.length).toBeGreaterThan(0);
    for (const version of inCi) expect(version).toBe(inDocker);
  });
});
