/**
 * Node.js ESM loader hook that redirects lib/browser.js to our mock.
 * Usage: node --import tsx --import ./tests/helpers/register-mocks.ts --test ...
 */
import { register } from 'node:module';

register('./loader-hooks.ts', import.meta.url);
