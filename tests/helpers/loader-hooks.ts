/**
 * ESM resolve hook: redirects lib/browser.js (or .ts) → tests/helpers/browser-mock.ts
 */
import { fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';

interface ResolveContext {
  parentURL?: string;
  [key: string]: any;
}

interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
}

type NextResolve = (specifier: string, context: ResolveContext) => Promise<ResolveResult>;

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<ResolveResult> {
  // Intercept any import of browser.js or browser.ts from the lib directory
  if (
    specifier === './browser.js' ||
    specifier === './browser.ts' ||
    specifier.endsWith('/lib/browser.js') ||
    specifier.endsWith('/lib/browser.ts')
  ) {
    if (context.parentURL && context.parentURL.includes('/lib/')) {
      const mockPath = pathResolve(
        fileURLToPath(import.meta.url),
        '..', 'browser-mock.ts'
      );
      return { url: `file://${mockPath}`, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
