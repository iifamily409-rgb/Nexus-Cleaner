# NEXUS Cleaner

A Windows 11 PC maintenance suite built with Electron + React + TypeScript.
Real scanning, real cleanup, real system telemetry — with a safety architecture
that refuses to guess.

> **Design rule:** every number shown in the interface is measured. Nothing is
> invented, no "boost percentage" is promised, and no deletion happens without a
> review step and an explicit confirmation.

---

## 0. Documentation

- [`docs/BUILD_REPORT.md`](docs/BUILD_REPORT.md) — verification results, defect log, packaging status, known limitations
- [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md) — screenshots of each major page

## 1. Quick start

```bash
# install exact, pinned dependencies
npm install

# run the app in development (hot reload)
npm run dev

# run every test (Node unit + integration + jsdom UI)
npm test

# type-check both sides, then produce a production bundle in out/
npm run build

# preview the production bundle
npm start
```

### Windows packaging

```bash
# NSIS installer + portable .exe (x64)
npm run dist:win

# portable only
npm run dist:win:portable

# unpacked directory (fastest; useful for smoke-testing)
npm run dist:win:dir
```

Artifacts land in `release/`:

| File | What it is |
| --- | --- |
| `NEXUS Cleaner-1.0.0-x64.exe` | NSIS installer (per-user, `asInvoker`, no elevation) |
| `NEXUS Cleaner-1.0.0-portable.exe` | Single-file portable build |
| `win-unpacked/` | Unpacked application directory |

Regenerate the icon set at any time with `npm run icons`
(Python + Pillow; writes `resources/icon-*.png` and a multi-resolution `icon.ico`).

---

## 2. Architecture

```
src/
  shared/            Contracts shared by all three processes
    types.ts         Every IPC payload type (single source of truth)
    ipc.ts           The IPC channel allowlist
    schemas.ts       zod validation for every IPC argument

  main/              Node/Electron main process — the only process with fs access
    core/
      pathSafety.ts  Deletion gate: allowlists, critical paths, exclusions, age
      walker.ts      Streaming, bounded-concurrency, symlink-safe directory walker
      concurrency.ts CancellationToken, TaskPool, mapLimit, Batcher, LRU
      recipes.ts     The ONLY definition of what each category may touch
      platform.ts    Well-known cache/temp locations per platform
      appVersion.ts  Version resolution helper
    services/
      cleanerEngine.ts        scan → delete → verify pipeline
      diskUsage.ts            statfs-based disk usage and volume enumeration
      systemMonitor.ts        CPU/RAM/disk/net/battery/process sampling
      startupManager.ts       Startup entry enumeration + controlled toggling
      browserService.ts       Browser detection (read-only)
      storageAnalyzer.ts      Treemap data + category buckets
      duplicateFinder.ts      size → 4 KiB fingerprint → SHA-256 dedupe
      systemInfo.ts           App inventory, disk health, update check, SFC
      networkDiagnostics.ts   Latency, DNS, throughput, adapter info
      settingsStore.ts        Atomic JSON persistence (settings + history)
      scheduler.ts            In-process opt-in scheduler
      appServices.ts          Composition root
    ipc/register.ts  Validated IPC handlers (reject on failure)
    index.ts         Window creation, CSP enforcement, navigation lockdown

  preload/index.ts   contextBridge surface — the only object the renderer sees
  renderer/          React 19 + Tailwind 4 + Framer Motion UI
                     (one home screen + 10 feature pages behind "All features")
```

### Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The renderer gets a fixed object of ~40 named methods. No `require`, no
  `process`, no `ipcRenderer`, no generic "run command".
- Every IPC argument is parsed with a zod schema before use; failures **reject**
  the call (a failed operation can never look like a successful one).
- Strict CSP in `index.html`: `default-src 'self'`, no remote script/style/
  connect, `frame-ancestors 'none'`, `object-src 'none'`.
- Navigation and `window.open` are blocked; external https links go to the OS
  browser. `<webview>` attachment is blocked.
- No telemetry, no analytics, no API keys, no network calls except the opt-in
  download throughput test.

### The deletion gate

Every candidate file passes `validateDeletionCandidate()` **twice** — once
during analysis and again immediately before `unlink()`:

1. absolute path, no NUL byte, no `..`/`.` segment;
2. strictly inside an allowlisted category root (the root itself is never
   deletable);
3. not inside a critical system location (Windows/WinSxS/Program Files/
   ProgramData/`$Recycle.Bin`/System Volume Information …, or `/etc`, `/usr/bin`,
   `/var/lib/dpkg`, `/boot` … on POSIX);
4. not inside a personal/document folder (Documents, Downloads, Pictures, …,
   `.git`, `.ssh`, `node_modules`);
5. not an excluded path (user exclusions always win);
6. not a protected file type (`.docx`, `.pdf`, `.jpg`, `.mp4`, `.zip`, `.kdbx`,
   `.db`, source code …);
7. not newer than the age filter;
8. still a regular file — anything that became a symlink, junction or directory
   between the scan and the delete is **skipped**.

Symlinks and reparse points are never followed during a walk; they are counted
as skipped and reported.

---

## 3. Feature matrix — implemented and verified

Legend: **✅ implemented + verified** (covered by automated tests and/or an
end-to-end run in the real Electron app) · **⚠ partial** (works, but the OS
limits what is possible) · **⛔ not implemented** (deliberately, with reason).

### A. Cleanup engine

| Feature | Status | Notes |
| --- | --- | --- |
| User temp files | ✅ | `%TEMP%`, `%LOCALAPPDATA%\Temp` (POSIX: `$TMPDIR`, `/tmp`, `/var/tmp`, `~/.cache`) |
| Windows temp files | ✅ | `%SystemRoot%\Temp`, `%ProgramData%\Temp`, only what is readable without elevation |
| Application caches | ✅ | Explorer/INetCache/RDP caches, shader caches, npm/pip/yarn caches |
| Browser caches | ✅ | Chrome/Edge/Firefox/Brave/Opera/Vivaldi cache dirs only |
| Thumbnail & icon caches | ✅ | `thumbcache_*.db`, `iconcache_*.db`, `~/.cache/thumbnails` |
| Crash dumps | ✅ | `Minidump`, `CrashDumps`, WER local folders |
| Error-reporting queue | ✅ | `WER\ReportArchive`, `ReportQueue` |
| Recycle Bin | ✅ (Windows) | Emptied through `Clear-RecycleBin`, never by path. On Linux the trash folder is handled by path. |
| Delivery Optimization cache | ✅ (Windows) | Windows-only category, hidden elsewhere |
| Font cache | ✅ | Files locked by the running service are skipped |
| Diagnostic log artifacts | ✅ | Rotated logs only |
| Configurable age filter | ✅ | Hours, 0–175 200, applied at scan *and* delete time |
| Folder exclusions | ✅ | Persisted in settings, merged into every scan |
| Quick / Smart / Full / Custom modes | ✅ | Full = broader analysis, same safety rules |
| Dry-run preview | ✅ | Reports what *would* be attempted, deletes nothing |
| Bounded concurrency | ✅ | 3 categories × 8 directory walkers × 12 deletions |
| Dedupe of scan candidates | ✅ | Case-insensitive path set on Windows |
| Cancellation | ✅ | Works with the scan id or the live operation id; partial results are reported as cancelled |
| Locked files | ✅ | `EACCES`/`EPERM`/`EBUSY` → counted as skipped, never as deleted |
| Estimated vs actual vs verified bytes | ✅ | Three separate numbers, plus measured disk-free delta |

### B. Visualisation

| Feature | Status | Notes |
| --- | --- | --- |
| Home screen | ✅ | One screen: three scan buttons (Quick / Smart / Full) + compact live metrics |
| All features drawer | ✅ | Clean / Analyze / Manage / App groups; every page keeps its own backend |
| Progress indicator | ✅ | Category counts from real backend events; indeterminate when the workload is unknown |
| No idle animation | ✅ | No spinners, particles or fake file activity before a real operation starts |
| Live metrics | ✅ | CPU/RAM/disk/net from the monitor; a card is hidden when it has no real value |
| Operation console | ✅ | Every line is a genuine engine event |
| Expandable technical details | ✅ | Per-category roots, skip reasons, timings (collapsed until a scan runs) |
| Reduced motion | ✅ | Settings toggle + `animationIntensity: off` + `prefers-reduced-motion` |

### C. System optimizer

| Feature | Status | Notes |
| --- | --- | --- |
| CPU / RAM / disk / uptime | ✅ | `os.cpus()` deltas, `os.totalmem/freemem`, `statfs` |
| Disk read/write rates | ✅ (POSIX) | `/proc/diskstats`; on Windows reported as unavailable |
| Network rx/tx | ✅ | `/proc/net/dev`; Windows via `Get-NetAdapterStatistics` |
| Battery | ✅ | `Win32_Battery` on Windows, `/sys/class/power_supply` elsewhere |
| Process viewer | ✅ | Read-only, CPU + RSS, protected-process flag |
| Startup entries | ✅ | HKCU/HKLM Run, Startup folders, XDG autostart |
| Startup enable/disable | ⚠ | HKCU and user Startup folder only; HKLM refused (needs elevation) |
| Measured recommendations | ✅ | Rules over real samples; no fabricated scores |
| FPS "boost" claims | ⛔ | Never claimed — deliberately unsupported |

### D. Storage analyzer

| Feature | Status |
| --- | --- |
| Folder scan with permission | ✅ |
| Sizes, file/folder counts | ✅ |
| Largest-files list + reveal-in-folder | ✅ |
| Category breakdown by extension family | ✅ |
| Interactive squarified treemap with drill-down | ✅ |
| Sorting / filtering | ✅ |
| Exportable JSON report | ✅ |
| Automatic deletion of large files | ⛔ — review only, by design |

### E. Duplicate finder

| Feature | Status |
| --- | --- |
| Size bucketing → 4 KiB fingerprint → full SHA-256 | ✅ |
| Bounded hashing (4 concurrent streams) | ✅ |
| Review screen with keep-one-per-group selection | ✅ |
| Server-side re-verification before delete | ✅ |
| Refuses to delete the last copy of a group | ✅ |
| Protected system directories excluded | ✅ |

### F. Startup manager — see section C.

### G. Browser cleaner

| Feature | Status |
| --- | --- |
| Detection of Chrome/Edge/Firefox/Brave/Opera/Vivaldi | ✅ |
| Running-browser detection (never force-closed) | ✅ |
| Cache-only cleanup | ✅ |
| Passwords / cookies / history / autofill / bookmarks / sessions | ⛔ never touched — blocked by name *and* extension |

### H. Privacy cleaner

| Feature | Status |
| --- | --- |
| Disposable temp/diagnostic artifacts | ✅ (via the log/diagnostic categories) |
| Per-category "what exactly is removed" disclosure | ✅ |
| "Erases all online tracking / makes you anonymous" | ⛔ never claimed |

### I. Software & disk health

| Feature | Status |
| --- | --- |
| Installed-application inventory | ✅ (Windows uninstall registry keys / dpkg / .desktop) |
| Size estimates | ⚠ whatever the installer recorded; blank when absent |
| Disk free space per volume | ✅ |
| Disk health | ⚠ `Get-PhysicalDisk` on Windows; SMART needs elevation and is reported as unavailable elsewhere |
| Windows update **check** (no install) | ✅ |
| Read-only SFC verification | ✅ (`sfc /verifyonly`, requires elevation; reports that instead of auto-elevating) |
| Uninstall / partition / registry changes | ⛔ never performed |

### J. Network diagnostics

| Feature | Status |
| --- | --- |
| Adapter inventory, MAC, link speed | ✅ |
| TCP latency probe | ✅ |
| DNS resolution timing + server list | ✅ |
| Download throughput test | ✅ (opt-in, Cloudflare public endpoint) |
| Upload throughput | ⛔ not measured — would require sending data to a third party |
| Changing DNS / resetting adapters / firewall | ⛔ never |

### K. Scheduler

| Feature | Status |
| --- | --- |
| Opt-in schedule with confirmation | ✅ |
| Category allowlist, age filter, exclusions honoured | ✅ |
| Runs in-process only (no OS task registered) | ✅ by design |
| Notifications | ⚠ in-app toast; OS notifications are not wired |
| "Run once now" | ✅ |

### L. History & reports

| Feature | Status |
| --- | --- |
| Recorded scans/cleanups with before/after disk | ✅ |
| Estimated vs actual vs independently verified bytes | ✅ |
| Skipped counts, errors, cancellation flag | ✅ |
| Local JSON storage with retention pruning | ✅ |
| Export to JSON or CSV | ✅ |
| Fabricated entries | ⛔ impossible — history is written only by real operations |

---

## 4. Testing

```
npm test              # 155 tests: node (unit + integration) and ui (jsdom)
npm run test:node     # 136 tests
npm run test:ui       # 19 tests
npm run typecheck     # strict TS, both projects
```

| Suite | File | What it proves |
| --- | --- | --- |
| Path safety | `tests/unit/pathSafety.test.ts` | traversal/NUL rejection, allowlist containment, critical paths, exclusions, age filter, protected extensions |
| Concurrency | `tests/unit/concurrency.test.ts` | bounded pools, cancellation, batching, LRU, scheduler next-run math |
| IPC validation | `tests/unit/schemas.test.ts` | hostile payloads rejected, channel allowlist has no wildcards/generic exec |
| IPC error propagation | `tests/unit/ipcErrors.test.ts` | handlers **reject** on failure, messages bounded, no stack leaks, valid calls still resolve |
| Startup risk | `tests/unit/startupRisk.test.ts` | security components flagged critical, concurrency clamps |
| Walker | `tests/integration/cleaner.test.ts` | streaming, symlink skipping, cancellation, depth limits |
| Engine | `tests/integration/cleaner.test.ts` | scan/deleted/skip semantics, age filter, exclusions, symlink swap, missing files, dry run, timings |
| Skip reasons | `tests/integration/skipReasons.test.ts` | **every** skipped file has a counted reason in scan *and* cleanup, including symlinks, exclusions, age filter, vanished/changed files and locked files; `Σ reasons === skipped`; overlapping roots counted once |
| Duplicate survivors | `tests/integration/dupSurvivor.test.ts` | last copy is never deleted when the keeper vanished; content-verified survivors; unverified paths refused |
| Duplicates | `tests/integration/cleaner.test.ts` | real hashing, same-size-different-content, keep-last-copy refusal |
| Storage | `tests/integration/cleaner.test.ts` | accurate sizes, category buckets, system-root refusal |
| Persistence | `tests/integration/cleaner.test.ts` | atomic writes, corrupted-file fallback, history prune/clear |
| UI flow | `tests/ui/cleanFlow.test.tsx` | scan → preview → confirm → results, declined confirmation does nothing, failures surface, dry run, real numbers rendered, skip reasons shown after cleanup |
| Navigation | `tests/ui/navigation.test.tsx` | three scan actions only, each starts its real mode, zero-eligible disables cleanup, All-Features drawer lists and opens every feature, back-home, no idle animation |

**No test ever touches a real user folder.** Every integration test creates its
own `mkdtemp` sandbox; the engine is given an injected recipe pointing only at
that sandbox. Destructive behaviour is verified by file *counts* inside the
sandbox and by asserting that an "outside" file survives.

### End-to-end verification in the real application

Run under Xvfb against the production bundle (`out/`) with all operations
pointed at `~/.cache/nexus-e2e`:

- the home screen plus all 10 "All features" destinations render, no empty
  pages, zero renderer console errors;
- real scan → review → confirmed clean of a `mktemp` scratch dir:
  324 files queued → 323 removed (11.6 MB actual / 12.2 MB measured) + 1 skipped
  with a stated reason; protected `.docx` preserved; `queued = removed + skipped`
  reconciles exactly;
- skip reasons surfaced: `99 × not a cache/temp file type`,
  `65 × newer than the minimum-age filter`, `6 × outside every allowlisted cleanup root`;
- cleanup-time skip reasons surfaced (`1 × file disappeared before deletion`);
- hostile payloads rejected: bad mode, `../../etc` exclusion, unknown category,
  `/` as a storage/duplicate root, invalid settings, unknown scan id;
- renderer sandbox confirmed: `window.require`, `window.process`,
  `window.ipcRenderer` are all `undefined`;
- cancellation during deletion: 228 files removed, `cancelled: true`, reported
  totals consistent with per-category results;
- settings round-trip persisted across the IPC boundary.

---

## 5. Performance notes

- Directory walks stream through a callback: memory stays flat regardless of
  tree size (verified with 400+ file sandboxes and real cache folders).
- Concurrency is bounded at three levels: categories (3), walkers (8), deletions
  (12). Hashing is capped at 4 streams.
- File metadata (`lstat`) is read once per file and reused for the size, the age
  filter and the eligibility decision.
- Progress events are throttled to ~90 ms so a slow renderer cannot stall the
  main process; the two are decoupled by design.
- Scan results are cached by id and discarded after a run, so the same tree is
  never walked twice for one cleanup.
- Scan, delete and verify are timed separately and reported separately.

---

## 6. Known limitations

1. **Windows-only features on other hosts.** On Linux/macOS the Windows-specific
   categories report `unavailable` with a reason instead of fabricating results.
   This is intentional and visible in the UI.
2. **Elevation.** The app ships with `requestedExecutionLevel: asInvoker`. HKLM
   startup entries, some `%SystemRoot%\Temp` files and `sfc /verifyonly` require
   an elevated console; the app reports that rather than auto-elevating.
3. **Locked files.** Files held open by a running application are skipped. The
   UI tells you to close the app first; nothing is force-closed.
4. **Upload throughput** is not measured (it would mean uploading data to a third
   party). Download throughput is opt-in.
5. **Disk health** on Linux needs SMART privileges; the app reports the field as
   unavailable instead of guessing.
6. **Startup impact scores.** Windows exposes no supported user-level per-entry
   boot-time impact API, so the app shows entry, publisher and command instead of
   invented scores.
7. **OS notifications** for scheduled runs are in-app toasts only.
8. **Code signing.** Builds are unsigned (`no code signing certificate
   configured`), so SmartScreen will warn on first run. Sign with
   `CSC_LINK`/`CSC_KEY_PASSWORD` in a real release pipeline.
9. **Installer compression.** `electron-builder.yml` uses `compression: store`
   so the package can be produced on CI machines with ~2 GB RAM; `normal` or
   `maximum` shrink the artifacts substantially if you have more memory.
10. **Non-Windows packaging hosts.** Installer/portable artifacts were produced
    on Linux via Wine; the payload executable was verified as `PE32+ x86-64`, but
    the installers themselves were not executed on Windows hardware here. Build
    on Windows with `npm run dist:win` before shipping.

---

## 7. Configuration files

| File | Purpose |
| --- | --- |
| `electron.vite.config.ts` | main / preload / renderer build configuration |
| `electron-builder.yml` | Windows NSIS + portable targets, icon, `asInvoker` |
| `tsconfig.json` | project references |
| `tsconfig.node.json` | strict TS for main + preload + shared + node tests |
| `tsconfig.web.json` | strict TS for renderer + UI tests (DOM libs) |
| `vitest.config.ts` | two projects: `node` (real fs) and `ui` (jsdom) |
| `scripts/gen-icon.py` | reproducible icon generator |

Settings and history are stored as JSON under Electron's `userData` directory:

- `settings.json` — theme, accent, motion, refresh interval, categories,
  exclusions, age filter, retention, schedule
- `history.json` — up to 500 records, pruned by retention days
- `reports/` — exported storage reports

---

## 8. License

MIT.
