# Dependency security notes

Run `npm audit --omit=dev` against the committed lockfile before each release.

The September 2026 refresh removes the known Next.js proxy/authentication advisories affecting the previous 16.2.4 runtime and reduces the production audit from 16 findings (12 high) to 6 findings (5 high). The remaining reports are transitive Prisma toolchain/connector findings with no non-breaking upstream fix reported by npm at release time:

- `deepmerge-ts` is used by Prisma configuration on trusted deployment configuration, not on Mailgun request data.
- `mysql2` is pulled by the Prisma CLI used for migrations. Never connect migrations to an untrusted database endpoint or allow authentication-plugin downgrade.
- Prisma's nested MariaDB connector report has no available upstream fix. Production uses the configured local/private database endpoint and its default UTF-8 charset; do not expose MySQL publicly or use legacy multibyte client charsets.

Do not run `npm audit fix --force`: npm currently proposes downgrading Prisma across a major version. Reassess these exceptions when Prisma ships a patched supported release. Treat any database endpoint, charset or TLS topology change as requiring a fresh review.
