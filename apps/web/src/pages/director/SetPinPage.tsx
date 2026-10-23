import { useNavigate } from 'react-router-dom'
import { PinSheet } from '@/components/setup/SecuritySheets'

/** Director PIN setup: the same 4-digit payment PIN everyone has. Opens straight into the PIN sheet. */
export default function SetPinPage() {
  const nav = useNavigate()
  return (
    <div className="min-h-dvh bg-green-50 dark:bg-night-800">
      <PinSheet onClose={() => nav('/director', { replace: true })} />
    </div>
  )
}
