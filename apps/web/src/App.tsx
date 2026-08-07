import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { InactivityMonitor } from '@/components/layout/InactivityMonitor'
import { MaintenancePage } from '@/components/layout/MaintenancePage'
import { useServerHealthStore } from '@/store/serverHealth.store'
import { InstantMessageTicker } from '@/components/layout/InstantMessageTicker'
import { InstallPrompt } from '@/components/layout/InstallPrompt'
import { useAuth } from '@/hooks/useAuth'
import { useNotificationsPoll } from '@/hooks/useNotificationsPoll'
import { useAuthStore } from '@/store/auth.store'
import { LogoLoader } from '@/components/ui/LogoLoader'

// ── Auth pages ────────────────────────────────────────────────────
const LoginPage    = lazy(() => import('@/pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))
const LocationConsentPage = lazy(() => import('@/pages/auth/LocationConsentPage'))
const ForgotPasswordPage  = lazy(() => import('@/pages/auth/ForgotPasswordPage'))

// ── Customer pages ────────────────────────────────────────────────
const CustomerDashboard    = lazy(() => import('@/pages/customer/DashboardPage'))
const CustomerCards        = lazy(() => import('@/pages/customer/CardsPage'))
const CustomerWallet       = lazy(() => import('@/pages/customer/WalletPage'))
const CustomerTransactions = lazy(() => import('@/pages/customer/TransactionsPage'))
const CustomerNotifications= lazy(() => import('@/pages/customer/NotificationsPage'))
const CustomerProfile      = lazy(() => import('@/pages/customer/ProfilePage'))
const ContributePage       = lazy(() => import('@/pages/customer/ContributePage'))
const CardDetailPage       = lazy(() => import('@/pages/customer/CardDetailPage'))
const WithdrawalPage       = lazy(() => import('@/pages/customer/WithdrawalPage'))

// ── Officer pages ─────────────────────────────────────────────────
const OfficerDashboard      = lazy(() => import('@/pages/officer/DashboardPage'))
const OfficerCustomers      = lazy(() => import('@/pages/officer/CustomersPage'))
const OfficerCustomerDetail = lazy(() => import('@/pages/officer/CustomerDetailPage'))
const OfficerCardDetail     = lazy(() => import('@/pages/officer/CardDetailPage'))
const OfficerWallet         = lazy(() => import('@/pages/officer/WalletPage'))
const OfficerTransactions   = lazy(() => import('@/pages/officer/TransactionsPage'))
const OfficerProfile        = lazy(() => import('@/pages/officer/ProfilePage'))
const OfficerNotifications  = lazy(() => import('@/pages/officer/NotificationsPage'))

// ── Director pages (Admin merged in — Admin role no longer has its own portal) ──
const DirectorDashboard      = lazy(() => import('@/pages/director/DashboardPage'))
const DirectorWithdrawals    = lazy(() => import('@/pages/director/WithdrawalsPage'))
const DirectorStaff          = lazy(() => import('@/pages/director/StaffPage'))
const DirectorOfficerDetail  = lazy(() => import('@/pages/director/OfficerDetailPage'))
const DirectorAllCustomers   = lazy(() => import('@/pages/director/AllCustomersPage'))
const DirectorCustomerDetail = lazy(() => import('@/pages/director/CustomerOverviewPage'))
const DirectorSettings       = lazy(() => import('@/pages/director/BusinessSettingsPage'))
const DirectorInstantMessage = lazy(() => import('@/pages/director/InstantMessagePage'))
const DirectorPromoBanners   = lazy(() => import('@/pages/director/PromoBannersPage'))
const DirectorAnalytics      = lazy(() => import('@/pages/director/AnalyticsPage'))
const DirectorReport         = lazy(() => import('@/pages/director/ReportPage'))
const DirectorAuditLog       = lazy(() => import('@/pages/director/AuditLogPage'))
const DirectorBroadcast      = lazy(() => import('@/pages/director/BroadcastPage'))
const DirectorNotifications  = lazy(() => import('@/pages/director/NotificationsPage'))
const DirectorProfile        = lazy(() => import('@/pages/director/ProfilePage'))
const DirectorMore           = lazy(() => import('@/pages/director/MorePage'))

// ── Disputes (shared across customer/officer/director — backend already
// role-filters the list, and the detail page's actions are role-aware) ──
const DisputesListPage   = lazy(() => import('@/pages/disputes/DisputesListPage'))
const DisputeDetailPage  = lazy(() => import('@/pages/disputes/DisputeDetailPage'))

const PageLoader = () => (
  <div className="min-h-dvh flex items-center justify-center bg-surface dark:bg-night-800">
    <LogoLoader />
  </div>
)

export default function App() {
  const { signOut } = useAuth()
  useNotificationsPoll()
  const { isAuthenticated } = useAuthStore()
  const { isDown } = useServerHealthStore()

  if (isDown) return <MaintenancePage />

  return (
    <>
      <InactivityMonitor isAuthenticated={isAuthenticated} onLogout={signOut} />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* ── Public ── */}
          <Route path="/" element={<Navigate to="/auth/login" replace />} />
          <Route path="/auth/login"    element={<LoginPage />} />
          <Route path="/auth/register" element={<RegisterPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/location-consent" element={<AuthGuard allowedRoles={['customer']}><LocationConsentPage /></AuthGuard>} />

          {/* ── Customer ── */}
          <Route path="/customer/dashboard"     element={<AuthGuard allowedRoles={['customer']}><CustomerDashboard /></AuthGuard>} />
          <Route path="/customer/cards"         element={<AuthGuard allowedRoles={['customer']}><CustomerCards /></AuthGuard>} />
          <Route path="/customer/wallet"        element={<AuthGuard allowedRoles={['customer']}><CustomerWallet /></AuthGuard>} />
          <Route path="/customer/wallet/transactions" element={<AuthGuard allowedRoles={['customer']}><CustomerTransactions /></AuthGuard>} />
          <Route path="/customer/notifications" element={<AuthGuard allowedRoles={['customer']}><CustomerNotifications /></AuthGuard>} />
          <Route path="/customer/profile"       element={<AuthGuard allowedRoles={['customer']}><CustomerProfile /></AuthGuard>} />
          <Route path="/customer/cards/:cardId/contribute" element={<AuthGuard allowedRoles={['customer']}><ContributePage /></AuthGuard>} />
          <Route path="/customer/cards/:cardId" element={<AuthGuard allowedRoles={['customer']}><CardDetailPage /></AuthGuard>} />
          <Route path="/customer/withdrawals/new"          element={<AuthGuard allowedRoles={['customer']}><WithdrawalPage /></AuthGuard>} />
          <Route path="/customer/disputes"      element={<AuthGuard allowedRoles={['customer']}><DisputesListPage /></AuthGuard>} />

          {/* ── Officer ── */}
          <Route path="/officer/dashboard"      element={<AuthGuard allowedRoles={['officer']}><OfficerDashboard /></AuthGuard>} />
          <Route path="/officer/customers"      element={<AuthGuard allowedRoles={['officer']}><OfficerCustomers /></AuthGuard>} />
          <Route path="/officer/customers/:customerId" element={<AuthGuard allowedRoles={['officer']}><OfficerCustomerDetail /></AuthGuard>} />
          <Route path="/officer/customers/:customerId/cards/:cardId" element={<AuthGuard allowedRoles={['officer']}><OfficerCardDetail /></AuthGuard>} />
          <Route path="/officer/wallet"         element={<AuthGuard allowedRoles={['officer']}><OfficerWallet /></AuthGuard>} />
          <Route path="/officer/wallet/transactions" element={<AuthGuard allowedRoles={['officer']}><OfficerTransactions /></AuthGuard>} />
          <Route path="/officer/notifications"  element={<AuthGuard allowedRoles={['officer']}><OfficerNotifications /></AuthGuard>} />
          <Route path="/officer/profile"        element={<AuthGuard allowedRoles={['officer']}><OfficerProfile /></AuthGuard>} />
          <Route path="/officer/disputes"       element={<AuthGuard allowedRoles={['officer']}><DisputesListPage /></AuthGuard>} />

          {/* ── Director (Admin fused in) ── */}
          <Route path="/director/dashboard"       element={<AuthGuard allowedRoles={['director']}><DirectorDashboard /></AuthGuard>} />
          <Route path="/director/withdrawals"     element={<AuthGuard allowedRoles={['director']}><DirectorWithdrawals /></AuthGuard>} />
          <Route path="/director/staff"           element={<AuthGuard allowedRoles={['director']}><DirectorStaff /></AuthGuard>} />
          <Route path="/director/officers/:officerId" element={<AuthGuard allowedRoles={['director']}><DirectorOfficerDetail /></AuthGuard>} />
          <Route path="/director/customers"       element={<AuthGuard allowedRoles={['director']}><DirectorAllCustomers /></AuthGuard>} />
          <Route path="/director/customers/:customerId" element={<AuthGuard allowedRoles={['director']}><DirectorCustomerDetail /></AuthGuard>} />
          <Route path="/director/settings"        element={<AuthGuard allowedRoles={['director']}><DirectorSettings /></AuthGuard>} />
          <Route path="/director/instant-message" element={<AuthGuard allowedRoles={['director']}><DirectorInstantMessage /></AuthGuard>} />
          <Route path="/director/promo-banners"   element={<AuthGuard allowedRoles={['director']}><DirectorPromoBanners /></AuthGuard>} />
          <Route path="/director/analytics"       element={<AuthGuard allowedRoles={['director']}><DirectorAnalytics /></AuthGuard>} />
          <Route path="/director/report"          element={<AuthGuard allowedRoles={['director']}><DirectorReport /></AuthGuard>} />
          <Route path="/director/audit-log"       element={<AuthGuard allowedRoles={['director']}><DirectorAuditLog /></AuthGuard>} />
          <Route path="/director/broadcast"       element={<AuthGuard allowedRoles={['director']}><DirectorBroadcast /></AuthGuard>} />
          <Route path="/director/notifications"   element={<AuthGuard allowedRoles={['director']}><DirectorNotifications /></AuthGuard>} />
          <Route path="/director/profile"         element={<AuthGuard allowedRoles={['director']}><DirectorProfile /></AuthGuard>} />
          <Route path="/director/more"            element={<AuthGuard allowedRoles={['director']}><DirectorMore /></AuthGuard>} />
          <Route path="/director/disputes"        element={<AuthGuard allowedRoles={['director']}><DisputesListPage /></AuthGuard>} />

          {/* ── Disputes detail — one shared route, all three roles ── */}
          <Route path="/disputes/:disputeId" element={<AuthGuard allowedRoles={['customer', 'officer', 'director']}><DisputeDetailPage /></AuthGuard>} />

          {/* ── Fallback ── */}
          <Route path="*" element={<Navigate to="/auth/login" replace />} />
        </Routes>
      </Suspense>

      {/* Scrolling ticker — pinned above the bottom nav on every authenticated page, every role */}
      {isAuthenticated && <InstantMessageTicker />}
      {isAuthenticated && <InstallPrompt />}
    </>
  )
}
