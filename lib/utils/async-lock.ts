/**
 * Simple async mutex (promise-chain lock).
 * Serializes async operations to prevent concurrent read-modify-write races.
 * @module lib/utils/async-lock
 */

export class AsyncLock {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise(r => release = r);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
