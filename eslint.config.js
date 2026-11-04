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
  {
    // Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, which would bake one
    // deployment's value into the image every self-hoster runs (prd.md §17, roadmap Q5).
    // All config is read at runtime on the server, so the prefix has no legitimate use.
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_/]",
          "MemberExpression[object.object.name='process'][object.property.name='env'][property.value=/^NEXT_PUBLIC_/]",
        ].map((selector) => ({
          selector,
          message:
            "NEXT_PUBLIC_* is inlined into the build (roadmap Q5). Read a server-only variable at runtime instead.",
        })),
      ],
    },
  },
];

export default config;
