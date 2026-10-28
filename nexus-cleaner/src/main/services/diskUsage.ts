import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { DiskUsage } from '@shared/types'

/**
 * Real disk usage via statfs. On Windows, Node maps `fs.statfs` to
 * GetDiskFreeSpaceExW, which reports usable free space (quota-aware).
 */

export async function getDiskUsage(target?: string): Promise<DiskUsage | null> {
  const probe = target ?? (process.platform === 'win32' ? (process.env.SystemDrive ?? 'C:') + '\\' : '/')
  try {
    const stats = await fs.statfs(probe)
    const blockSize = Number(stats.bsize)
    const totalBytes = Number(stats.blocks) * blockSize
    const freeBytes = Number(stats.bavail) * blockSize
    const usedBytes = Math.max(0, totalBytes - freeBytes)
    return {
      mount: probe,
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
    }
  } catch {
    return null
  }
}

export interface VolumeInfo {
  mount: string
  label: string
  totalBytes: number
  freeBytes: number
  usedPercent: number
  fsType: string
}

/** Enumerates mounted volumes, best effort and fast. */
export async function listVolumes(): Promise<VolumeInfo[]> {
  const out: VolumeInfo[] = []
  try {
    if (process.platform === 'win32') {
      const drives = await windowsDriveLetters()
      for (const drive of drives) {
        const usage = await getDiskUsage(drive)
        if (usage) {
          out.push({
            mount: drive,
            label: drive,
            totalBytes: usage.totalBytes,
            freeBytes: usage.freeBytes,
            usedPercent: usage.usedPercent,
            fsType: 'unknown'
          })
        }
      }
      return out
    }
    const mounts = await posixMountPoints()
    for (const mount of mounts) {
      const usage = await getDiskUsage(mount)
      if (usage && usage.totalBytes > 0) {
        out.push({
          mount,
          label: mount,
          totalBytes: usage.totalBytes,
          freeBytes: usage.freeBytes,
          usedPercent: usage.usedPercent,
          fsType: 'unknown'
        })
      }
    }
  } catch {
    /* best effort */
  }
  return out
}

async function windowsDriveLetters(): Promise<string[]> {
  // Logical drives come from the OS, not from guessing.
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const fallback: string[] = []
          for (let i = 67; i <= 90; i++) fallback.push(`${String.fromCharCode(i)}:\\`)
          fallback.unshift(`${process.env.SystemDrive ?? 'C:'}\\`)
          resolve([...new Set(fallback)])
          return
        }
        resolve(
          stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => /^[A-Za-z]:\\$/.test(s))
        )
      }
    )
  })
}

async function posixMountPoints(): Promise<string[]> {
  try {
    const mountInfo = await fs.readFile('/proc/mounts', 'utf8')
    const lines = mountInfo.split('\n')
    const seen = new Set<string>()
    for (const line of lines) {
      const parts = line.split(' ')
      const mount = parts[1]
      const fstype = parts[2]
      if (!mount || !fstype) continue
      if (!['ext4', 'ext3', 'xfs', 'btrfs', 'vfat', 'ntfs', 'exfat', 'zfs', 'f2fs', 'overlay', 'tmpfs'].includes(fstype)) continue
      if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev')) continue
      if (mount.startsWith('/var/lib/docker')) continue
      seen.add(mount)
    }
    if (!seen.has('/')) seen.add('/')
    return [...seen].slice(0, 24)
  } catch {
    return ['/']
  }
}

/** Sums the sizes of a bounded list of paths (used for "temp folder total"). */
export async function totalDirectorySize(dir: string): Promise<number> {
  try {
    let total = 0
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      try {
        const st = await fs.lstat(full)
        if (st.isFile()) total += st.size
        else if (st.isDirectory()) total += await totalDirectorySize(full)
      } catch {
        /* skip */
      }
    }
    return total
  } catch {
    return 0
  }
}

export const homedir = (): string => os.homedir()
