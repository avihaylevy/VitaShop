/**
 * 🔴 THE ONE LOCAL-ONLY GUARD, SHARED — extracted at ISSUE-083 when a second
 * seed script needed it.
 *
 * Copying it would have put two refusals in the codebase that must agree about
 * which database is safe to write to, in a project whose seed both creates rows
 * and SOFT-DELETES them. A drift between two copies would not be a wrong price;
 * it would be a script that agrees to run somewhere it should not.
 *
 * ⚠️ Credentials are parsed but NEVER logged.
 */
export function assertLocalDevTarget(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL is not set. Refusing to seed.')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL. Refusing to seed.')
  }
  const host = url.hostname
  const database = url.pathname.replace(/^\//, '')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (!isLocalHost) {
    throw new Error(
      `DATABASE_URL host is "${host}", not localhost/127.0.0.1. Refusing to seed a non-local target.`,
    )
  }
  if (database !== 'vitashop_dev') {
    throw new Error(
      `DATABASE_URL database is "${database}", not "vitashop_dev". Refusing to seed an unexpected database.`,
    )
  }
  console.log(`Target confirmed: ${host}:${url.port || '5432'}/${database} (credentials not shown)`)
}
