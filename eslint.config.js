import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// The owner-role database handle bypasses Row Level Security (docs/prd.md §12, §19).
// Only lib/db/ itself and the audited bootstrap paths listed here may import it.
// Adding an entry is a review event: name the file, not a folder or a glob.
export const UNSAFE_DB_ALLOWLIST = [
  // M2: signup seed / new-profile creation
  // M8: invitation acceptance
  // migration and seed scripts
];

export const UNSAFE_DB_IMPORT = String.raw`(^|/)db/unsafe(\.ts)?$`;

const config = [
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    ignores: ["lib/db/**", ...UNSAFE_DB_ALLOWLIST],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: UNSAFE_DB_IMPORT,
              message:
                "lib/db/unsafe bypasses tenant isolation (prd.md §12). Use the profile-scoped accessor, or add this file to UNSAFE_DB_ALLOWLIST in eslint.config.js with a reviewer.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
