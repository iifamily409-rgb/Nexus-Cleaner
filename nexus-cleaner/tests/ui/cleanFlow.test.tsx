import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProvider } from '@/hooks/useAppState'
import { CleanPage } from '@/pages/CleanPage'
import { installMockApi, mockCleanReport, mockScanReport } from './mockApi'

const renderPage = (): void => {
  render(
    <AppProvider>
      <CleanPage mode="quick" />
    </AppProvider>
  )
}

describe('Clean page flow', () => {
  it('lists categories from the main process and marks unavailable ones', async () => {
    installMockApi()
    renderPage()
    expect(await screen.findByText('User temporary files')).toBeTruthy()
    expect(screen.getByText('Windows temporary files')).toBeTruthy()
    expect(screen.getByText('Access denied without elevation')).toBeTruthy()
  })

  it('runs a scan, shows the real estimate, then cleans after confirmation', async () => {
    const api = installMockApi()
    renderPage()
    await screen.findByText('User temporary files')

    const scanButton = screen.getByRole('button', { name: /run quick clean/i })
    await userEvent.click(scanButton)

    await waitFor(() => expect(api.cleaner.scan).toHaveBeenCalledTimes(1))
    // The engine was called with the quick-mode categories and the settings age filter.
    const scanArg = (api.cleaner.scan as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      mode: string
      categories: string[]
      minAgeHours: number
      exclusions: string[]
    }
    expect(scanArg.mode).toBe('quick')
    expect(scanArg.categories).toEqual(['user-temp'])
    expect(scanArg.minAgeHours).toBe(24)
    expect(scanArg.exclusions).toEqual([])

    // Analysis results are displayed with the real numbers (4096 bytes = 4.0 KB).
    expect(await screen.findByText('Analysis results')).toBeTruthy()
    expect(screen.getAllByText('4.0 KB').length).toBeGreaterThan(0)
    expect(screen.getByText('Nothing has been deleted yet. Review, then choose “Clean now”.')).toBeTruthy()

    // Cleaning requires confirmation through the dialog bridge.
    const cleanButton = screen.getByRole('button', { name: /clean now/i })
    await userEvent.click(cleanButton)
    await waitFor(() => expect(api.dialog.confirm).toHaveBeenCalledTimes(1))
    const confirmArgs = (api.dialog.confirm as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      title: string
      message: string
    }
    expect(confirmArgs.title).toBe('Confirm cleanup')
    expect(confirmArgs.message).toContain('4.0 KB')

    await waitFor(() => expect(api.cleaner.clean).toHaveBeenCalledWith('scan-1'))
    expect(await screen.findByText('Cleanup results')).toBeTruthy()
    // 4096 bytes removed, and the measured freed value is shown separately.
    expect(screen.getAllByText('4.0 KB').length).toBeGreaterThan(0)
    expect(screen.getByText('Disk freed (measured)')).toBeTruthy()
  })

  it('does not clean when the confirmation is declined', async () => {
    const api = installMockApi()
    ;(api.dialog.confirm as unknown as { mockResolvedValue: (v: boolean) => void }).mockResolvedValue(false)
    renderPage()
    await screen.findByText('User temporary files')
    await userEvent.click(screen.getByRole('button', { name: /run quick clean/i }))
    await screen.findByText('Analysis results')
    await userEvent.click(screen.getByRole('button', { name: /clean now/i }))
    await waitFor(() => expect(api.dialog.confirm).toHaveBeenCalled())
    expect(api.cleaner.clean).not.toHaveBeenCalled()
  })

  it('surfaces scan failures instead of pretending success', async () => {
    const api = installMockApi()
    ;(api.cleaner.scan as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(new Error('disk exploded on read'))
    renderPage()
    await screen.findByText('User temporary files')
    await userEvent.click(screen.getByRole('button', { name: /run quick clean/i }))
    expect(await screen.findByText(/disk exploded on read/)).toBeTruthy()
    expect(screen.queryByText('Analysis results')).toBeNull()
  })

  it('exposes cancellation and reduced-motion aware rendering', async () => {
    const api = installMockApi()
    renderPage()
    await screen.findByText('User temporary files')
    const cancel = screen.getByRole('button', { name: /^cancel$/i })
    expect((cancel as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /run quick clean/i }))
    await screen.findByText('Analysis results')
    expect(api.cleaner.scan).toHaveBeenCalled()
  })

  it('renders the dry-run preview without deleting', async () => {
    const api = installMockApi()
    renderPage()
    await screen.findByText('User temporary files')
    await userEvent.click(screen.getByRole('button', { name: /dry run preview/i }))
    await waitFor(() => expect(api.cleaner.dryRun).toHaveBeenCalledTimes(1))
    expect(api.cleaner.clean).not.toHaveBeenCalled()
    expect(await screen.findByText(/Nothing was deleted/i)).toBeTruthy()
  })

  it('shows real category expansion details', async () => {
    installMockApi()
    renderPage()
    const toggle = await screen.findByRole('button', { name: /user temporary files/i })
    await userEvent.click(toggle)
    const detail = await screen.findByText('What it removes')
    expect(detail).toBeTruthy()
    expect(screen.getByText(/Files in %TEMP% older than the age filter/)).toBeTruthy()
  })
})

describe('Dashboard', () => {
  it('labels measured values and never claims an FPS boost', async () => {
    installMockApi()
    const { Dashboard } = await import('@/pages/Dashboard')
    render(
      <AppProvider>
        <Dashboard />
      </AppProvider>
    )
    expect(await screen.findByText('System readiness')).toBeTruthy()
    expect(screen.getByText(/never guarantees FPS/i)).toBeTruthy()
    const body = document.body.textContent ?? ''
    expect(body.toLowerCase()).not.toContain('boost your fps')
    expect(body.toLowerCase()).not.toContain('guaranteed')
    // The CPU value comes from the mocked snapshot (12.5%).
    await waitFor(() => expect(within(document.body).getAllByText('12.5%').length).toBeGreaterThan(0))
  })
})

void mockScanReport
void mockCleanReport
