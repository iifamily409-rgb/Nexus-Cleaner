import fs from 'node:fs/promises'
import path from 'node:path'
import { browserRecipes, pathExists } from '../core/platform'
import type { BrowserInfo } from '@shared/types'
import { execFile } from 'node:child_process'

/**
 * Browser detection. Read-only: this module never deletes anything.
 * Cache deletion is routed through the standard cleaner recipes, which block
 * Cookies / Login Data / History / Bookmarks by name.
 */

export class BrowserService {
  private runningCache: { at: number; names: Set<string> } = { at: 0, names: new Set() }

  async runningProcesses(): Promise<Set<string>> {
    if (Date.now() - this.runningCache.at < 5000) return this.runningCache.names
    const names = new Set<string>()
    try {
      if (process.platform === 'win32') {
        const output = await new Promise<string>((resolve) => {
          execFile(
            'tasklist.exe',
            ['/FO', 'CSV', '/NH'],
            { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout) => resolve(err ? '' : stdout)
          )
        })
        for (const line of output.split(/\r?\n/)) {
          const match = /^"([^"]+)"/.exec(line.trim())
          if (match?.[1]) names.add(match[1].toLowerCase())
        }
      } else {
        const entries = await fs.readdir('/proc')
        for (const entry of entries) {
          if (!/^\d+$/.test(entry)) continue
          try {
            const comm = await fs.readFile(`/proc/${entry}/comm`, 'utf8')
            names.add(comm.trim().toLowerCase())
          } catch {
            /* gone */
          }
        }
      }
    } catch {
      /* leave empty */
    }
    this.runningCache = { at: Date.now(), names }
    return names
  }

  async list(): Promise<BrowserInfo[]> {
    const running = await this.runningProcesses()
    const results: BrowserInfo[] = []
    for (const recipe of browserRecipes()) {
      const caches: BrowserInfo['cachePaths'] = []
      const profilePaths = new Set<string>()
      for (const cache of recipe.cachePaths) {
        const exists = await pathExists(cache.path)
        caches.push({ path: cache.path, label: cache.label, exists })
        if (exists) profilePaths.add(path.dirname(cache.path))
      }
      const detected = caches.some((c) => c.exists)
      results.push({
        id: recipe.id,
        name: recipe.name,
        detected,
        running: recipe.processNames.some((p) => running.has(p.toLowerCase())),
        profileDataPaths: [...profilePaths],
        cachePaths: caches,
        supported: detected && process.platform === 'win32'
      })
    }
    return results
  }
}
