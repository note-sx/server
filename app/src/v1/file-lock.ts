// Serialize note mutations and expiry cleanup, including their filesystem work.
let pending: Promise<unknown> = Promise.resolve()
export async function withFileLock<T> (operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation)
  pending = result.catch(() => {})
  return result
}
