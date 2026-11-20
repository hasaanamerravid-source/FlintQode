/**
 * Registers the loader, so that the unit tests can import the sources of the
 * project directly.
 *
 *   node --import ./scripts/register-ts.mjs --test tests/*.test.mts
 *
 * `module.register()` runs the hooks on a separate thread. That works on
 * every Node that has it (20.6 and later), unlike `registerHooks()`, which
 * only exists in newer releases.
 */
import { register } from 'node:module'

register('./ts-hook.mjs', import.meta.url)
