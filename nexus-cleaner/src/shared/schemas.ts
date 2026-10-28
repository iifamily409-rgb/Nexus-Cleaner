import { z } from 'zod'

/**
 * Every IPC argument is validated against one of these schemas in the main process.
 * The renderer is treated as untrusted input, always.
 */

export const categoryIdSchema = z.enum([
  'user-temp',
  'windows-temp',
  'app-caches',
  'browser-cache',
  'thumbnails',
  'crash-dumps',
  'error-reports',
  'recycle-bin',
  'delivery-optimization',
  'font-cache',
  'log-artifacts'
])

export const cleanupModeSchema = z.enum(['quick', 'smart', 'deep', 'custom'])

/** Rejects NUL bytes, relative traversal noise and non-absolute paths. */
/** Drive-letter, UNC or POSIX-rooted path. Anything else is rejected outright. */
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\{2}[^\\/]+[\\/]|\/)/

export const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), { message: 'Path contains NUL byte' })
  .refine((p) => !p.includes('..'), { message: 'Path must not contain ".."' })
  .refine((p) => ABSOLUTE_PATH.test(p), { message: 'Path must be absolute' })

export const scanOptionsSchema = z.object({
  mode: cleanupModeSchema,
  categories: z.array(categoryIdSchema).max(32).optional(),
  minAgeHours: z.number().min(0).max(24 * 365 * 20),
  exclusions: z.array(safePathSchema).max(500),
  followAppSubdirs: z.boolean().optional(),
  dryRun: z.boolean().optional()
})

export const idSchema = z.string().min(1).max(200)

export const duplicateScanSchema = z.object({
  roots: z.array(safePathSchema).min(1).max(24),
  minSizeBytes: z.number().int().min(1).max(50 * 1024 * 1024 * 1024)
})

export const storageScanSchema = z.object({
  root: safePathSchema,
  maxDepth: z.number().int().min(1).max(12)
})

export const settingsPatchSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  accent: z.enum(['cyan', 'blue', 'green', 'violet']).optional(),
  animationIntensity: z.enum(['full', 'reduced', 'off']).optional(),
  reducedMotion: z.boolean().optional(),
  refreshIntervalMs: z.number().int().min(500).max(60_000).optional(),
  defaultMode: cleanupModeSchema.optional(),
  enabledCategories: z.array(categoryIdSchema).max(32).optional(),
  exclusions: z.array(safePathSchema).max(500).optional(),
  maxAgeHours: z.number().min(0).max(24 * 365 * 20).optional(),
  historyRetentionDays: z.number().int().min(1).max(3650).optional(),
  confirmDestructive: z.boolean().optional(),
  schedule: z
    .object({
      enabled: z.boolean(),
      mode: cleanupModeSchema,
      categories: z.array(categoryIdSchema).max(32),
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      notify: z.boolean(),
      maxAgeHours: z.number().min(0).max(24 * 365 * 20)
    })
    .optional()
})

export const scheduleConfigSchema = settingsPatchSchema.shape.schedule.unwrap()

export const confirmSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
  detail: z.string().max(20000),
  confirmLabel: z.string().min(1).max(60)
})

export const startupToggleSchema = z.object({
  id: idSchema,
  enabled: z.boolean()
})

export const deleteDuplicatesSchema = z.object({
  paths: z.array(safePathSchema).min(1).max(5000),
  keepPerGroup: z.number().int().min(1).max(100)
})

export type ScanOptionsInput = z.infer<typeof scanOptionsSchema>
