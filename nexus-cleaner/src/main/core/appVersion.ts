/**
 * App version resolution.
 *
 * `app.getVersion()` returns Electron's own version when the app is launched
 * from a script instead of a packaged bundle, which produced a confusing
 * header version during development. This pure helper keeps that decision
 * testable and out of the main entry point.
 */
export const FALLBACK_VERSION = '1.0.0'

export function resolveAppVersion(reported: string | undefined, electronVersion: string | undefined): string {
  if (!reported || reported.trim().length === 0) return FALLBACK_VERSION
  if (electronVersion && reported === electronVersion) return FALLBACK_VERSION
  return reported
}
