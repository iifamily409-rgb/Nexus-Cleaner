# NEXUS Cleaner — Build & Verification Report

**Version:** 1.0.0
**Host used for verification:** Debian 13 (x86-64), Node 20.20.2, Electron 38.8.6 under Xvfb
**Target platform:** Windows 11 x64
**UI generation:** single Home screen + "All features" drawer (sidebar removed)

> Everything in this report was measured in this workspace during the final
> pass. Anything that could not be verified here is listed in §7 instead of
> being claimed.

---

## 1. Verification summary

| Gate | Command | Result |
| --- | --- | --- |
| All tests | `npm test` | **155 passed / 0 failed** (10 files) |
| Node tests (unit + integration, real temp dirs) | `npm run test:node` | **136 passed** |
| UI tests (jsdom + Testing Library) | `npm run test:ui` | **19 passed** |
| TypeScript (main/preload/shared) | `npm run typecheck:node` | **clean** (strict, `noUncheckedIndexedAccess`) |
| TypeScript (renderer + UI tests) | `npm run typecheck:web` | **clean** (strict) |
| Production build | `npm run build` | **success** — renderer 1.15 MB JS + 49.7 kB CSS, preload 4.6 kB |
| Real Electron boot | Xvfb + production bundle | **window created, 0 console errors** |
| Feature sweep | all 10 drawer entries | **10/10 render, 0 error screens** |
| End-to-end cleanup | temp sandbox only | **324 queued → 323 removed / 1 skipped**, protected file preserved |
| Windows unpacked build | `npm run dist:win:dir` | **success** — valid `PE32+ x86-64` executable |
| Windows installer | `npm run dist:win` | **blocked in this container** (needs Wine; see §6) |

---

## 2. Navigation redesign

| Requirement | State |
| --- | --- |
| One home screen instead of the Dashboard/Quick/Smart/Deep tabs | ✅ Sidebar and `Dashboard.tsx` deleted; `page` defaults to `home` |
| Quick Scan → quick mode | ✅ |
| Smart Scan → smart mode | ✅ |
| Full Scan → deep mode, "broader analysis, not less-safe" | ✅ copy states it explicitly |
| Each button runs scan → review → confirmation → clean → results | ✅ asserted in `tests/ui/navigation.test.tsx` and in the live run |
| All Features keeps every tool reachable | ✅ 10 entries in 4 groups; all still bound to their original page + IPC |
| No feature page, service, IPC handler or setting removed | ✅ 41 IPC channels, 36 invokes all still registered |
| Consistent way back home | ✅ logo button + `← Home` + `Ctrl/⌘+H` |
| No idle/decorative animation before a real scan | ✅ 0 animated nodes in the idle tree (asserted + measured in the live app) |
| Reduced motion respected | ✅ settings toggle, `animationIntensity: off`, and `prefers-reduced-motion` media query |

`Dashboard.tsx` was **deleted** rather than left orphaned: it was unreachable
from navigation, and its content duplicated the home screen, which conflicts
with the "remove duplicate dashboard content" requirement. The one assertion it
carried (never claims FPS/boost) now lives in the navigation suite.

---

## 3. The two outstanding reliability issues

### Issue 1 — Skip reasons complete, truthful, visible, tested

Every skip site now records a reason. An automated audit walks both the cleaner
engine and the duplicate finder and asserts that no skip counter is incremented
without a paired `noteSkip(...)` call — currently **0 unpaired increments**.

Scan phase (`CategoryScanResult.skipReasons`):

`excluded file name` · `not a cache/temp file type` · `protected file type` ·
each `validateDeletionCandidate` refusal (`outside every allowlisted cleanup
root`, `matches a user exclusion`, `newer than the minimum-age filter`,
`inside a personal/document folder`, `inside a critical system location`,
`protected file type (ext)`, traversal/NUL/not-absolute …) ·
`symbolic link or reparse point (never followed)`

Cleanup phase (`DeleteResult.skipReasons`, new in this pass):

`file disappeared before deletion` · `became a symbolic link or non-regular file
after the scan` · `timestamps changed — file is now newer than the minimum-age
filter` · `locked or in use by another program` · plus every validator reason
re-checked immediately before `unlink`.

Duplicate finder (`DeleteResult.skipReasons`):

`no verified duplicate scan — run Duplicate Finder first` · `not part of a
verified duplicate group` · `inside a critical system location` · `protected file
type outside a verified duplicate group` · `the group must keep at least one
copy` · `no verified surviving copy — refusing to delete the last copy` ·
`symbolic link or non-regular file` · `file disappeared before deletion` ·
`locked or in use by another program`

Invariant: `Σ skipReasons === skipped` in both phases. This is asserted, not
assumed.

UI: the scan table shows an aggregated "Skip reasons" line, each category row
expands to its own breakdown, and the cleanup results panel now carries a
**"Why files were skipped during cleanup"** block that explicitly says
"No file was skipped — every attempted file was removed and independently
verified" when the count is zero.

**Regression tests** — `tests/integration/skipReasons.test.ts` (17 tests) using
throwaway dirs under `os.tmpdir()`:

protected types · age filter · exclusions · symbolic links · allowlist escapes ·
reconciliation invariant · aggregation helper · vanished file · file swapped for
a symlink · file rewritten newer than the filter · locked file (`EBUSY`
injected at the fs layer) · clean delete with empty reasons · duplicate paths ·
fail-closed with no scan · non-member path.

### Issue 2 — IPC failures reject instead of resolving

`registerIpcHandlers` re-throws after sanitising, so `ipcRenderer.invoke()`
rejects; messages are truncated to 600 chars and never contain a stack frame.
`safePathSchema` additionally gained an **absolute-path** check, so relative
paths are now rejected at the validation boundary rather than further in.

**Regression tests** — `tests/unit/ipcErrors.test.ts` (16 tests) driving the real
`registerIpcHandlers` against a mocked Electron bus:

- invalid: unknown mode, unknown category, traversal, NUL byte, relative path,
  empty path, non-string/absent id, malformed settings, negative age, empty
  duplicate path list → all **reject** via "Rejected by validation";
- message contains no stack frames and is ≤ 600 chars;
- valid: `app:info`, `settings:get`, `settings:set`, `clean:scan`, `clean:cancel`
  → all **resolve**;
- service failures (scan throws, clean throws, settings write fails, history read
  fails) → **reject**, and no history record is written for a failed operation.

---

## 4. Defects found and fixed

### This pass

| # | Defect | Impact | Fix |
| --- | --- | --- | --- |
| A | `DuplicateFinder.delete()` deleted the **last copy** of a group when the copy intended to survive had vanished after the scan | **Data loss**: a duplicate cleanup could erase every copy of a file | survivors are recounted on disk at deletion time, verifying size **and full SHA-256**; the deletion is refused with a reason when `< keepPerGroup` copies remain |
| B | `DuplicateFinder.delete()` with **no prior scan** deleted the requested paths outright, and with a non-empty scan it deleted paths that were never in a group | Arbitrary file deletion through the duplicate API | fails closed: without a scan result every path is refused with a reason; unverified paths are refused when a scan exists |
| C | Cleanup console reported *"N files queued"* using a list that had already been drained per category | Under-reported the approved batch (e.g. showed 4 for 8 eligible) | the queue is counted after grouping, before deletion |
| D | Overlapping/nested cleanup roots counted the same file (and its bytes) twice | Inflated the estimate the user approves; e.g. 3 files reported as 6 files / 48 KB | nested roots are collapsed per category and eligibility is deduped on canonical path |
| E | `Dashboard.tsx` orphaned after the redesign | Dead UI duplicating the home screen | removed, along with its now-unused test; its FPS/guarantee assertion was re-added to `tests/ui/navigation.test.tsx` so the guard survives |

### Earlier in this task (retained)

Header version resolution (`resolveAppVersion`) · IPC no longer imports the
Electron entry point · POSIX `/home/*` over-broad critical-path rule split into
exact vs subtree lists · cancellation by scan id during deletion ·
"Clean now" disabled at zero eligible files · `vitest.config.ts` projects ·
`compression: store` for low-memory packaging.

---

## 5. End-to-end verification (real Electron app, temp dirs only)

Every destructive run used a `mktemp -d` directory with `TMPDIR` pointed at it,
so the only folder in the deletion allowlist was the scratch dir. No user file
was ever in scope.

### 5.1 Scan → review → confirm → clean (measured in the live UI)

| Step | Observed |
| --- | --- |
| Click **Quick Scan** | analysis completes against the scratch dir |
| Review | `Eligible files 4`, `Eligible size 32.0 KB`, `Files seen 159` |
| One candidate deleted behind the app's back, then **Clean now** + OS confirm accepted | `Files removed 3` · `Bytes removed (actual) 24.0 KB` · `Disk freed (measured) 0 B` · `Skipped / failed 1 / 0` |
| Skip reasons block | `1 × file disappeared before deletion` |
| Console | `Cleanup started: 4 files queued` → `removed 3 files … 1 skipped, 0 failed` → `Verified samples: 3/3` |
| Filesystem afterwards | `thesis.docx` (protected type) survived; scratch dir emptied |

`4 queued = 3 removed + 1 skipped` reconciles exactly, which is the property
defect C used to break.

### 5.2 Larger run

324 queued → 323 removed (11.6 MB reported, 12.2 MB measured) + 1 skipped with a
stated reason; 18 emptied directories pruned; protected file preserved.

### 5.3 Safety spot-checks

| Attempt | Result |
| --- | --- |
| `mode: 'nuke'`, unknown category, `../../etc` exclusion, relative path | rejected by validation |
| file swapped for a symlink between scan and delete | skipped, link target untouched |
| file rewritten newer than the age filter between scan and delete | skipped |
| locked file (`EBUSY`) | skipped as `locked or in use by another program`, never forced |
| duplicate delete with no scan, or with a foreign path | refused with a reason; file survives |
| duplicate delete when the keeper vanished | refused; the last copy survives |
| 0 eligible files | "Clean now" disabled with an explanation |

---

## 6. Windows packaging status

| Command | Result |
| --- | --- |
| `npm run build` | ✅ |
| `npm run dist:win:dir` | ✅ `release/win-unpacked/NEXUS Cleaner.exe` — `PE32+ executable for MS Windows 10.00 (GUI), x86-64` |
| `npm run dist:win` (NSIS + portable) | ⚠️ reached the NSIS step, then failed with `spawn wine ENOENT` (Wine is not installable in this container). The partial stub it left behind was only 755 KB — the x64 payload was never embedded — so **no usable installer was produced** and the partial files were removed. |

The packaging pipeline itself is sound: the app is built, packaged and asar
integrity-updated (signing is skipped — no certificate). Only the NSIS
self-extractor step needs Wine, which is not installable in this container.

**Not verified:** the installer was never executed on Windows hardware, so
install/uninstall behaviour, shortcuts and SmartScreen are untested claims.

Produce a shippable, signed installer on Windows:

```bash
npm ci
npm run dist:win
```

Generated artefacts are **not** part of the deliverable (see §8).

---

## 7. Limitations

1. Windows-only categories (Windows temp, Delivery Optimization, Recycle Bin API,
   font cache) report `unavailable` on this host instead of inventing data.
2. `asInvoker` only — HKLM startup entries, some `%SystemRoot%\Temp` files and
   `sfc /verifyonly` need elevation; the app reports that rather than escalating.
3. Locked files are skipped, never forced.
4. Upload throughput is not measured; download throughput is opt-in.
5. Disk-health/SMART readings need privileges on Linux.
6. No per-entry Windows startup impact score exists at user level, so none is shown.
7. Scheduled-run notifications are in-app toasts only.
8. Builds are unsigned → SmartScreen warning on first run.
9. Installer compression is `store` to stay within low-memory build hosts.
10. Windows installer execution is unverified (§6).

---

## 8. Workspace size and generated output

The previous pass left large generated artefacts in the working tree. The
deliverable is the **source tree**, so these are excluded from it:

| Path | Approx. size | Status |
| --- | --- | --- |
| `node_modules/` | 607 MB | gitignored, restored with `npm ci` |
| `release/` | removed | gitignored; reproducible with `npm run dist:win`. Leftovers from the failed packaging run were deleted rather than shipped. |
| `out/` | 1.4 MB | gitignored, reproducible with `npm run build` |
| `artifacts/ui-verify/` | removed | now gitignored; regenerated by `scripts/verify-ui.cjs` |
| `*.tsbuildinfo` | 156 KB | now gitignored |

`screenshots/` (1.5 MB, 10 PNGs) is kept as the evidence referenced by
`docs/SCREENSHOTS.md`; delete it if the patch must stay minimal.

Final tree size excluding `node_modules`: **4.4 MB**, 99 files.

`.gitignore` was extended with `artifacts/` and `*.tsbuildinfo`.

---

## 9. Exact commands

```bash
npm ci                  # install pinned dependencies
npm test                # 155 tests (node + ui)
npm run test:node       # 136 tests
npm run test:ui         # 19 tests
npm run typecheck       # both projects, strict
npm run build           # production bundle into out/
npm start               # preview the built bundle
npm run dist:win        # Windows installer + portable (run on Windows)
npm run dist:win:dir    # unpacked Windows directory (works on Linux)
```

Live UI verification (needs an X server):

```bash
npm run build
Xvfb :99 -screen 0 1600x1000x24 &
DISPLAY=:99 ./node_modules/electron/dist/electron --no-sandbox scripts/verify-ui.cjs
# screenshots + results.json land in artifacts/ui-verify/ (gitignored)
```
