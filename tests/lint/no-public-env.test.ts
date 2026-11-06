// Proves the "no build-time config" rule (plan R2, roadmap Q5) is enforced by lint.
// Next.js inlines `process.env.NEXT_PUBLIC_*` into the build output, which would bake one
// deployment's value into the image every self-hoster runs (prd.md §17). Files are linted
// as text under made-up paths, so none of them need to exist.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function publicEnvErrors(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("NEXT_PUBLIC_* ban", () => {
  it.each([
    ["app/page.tsx", `export const url = process.env.NEXT_PUBLIC_APP_URL;`],
    ["components/nav.tsx", `export const url = process.env["NEXT_PUBLIC_APP_URL"];`],
    ["lib/env.ts", `export const url = process.env.NEXT_PUBLIC_ANYTHING;`],
    ["proxy.ts", `export const url = process.env.NEXT_PUBLIC_APP_URL;`],
    ["app/legacy.jsx", `export const url = process.env.NEXT_PUBLIC_APP_URL;`],
  ])("refuses the read in %s: %s", async (filePath, source) => {
    expect(await publicEnvErrors(filePath, source)).toHaveLength(1);
  });

  it("allows server-only variables", async () => {
    expect(await publicEnvErrors("lib/env.ts", `export const url = process.env.APP_URL;`)).toHaveLength(0);
  });
});
