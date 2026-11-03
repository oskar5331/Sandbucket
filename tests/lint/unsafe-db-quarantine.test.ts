// Proves the §12 quarantine is enforced by lint, not by convention.
// Files are linted as text under made-up paths, so none of them need to exist.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportErrors(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
}

describe("lib/db/unsafe quarantine", () => {
  it.each([
    ["app/page.tsx", `import { db } from "@/lib/db/unsafe";`],
    ["app/settings/actions.ts", `import { db } from "../../lib/db/unsafe";`],
    ["lib/profile.ts", `import { db } from "./db/unsafe";`],
    ["lib/profile.ts", `export { db } from "./db/unsafe.ts";`],
  ])("refuses the import from %s: %s", async (filePath, source) => {
    expect(await restrictedImportErrors(filePath, source)).toHaveLength(1);
  });

  it("allows lib/db/ itself", async () => {
    expect(await restrictedImportErrors("lib/db/accessor.ts", `import { db } from "./unsafe";`)).toHaveLength(0);
  });

  it("does not flag unrelated db imports", async () => {
    expect(await restrictedImportErrors("app/page.tsx", `import { forProfile } from "@/lib/db/accessor";`)).toHaveLength(0);
  });
});
