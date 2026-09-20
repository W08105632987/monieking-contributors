import { Routes, Route } from 'react-router-dom'
import LoginPage from '@/pages/LoginPage'
import VerifyOtpPage from '@/pages/VerifyOtpPage'
import OverviewPage from '@/pages/OverviewPage'
import SystemHealthPage from '@/pages/SystemHealthPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import CustomersPage from '@/pages/CustomersPage'
import CustomerDetailPage from '@/pages/CustomerDetailPage'
import OfficersPage from '@/pages/OfficersPage'
import OfficerDetailPage from '@/pages/OfficerDetailPage'
import ZonesPage from '@/pages/ZonesPage'
import DirectorsPage from '@/pages/DirectorsPage'
import ReconciliationPage from '@/pages/ReconciliationPage'
import DisputesPage from '@/pages/DisputesPage'
import BroadcastsPage from '@/pages/BroadcastsPage'
import AuditLogPage from '@/pages/AuditLogPage'
import BusinessSettingsPage from '@/pages/BusinessSettingsPage'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { Shell } from '@/components/layout/Shell'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />

      <Route path="/" element={<AuthGuard><Shell><OverviewPage /></Shell></AuthGuard>} />
      <Route path="/system-health" element={<AuthGuard><Shell><SystemHealthPage /></Shell></AuthGuard>} />
      <Route path="/analytics" element={<AuthGuard><Shell><AnalyticsPage /></Shell></AuthGuard>} />
      <Route path="/customers" element={<AuthGuard><Shell><CustomersPage /></Shell></AuthGuard>} />
      <Route path="/customers/:id" element={<AuthGuard><Shell><CustomerDetailPage /></Shell></AuthGuard>} />
      <Route path="/officers" element={<AuthGuard><Shell><OfficersPage /></Shell></AuthGuard>} />
      <Route path="/officers/:id" element={<AuthGuard><Shell><OfficerDetailPage /></Shell></AuthGuard>} />
      <Route path="/zones" element={<AuthGuard><Shell><ZonesPage /></Shell></AuthGuard>} />
      <Route path="/directors" element={<AuthGuard><Shell><DirectorsPage /></Shell></AuthGuard>} />
      <Route path="/reconciliation" element={<AuthGuard><Shell><ReconciliationPage /></Shell></AuthGuard>} />
      <Route path="/disputes" element={<AuthGuard><Shell><DisputesPage /></Shell></AuthGuard>} />
      <Route path="/broadcasts" element={<AuthGuard><Shell><BroadcastsPage /></Shell></AuthGuard>} />
      <Route path="/audit-log" element={<AuthGuard><Shell><AuditLogPage /></Shell></AuthGuard>} />
      <Route path="/settings" element={<AuthGuard><Shell><BusinessSettingsPage /></Shell></AuthGuard>} />
    </Routes>
  )
}
