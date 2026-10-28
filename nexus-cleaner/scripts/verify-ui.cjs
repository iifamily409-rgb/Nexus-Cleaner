// UI verification harness: loads the *built* main process exactly as the packaged app does, then drives
// the real renderer UI through Electron's own automation instead of a mock.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const OUT = path.join(__dirname, '..')
const ART = path.join(OUT, 'artifacts/ui-verify')
require('node:fs').mkdirSync(ART, { recursive: true })
const log = (...a) => console.log('[drive]', ...a)
const results = { steps: [], errors: [], shots: [] }

async function main() {
  require(path.join(OUT, 'out/main/index.js'))
  await app.whenReady()
  await new Promise((r) => setTimeout(r, 1500))
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('no window created')
  const wc = win.webContents
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2) results.errors.push(message)
  })

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const js = (code) => wc.executeJavaScript(code, true)

  await wait(2500)
  results.steps.push({ check: 'title', value: await js('document.title') })
  results.steps.push({ check: 'h1', value: await js('document.querySelector("h1")?.textContent || null') })
  results.steps.push({
    check: 'scan buttons',
    value: await js('[...document.querySelectorAll("[data-scan-action]")].map(e => e.getAttribute("data-scan-action") + ":" + e.textContent.trim().slice(0,12))')
  })
  results.steps.push({
    check: 'idle animated nodes',
    value: await js('document.querySelectorAll(".animate-spin, [class*=nx-anim]").length')
  })
  results.steps.push({ check: 'legacy nav present', value: await js('!!document.querySelector("aside nav")') })
  results.steps.push({ check: 'metric cards', value: await js('[...document.querySelectorAll("[data-metric]")].map(e=>e.textContent)') })

  const shot = async (name) => {
    const img = await wc.capturePage()
    const p = path.join(ART, name)
    fs.writeFileSync(p, img.toPNG())
    results.shots.push(p)
  }
  await shot('01-home.png')

  // Open the All Features drawer through a real click.
  await js(`document.querySelector('[data-testid="all-features-button"]').click()`)
  await wait(400)
  results.steps.push({
    check: 'drawer opens',
    value: await js(`(() => {
      const d = document.querySelector('[data-testid="all-features-drawer"]');
      if (!d) return 'missing';
      return [...d.querySelectorAll('button[data-feature-id]')].map(x => x.getAttribute('data-feature-id')).join(',');
    })()`)
  })
  await shot('02-drawer.png')

  // Navigate to a couple of feature pages and back home.
  for (const id of ['storage', 'settings', 'history', 'browser', 'duplicates', 'monitor', 'network', 'startup', 'software', 'scheduler']) {
    await js(`(() => { const b = document.querySelector('[data-testid="back-home-button"]'); if (b) b.click(); })()`)
    await wait(250)
    await js(`document.querySelector('[data-testid="all-features-button"]').click()`)
    await wait(300)
    const state = await js(`(() => {
      const d = document.querySelector('[data-testid="all-features-drawer"]');
      const b = d && d.querySelector('[data-feature-id="${id}"]');
      if (!b) return 'no-entry';
      b.click();
      return 'clicked';
    })()`)
    await wait(900)
    const settled = await js('({ h1: document.querySelector("h1")?.textContent, back: !!document.querySelector("[data-testid=\\"back-home-button\\"]"), errors: document.querySelectorAll(".nx-error, [data-error-boundary]").length })')
    results.steps.push({ check: `page ${id}`, value: { state, settled } })
    await shot(`03-${id}.png`)
  }
  await js('document.querySelector(\'[data-testid="back-home-button"]\').click()')
  await wait(600)
  results.steps.push({ check: 'back home', value: await js('document.querySelector("h1")?.textContent') })

  // Run a real Quick Scan through the UI and wait for the review state.
  await js('document.querySelector(\'[data-scan-action="quick"]\').click()')
  let phase = null
  for (let i = 0; i < 60; i++) {
    await wait(500)
    phase = await js(`(() => {
      const chip = [...document.querySelectorAll('.nx-chip')].map(e=>e.textContent.trim());
      const cleanBtn = [...document.querySelectorAll('button')].find(b => /clean now/i.test(b.textContent||''));
      return { chips: chip, cleanDisabled: cleanBtn ? cleanBtn.disabled : null,
               review: !!document.body.innerText.match(/Analysis results/i),
               eligible: (document.body.innerText.match(/Eligible files\\s*\\n?\\s*([\\d,]+)/i)||[])[1] || null };
    })()`)
    if (phase.review || phase.chips.includes('Error')) break
  }
  results.steps.push({ check: 'quick scan', value: phase })
  await shot('04-scan-review.png')

  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2))
  log(JSON.stringify(results.steps, null, 1))
  app.exit(results.errors.length ? 3 : 0)
}

main().catch((err) => {
  console.error('[drive] fatal', err)
  app.exit(1)
})
