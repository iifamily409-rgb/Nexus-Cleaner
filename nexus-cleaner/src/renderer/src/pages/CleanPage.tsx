import { CleanPanel } from '../components/CleanPanel'
import type { CleanupMode } from '@shared/types'

export function CleanPage({ mode }: { mode: CleanupMode }): React.JSX.Element {
  return <CleanPanel mode={mode} />
}
