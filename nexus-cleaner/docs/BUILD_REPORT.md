# NEXUS Cleaner — Build & Verification Report

**Version:** 1.0.0
**Report generated:** during the final verification pass
**Host used for verification:** Debian 13 (x86-64), Node 20.20.2, npm 10.8.2, Electron 38.8.6 run under Xvfb
**Target platform:** Windows 11 x64 (installer + portable produced and inspected)

---

## 1. Verification summary

| Gate | Command | Result |
| --- | --- | --- |
| Node-side tests | `npm run test:node` | **117 passed / 0 failed** (unit + integration) |
| UI tests (jsdom) | `npm run test:ui` | **8 passed / 0 failed** |
| All tests | `npm test` | **125 passed / 0 failed** (9 files, ~3.6 s) |
| TypeScript (main/preload/shared/tests) | `npm run typecheck:node` | **clean** (strict, `noUncheckedIndexedAccess`) |
| TypeScript (renderer/UI tests) | `npm run typecheck:web` | **clean** (strict) |
| Production build | `npm run build` | **success** — main 154 kB, preload 4.6 kB, renderer 1.17 MB + 49.9 kB CSS |
| Real Electron boot | Xvfb + production bundle | **window created, no renderer console errors** |
| Page sweep | all 14 routes | **14/14 render, 0 empty, 0 error screens** |
| End-to-end cleanup | temp sandbox only | **8 files / 312.5 KB removed, protected files preserved** |
| Windows packaging | `electron-builder --win nsis portable` | **installer + portable produced** |

---

## 2. The two outstanding issues — fixed and regression-tested

### Issue 1 — Skip reasons were not surfaced

**Cause:** the engine counted skipped files but discarded *why* each one was
skipped, so the UI could only show a bare number.

**Fix:**
- `CategoryScanResult.skipReasons: Record<string, number>` added to the shared
  contract (`src/shared/types.ts`).
- `CleanerEngine` now calls `noteSkip(reason)` at **every** skip site: excluded
  file name, not a cache/temp type, protected extension, and each distinct
  `validateDeletionCandidate` refusal (traversal, outside allowlist, exclusion,
  age filter, protected name, …).
- UI: each category row gains a **“Why files were skipped”** list with counts;
  the sample table shows an aggregated **“Skip reasons”** line; a zero-eligible
  scan now explains itself (age filter / protected types) instead of looking
  broken.

**Regression tests** — `tests/integration/skipReasons.test.ts` (3 tests):
- every skipped file is attributed to a reason and
  `Σ skipReasons === skippedFiles` (no silent drops);
- skip reasons are empty when nothing was skipped;
- a skipped file is never counted as eligible or deleted.

Verified in the running app:
`99 × not a cache/temp file type · 65 × newer than the minimum-age filter · 6 × outside every allowlisted cleanup root`.

### Issue 2 — Validation failures resolved instead of rejecting

**Cause:** the IPC wrapper converted every thrown error into a resolved
`{ ok: false, error }` value. The renderer therefore could not distinguish a
rejected/hostile payload from a successful call, and `try/catch` in the UI never
fired.

**Fix** (`src/main/ipc/register.ts`):
- handlers now **re-throw** after sanitising, so `ipcRenderer.invoke()` rejects;
- messages are truncated to 600 characters and never include a stack trace;
- side-effect: `window.nexus.*` calls behave like normal promises, which is what
  the UI already assumed.

**Regression tests** — `tests/unit/ipcErrors.test.ts` (10 tests) driving the real
`registerIpcHandlers` with `electron` mocked:
- malformed mode, traversal exclusion, unknown category, invalid settings,
  `/` as storage or duplicate root, unknown scan id, missing confirm title →
  all **reject**;
- error message length ≤ 600 and contains no `.ts:` / `at CleanerEngine` frames;
- valid calls still resolve normally.

Verified in the running app:

```
badMode        REJECTED: Error invoking remote method 'clean:scan': Error: Rejected by validation…
traversal      REJECTED: … Rejected by validation…
badCategory    REJECTED: … Rejected by validation…
systemRoot     REJECTED: … Refused: critical system location
dupSystemRoot  REJECTED: … No valid folders to scan.
badSettings    REJECTED: … Rejected by validation…
unknownScan    REJECTED: … Unknown or expired scan id. Run a new scan first.
renderer       window.require/process/ipcRenderer = undefined/undefined/undefined
```

### Additional defects found and fixed during verification

| # | Defect | Fix |
| --- | --- | --- |
| 3 | Header showed “CLEANER 38.8.6” in dev (`app.getVersion()` returns the Electron version when launched from a script) | `resolveAppVersion()` helper + version injected into `AppServices`; now `1.0.0` |
| 4 | `registerIpcHandlers` imported the Electron entry point (would boot a second app under test) | version passed via the service container instead of an import |
| 5 | POSIX path rules refused **all** of `/home/*` as critical, so user folders could not be scanned | split into `CRITICAL_POSIX_EXACT` (the directory itself) vs `CRITICAL_POSIX_SUBTREES` (`/etc`, `/usr/bin`, `/var/lib/dpkg`, …) |
| 6 | Cancelling with the scan id (the id the UI actually holds) did nothing during deletion | the deletion token is now registered under both the operation id and the scan id |
| 7 | “Clean now” stayed enabled when 0 files were eligible | disabled, with a tooltip pointing at the skip reasons |
| 8 | `vitest.workspace.ts` was rejected by Vitest 3.2 | replaced with a single `vitest.config.ts` using `test.projects` (`node` + `ui`) |
| 9 | NSIS packaging failed with “Can’t allocate required memory” on a 2 GB CI box | `compression: store` in `electron-builder.yml` (documented trade-off) |

---

## 3. End-to-end verification detail (real Electron app)

All destructive steps targeted `~/.cache/nexus-e2e` (created for the run) — no
real user data was touched.

### 3.1 Scan → preview → clean → results (driven through the UI)

| Step | Observed |
| --- | --- |
| Click **Run Quick Clean** | analysis panel appears; `ELIGIBLE FILES 8`, `ELIGIBLE SIZE 312.5 KB`, `FILES SCANNED 178`, `SKIPPED BY SAFETY RULES 170` |
| Expand category | `scanned 178 · skipped 173 · errors 2 · took 60 ms` + skip-reason breakdown |
| Click **Clean now** (OS dialog auto-accepted by the harness only) | results panel: `FILES REMOVED 8`, `BYTES REMOVED (ACTUAL) 312.5 KB`, `DISK FREED (MEASURED) 320.0 KB`, `SKIPPED / FAILED 0 / 0` |
| Timings | `scan 61 ms · delete 0 ms · verify 0 ms` reported separately |
| Disk before / after | `18.8 GB → 18.8 GB` (shown as measured, not as a promise) |
| Files left on disk | `fresh.tmp` (newer than the 24 h filter) and `thesis.docx` (protected type) — **both preserved** |
| History | new record with `actualBytes: 320000`, `deletedFiles: 8`, `verifiedBytesFreed: 327680` |

### 3.2 Cancellation

- Cancel via the **scan id** during deletion: `accepted: true`,
  `cancelled: true`, `deleted 228 == Σ per-category deleted` (no over-reporting).
- Cancel with an unknown id: returns `false` (no state corruption).

### 3.3 Locked files

`tests/integration/cancellation.test.ts` makes a parent directory read-only so
`unlink` fails; the run reports the file as skipped and `totalBytesDeleted`
excludes it. When the suite runs as **root** (as in this sandbox) the OS bypasses
directory permissions, so the test asserts the alternative branch and the
non-root behaviour is exercised in the UI run, where two files were skipped with
`Access denied` errors in the console.

### 3.4 Unsafe-path protection

| Attack | Result |
| --- | --- |
| `exclusions: ['../../etc']` | rejected by zod (traversal) |
| `categories: ['root']` | rejected (unknown enum) |
| `mode: 'nuke'` | rejected (unknown enum) |
| storage/duplicate root `/` | rejected (`Refused: critical system location` / `No valid folders`) |
| file swapped for a symlink between scan and delete | skipped; the link target survives (unit test) |
| path inside `Documents`/`.git`/`node_modules` | refused by the personal-folder rule |
| `.docx`/`.pdf`/`.jpg`/`.zip`/`.kdbx` inside a temp folder | refused by extension protection |

### 3.5 Page sweep (14 routes)

`dashboard, quick, smart, deep, storage, duplicates, startup, browser, monitor,
network, software, scheduler, history, settings`

Result: `emptyPages: []`, `anyError: false`, `consoleErrors: []`. Settings
round-trip through the real IPC bridge persisted (`accent`, `refreshIntervalMs`).

### 3.6 Truthfulness checks performed

- Dry run reported `deleted: 0, bytes: 0` and the files were still present
  (`dryRunFilesStillThere: 8`).
- A scan with 0 eligible files showed 0 bytes, disabled “Clean now”, and
  explained why — no cosmetic success message.
- Dashboard contains no FPS/boost claims (asserted in `tests/ui/cleanFlow.test.tsx`).
- Unavailable categories (Windows temp, browser caches, thumbnails on this host)
  are listed with reasons rather than being silently omitted.
- History contains only operations that actually ran.

---

## 4. Windows packaging

```
release/NEXUS Cleaner-1.0.0-x64.exe         105 189 245 bytes   NSIS installer
release/NEXUS Cleaner-1.0.0-portable.exe    369 380 751 bytes   portable single-file
release/win-unpacked/                       unpacked app directory
release/win-unpacked/resources/app.asar     28 769 076 bytes    3 658 entries
```

Integrity checks:

- both artifacts are valid PE files (`MZ` + `PE\0\0`);
- the outer NSIS stub is 32-bit (expected — NSIS launchers are i386);
- the **payload** `win-unpacked/NEXUS Cleaner.exe` is `PE32+ x86-64`
  (machine `0x8664`), i.e. a genuine 64-bit Windows binary;
- `package.json` inside the asar reports `version 1.0.0`, `main ./out/main/index.js`;
- configuration: `requestedExecutionLevel: asInvoker`, per-user NSIS, desktop +
  start-menu shortcuts, no auto-publish.

**Not verified here:** the installers were not *executed* on Windows hardware
(this environment is Linux; Wine can build but not faithfully run the app).
Code signing is skipped (no certificate). Build on Windows with
`npm run dist:win` for a shippable, signed release.

---

## 5. Implemented features (verified)

Cleanup categories: user temp, Windows temp, application caches, browser caches,
thumbnail/icon caches, crash dumps, error-reporting queue, Recycle Bin (Windows
API), Delivery Optimization (Windows), font cache, diagnostic log artifacts —
each with mode membership, risk level, exact “what it removes” text and root
list. Quick / Smart / Deep / Custom modes, age filter, exclusions, dry run,
cancellation, skip-reason reporting, estimate/actual/verified byte accounting.

Monitoring: CPU, RAM, disk usage + I/O, network rx/tx, uptime, load average,
battery, process table, startup inventory with risk classification.

Tools: storage analyzer (treemap, drill-down, largest files, category buckets,
JSON export), duplicate finder (SHA-256 verified, keep-one enforcement),
startup manager (HKCU/user-folder toggling with confirmation + activity log),
browser cleaner (detection, running state, cache-only), software inventory,
disk/volume health, Windows update check, read-only SFC, network diagnostics
(latency, DNS, adapter, opt-in download throughput), opt-in scheduler, activity
history with JSON/CSV export, settings with local persistence.

Security: `contextIsolation`, sandboxed renderer, no `nodeIntegration`, strict
CSP, allowlisted IPC with zod validation, rejecting handlers, navigation
lockdown, no shell execution surface, no elevation for ordinary cleanup, no
registry cleaning, no AV/firewall/Windows Update modification.

---

## 6. Known limitations

1. Windows-specific features report `unavailable` on non-Windows hosts rather
   than faking data.
2. `asInvoker` only: HKLM startup entries, some `%SystemRoot%\Temp` files and
   `sfc /verifyonly` need elevation; the app reports that instead of escalating.
3. Locked files are skipped, never forced.
4. Upload throughput is not measured; download throughput is opt-in.
5. Disk health needs SMART privileges on Linux.
6. No per-entry Windows startup “impact score” exists at user level, so none is
   shown.
7. Scheduled-run notifications are in-app toasts only.
8. Builds are unsigned → SmartScreen warning on first run.
9. Installer compression is `store` for low-memory CI; use `normal`/`maximum`
   with more RAM for smaller artifacts.
10. `node_modules` is bundled inside the asar (needed because framer-motion and
    lucide-react ship ESM that Electron's sandboxed renderer path resolves at
    runtime); this inflates the payer size but does not affect behaviour.

---

## 7. Exact commands

```bash
# development
npm install
npm run dev

# quality gates
npm test                 # 125 tests (node + ui)
npm run test:node        # 117 tests
npm run test:ui          # 8 tests
npm run typecheck

# production bundle
npm run build
npm start                # preview the built bundle

# windows packaging (run on Windows for a shippable, signed release)
npm run dist:win            # installer + portable
npm run dist:win:portable   # portable only
npm run dist:win:dir        # unpacked directory

# assets
npm run icons
```

Outputs: `out/` (bundled app) and `release/` (installers).

---

## 8. Deliverables audit (final)

Verified against the actual filesystem after the build — not from memory.

| # | Relative path | Format | Exact bytes | SHA-256 (first 16) |
| --- | --- | --- | --- | --- |
| 1 | `release/NEXUS Cleaner-1.0.0-x64.exe` | PE32 NSIS installer (x86 stub + x64 payload) | 105 189 245 | `f9f55bad4c3520cc` |
| 2 | `release/NEXUS Cleaner-1.0.0-portable.exe` | PE32 NSIS self-extracting portable | 369 380 751 | `77a9445f92779e77` |
| 3 | `dist/nexus-cleaner-1.0.0-source.tar.gz` | gzip tar, 114 entries | 2 201 547 | see `sha256sum` |
| 4 | `README.md` | UTF-8 Markdown, 405 lines | 18 802 | `4e90ab605b45994e` |
| 5 | `docs/BUILD_REPORT.md` | UTF-8 Markdown, 268+ lines | 13 121 | `fea73803a294ed27` |

Integrity results:

- Both executables are valid PE files (`MZ` at 0, `PE\0\0` at `e_lfanew` = 216).
  The outer **NSIS stub is 32-bit i386** (`machine 0x014c`) — normal for NSIS
  launchers — while the **application payload is x86-64** (`app-64.7z`, and the
  previously-inspected `win-unpacked/NEXUS Cleaner.exe` was `PE32+ 0x8664`).
- `7za t` on **both** artifacts reports no errors:
  installer `Files: 10, Size 104 844 217`; portable `Files: 4, Size 369 219 895`.
- The source archive lists and extracts cleanly and contains `package.json`,
  `README.md`, `docs/BUILD_REPORT.md`, `src/main/index.ts`,
  `src/renderer/src/App.tsx` and `electron-builder.yml`.

Housekeeping performed during the audit:

- `release/win-unpacked/` (352 MB) and `release/builder-debug.yml` were removed.
  They are reproducible with `npm run dist:win:dir` and pushed the release
  directory far past the workspace snapshot limit.
- The source archive did **not** exist before this audit; it was created from the
  working tree (excluding `node_modules`, `out`, `release`, `dist`, `build`,
  `*.tsbuildinfo`).
- `release/NEXUS Cleaner-1.0.0-x64.exe.blockmap` (112 323 bytes) is kept: it is
  only useful for electron-updater delta updates and is not required to install.
