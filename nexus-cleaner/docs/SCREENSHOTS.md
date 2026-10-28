# Screenshots

Captured from the **production bundle** (`out/`) running under Electron 38.8.6 on
the verification host (Linux/Xvfb), by `scripts/verify-ui.cjs` — the harness
loads the built main process, drives the real renderer through real clicks and
captures the window with `webContents.capturePage()`. Nothing is mocked.

Because the host is not Windows, Windows-only categories and checks correctly
show as *unavailable* — the UI never fabricates them.

| File | Page |
| --- | --- |
| `screenshots/01-home.png` | Home — three scan actions (Quick / Smart / Full), compact live metrics, scan status + review |
| `screenshots/02-all-features.png` | All features drawer — Clean / Analyze / Manage / App |
| `screenshots/03-scan-review.png` | Home after a real Quick Scan — measured counts, zero-eligible explanation, review console |
| `screenshots/04-storage-analyzer.png` | Storage Analyzer (read-only analysis entry point) |
| `screenshots/05-system-monitor.png` | System Monitor — live process table |
| `screenshots/06-settings.png` | Settings — appearance, defaults, exclusions, security posture |
| `screenshots/07-network.png` | Network Diagnostics — measured latency, DNS timing, adapters |
| `screenshots/08-history.png` | Activity History — recorded operations only |
| `screenshots/09-e2e-cleanup.png` | Live cleanup of a scratch dir — attempted vs actual vs measured values |
| `screenshots/10-skip-reasons.png` | Cleanup results — "Why files were skipped during cleanup" with real reasons |

Reproduce:

```bash
npm run build
Xvfb :99 -screen 0 1600x1000x24 &          # any X server works
DISPLAY=:99 ./node_modules/electron/dist/electron --no-sandbox scripts/verify-ui.cjs
# screenshots + machine-readable results land in artifacts/ui-verify/
```
