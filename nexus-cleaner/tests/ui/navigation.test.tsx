import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { AppProvider } from '@/hooks/useAppState'
import { FEATURES } from '@/lib/navigation'
import { installMockApi, mockScanReport } from './mockApi'

const renderApp = (): void => {
  render(
    <AppProvider>
      <App />
    </AppProvider>
  )
}

/** The three primary actions must be the only entry points to a scan. */
describe('Home screen scan actions', () => {
  it('replaces the old tab navigation with exactly three scan buttons', async () => {
    installMockApi()
    renderApp()

    expect(await screen.findByRole('heading', { name: 'NEXUS Cleaner' })).toBeTruthy()
    const actions = await screen.findAllByRole('button', { name: /^(Quick Scan|Smart Scan|Full Scan)/i })
    expect(actions).toHaveLength(3)
    expect(actions.map((a) => a.getAttribute('data-scan-action'))).toEqual(['quick', 'smart', 'deep'])

    // No sidebar / legacy tab labels left behind.
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.queryByText('Deep Analysis')).toBeNull()
    expect(screen.queryByText('Quick Clean')).toBeNull()
  })

  it('does not animate before a real scan starts', async () => {
    installMockApi()
    const { container } = render(
      <AppProvider>
        <App />
      </AppProvider>
    )
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    // Nothing in the idle tree may carry an infinite/decorative animation class.
    const animated = container.querySelectorAll('[class*="animate-spin"], [class*="nx-anim"], [class*="nx-scanlines"]')
    expect(animated).toHaveLength(0)
  })

  it('Quick Scan starts the real quick-mode workflow through the bridge', async () => {
    const api = installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    await userEvent.click(screen.getByRole('button', { name: /^Quick Scan/i }))

    await waitFor(() => expect(api.cleaner.scan).toHaveBeenCalledTimes(1))
    const arg = (api.cleaner.scan as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      mode: string
      categories: string[]
      minAgeHours: number
      dryRun: boolean
    }
    expect(arg.mode).toBe('quick')
    expect(arg.categories).toEqual(['user-temp'])
    expect(arg.minAgeHours).toBe(24)
    expect(arg.dryRun).toBe(false)

    // Real review numbers from the fake engine, and the explicit confirmation step.
    expect(await screen.findByText('Analysis results')).toBeTruthy()
    expect(screen.getAllByText('4.0 KB').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /clean now/i })).toBeTruthy()
  })

  it('Smart Scan and Full Scan request their own modes', async () => {
    const api = installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    await userEvent.click(screen.getByRole('button', { name: /^Smart Scan/i }))
    await waitFor(() => expect(api.cleaner.scan).toHaveBeenCalledTimes(1))
    expect((api.cleaner.scan as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toMatchObject({ mode: 'smart' })

    await userEvent.click(screen.getByRole('button', { name: /^Full Scan/i }))
    await waitFor(() => expect(api.cleaner.scan).toHaveBeenCalledTimes(2))
    expect((api.cleaner.scan as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]?.[0]).toMatchObject({ mode: 'deep' })
  })

  it('disables cleanup and explains why when nothing is eligible', async () => {
    const api = installMockApi()
    // Same bridge, but this engine legitimately finds nothing to delete.
    ;(api.cleaner.scan as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(async () => ({
      ...mockScanReport,
      categories: mockScanReport.categories.map((c) => ({ ...c, eligibleFiles: 0, eligibleBytes: 0, sample: [] })),
      totalEligibleFiles: 0,
      totalEligibleBytes: 0
    }))

    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })
    await userEvent.click(screen.getByRole('button', { name: /^Quick Scan/i }))

    const cleanButton = await screen.findByRole('button', { name: /clean now/i })
    await waitFor(() => expect((cleanButton as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getAllByText(/no file passed the safety checks|nothing qualified under the current rules/i).length).toBeGreaterThan(0)
  })

  it('never claims a speed boost, FPS gain or guarantee', async () => {
    installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })
    const body = (document.body.textContent ?? '').toLowerCase()
    expect(body).not.toContain('boost your fps')
    expect(body).not.toContain('guaranteed')
    expect(body).not.toContain('faster pc')
    // The section that used to carry this promise is gone, so assert the
    // replacement guard: every metric shown is labelled and unit-bearing.
    for (const card of Array.from(document.querySelectorAll('[data-metric]'))) {
      expect(card.textContent ?? '').not.toMatch(/\bboost\b|\bfps\b/i)
    }
  })

  it('shows only metrics backed by a real snapshot', async () => {
    installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    // The mocked monitor stream has not emitted yet, so no metric card may claim a value.
    const cards = document.querySelectorAll('[data-metric]')
    for (const card of Array.from(cards)) {
      expect(card.textContent).not.toContain('—')
    }
  })
})

describe('All features drawer', () => {
  it('lists every existing feature in its group and keeps them reachable', async () => {
    installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    await userEvent.click(screen.getByTestId('all-features-button'))
    const drawer = await screen.findByTestId('all-features-drawer')

    for (const feature of FEATURES) {
      expect(within(drawer).getByText(feature.label)).toBeTruthy()
    }
    for (const group of ['Clean', 'Analyze', 'Manage', 'App']) {
      expect(within(drawer).getByRole('heading', { name: group })).toBeTruthy()
    }
    expect(within(drawer).getAllByRole('button').length).toBeGreaterThanOrEqual(FEATURES.length)
  })

  it('opens a feature page and offers a consistent way back home', async () => {
    installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    await userEvent.click(screen.getByTestId('all-features-button'))
    const drawer = await screen.findByTestId('all-features-drawer')
    await userEvent.click(within(drawer).getByText('Settings'))

    // The drawer closes and the original Settings page (with its own sections) renders.
    await waitFor(() => expect(screen.queryByTestId('all-features-drawer')).toBeNull())
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()

    await userEvent.click(screen.getByTestId('back-home-button'))
    expect(await screen.findByRole('heading', { name: 'NEXUS Cleaner' })).toBeTruthy()
  })

  it('closes on Escape without changing page', async () => {
    installMockApi()
    renderApp()
    await screen.findByRole('heading', { name: 'NEXUS Cleaner' })

    await userEvent.click(screen.getByTestId('all-features-button'))
    await screen.findByTestId('all-features-drawer')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('all-features-drawer')).toBeNull())
    expect(screen.getByRole('heading', { name: 'NEXUS Cleaner' })).toBeTruthy()
  })
})
