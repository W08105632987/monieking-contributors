import { lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthGuard, roleDashboard } from '@/components/layout/AuthGuard'
import { InactivityMonitor } from '@/components/layout/InactivityMonitor'
import { MaintenancePage } from '@/components/layout/MaintenancePage'
import { MaintenanceModeScreen } from '@/components/layout/MaintenanceModeScreen'
import { useMaintenanceStore } from '@/store/maintenance.store'
import { useServerHealthStore } from '@/store/serverHealth.store'
import { InstantMessageTicker } from '@/components/layout/InstantMessageTicker'
import { InstallPrompt } from '@/components/layout/InstallPrompt'
import { PushPermissionPrompt } from '@/components/layout/PushPermissionPrompt'
import { InAppNotificationBanner } from '@/components/layout/InAppNotificationBanner'
import { AnalyticsTracker } from '@/components/analytics/AnalyticsTracker'
import { useAuth } from '@/hooks/useAuth'
import { useNotificationsPoll } from '@/hooks/useNotificationsPoll'
import { useAuthStore } from '@/store/auth.store'
import { api } from '@/lib/api'
import { LogoLoader } from '@/components/ui/LogoLoader'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'
import { AppLayout } from '@/components/layout/AppLayout'
import { preloadRoleRoutes } from '@/lib/preloadRoutes'
import { PageContentSkeleton } from '@/components/ui/PageContentSkeleton'

// ── Public / marketing ──────────────────────────────────────────────
// LandingPage.tsx still exists on disk (kept for any future standalone
// marketing/SEO use) but is deliberately NOT wired into any route below
// — it was the thing flashing on screen between the splash and the
// real app on every cold PWA open. Detached entirely; "/" now behaves
// exactly like the catch-all fallback.
const TermsOfServicePage = lazy(() => import('@/pages/legal/TermsOfServicePage'))
const PrivacyPolicyPage  = lazy(() => import('@/pages/legal/PrivacyPolicyPage'))

// ── Auth pages ────────────────────────────────────────────────────
const LoginPage    = lazy(() => import('@/pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))
const LocationConsentPage = lazy(() => import('@/pages/auth/LocationConsentPage'))
const ForgotPasswordPage  = lazy(() => import('@/pages/auth/ForgotPasswordPage'))

// ── Customer pages ────────────────────────────────────────────────
const KycPage              = lazy(() => import('@/pages/kyc/KycPage'))
const CustomerDashboard    = lazy(() => import('@/pages/customer/DashboardPage'))
const CustomerCards        = lazy(() => import('@/pages/customer/CardsPage'))
const CustomerWallet       = lazy(() => import('@/pages/customer/WalletPage'))
const CustomerTransactions = lazy(() => import('@/pages/customer/TransactionsPage'))
const TransactionReceipt   = lazy(() => import('@/pages/shared/ReceiptPage'))
const OfficerFoodLedger       = lazy(() => import('@/pages/officer/FoodLedgerPage'))
const DirectorCardDetail      = lazy(() => import('@/pages/director/CardDetailPage'))
const DirectorSmsCenter       = lazy(() => import('@/pages/director/SmsCenterPage'))
const DirectorFoodOversight   = lazy(() => import('@/pages/director/FoodOversightPage'))
const DirectorFoodCloseYear   = lazy(() => import('@/pages/director/FoodCloseYearPage'))
const DirectorFoodArchives    = lazy(() => import('@/pages/director/FoodYearArchivesPage'))
const DirectorFoodArchiveOne  = lazy(() => import('@/pages/director/FoodYearArchiveDetailPage'))
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
const OfficerCustomerStats  = lazy(() => import('@/pages/officer/CustomerStatsDetailPage'))

// ── Director pages (Admin merged in — Admin role no longer has its own portal) ──
const DirectorDashboard      = lazy(() => import('@/pages/director/DashboardPage'))
const DirectorWithdrawals    = lazy(() => import('@/pages/director/WithdrawalsPage'))
const DirectorStaff          = lazy(() => import('@/pages/director/StaffPage'))
const DirectorOfficerDetail  = lazy(() => import('@/pages/director/OfficerDetailPage'))
const DirectorAllCustomers   = lazy(() => import('@/pages/director/AllCustomersPage'))
const DirectorCustomerDetail = lazy(() => import('@/pages/director/CustomerOverviewPage'))
const DirectorSettings       = lazy(() => import('@/pages/director/BusinessSettingsPage'))
const DirectorIdentityServices = lazy(() => import('@/pages/director/IdentityServicesPage'))
const DirectorServiceBuilder = lazy(() => import('@/pages/director/ServiceBuilderPage'))
const DirectorServiceBuilderEdit = lazy(() => import('@/pages/director/ServiceBuilderEditPage'))
const DirectorInstantMessage = lazy(() => import('@/pages/director/InstantMessagePage'))
const DirectorPromoBanners   = lazy(() => import('@/pages/director/PromoBannersPage'))
const DirectorAnalytics      = lazy(() => import('@/pages/director/AnalyticsPage'))
const DirectorLiveMetrics    = lazy(() => import('@/pages/director/LiveMetricsPage'))
const DirectorSystemHealth   = lazy(() => import('@/pages/director/SystemHealthPage'))
const DirectorReport         = lazy(() => import('@/pages/director/ReportPage'))
const DirectorAuditLog       = lazy(() => import('@/pages/director/AuditLogPage'))
const DirectorBroadcast      = lazy(() => import('@/pages/director/BroadcastPage'))
const DirectorNotifications  = lazy(() => import('@/pages/director/NotificationsPage'))
const DirectorProfile        = lazy(() => import('@/pages/director/ProfilePage'))
const DirectorMore           = lazy(() => import('@/pages/director/MorePage'))
const DirectorServiceWorkers = lazy(() => import('@/pages/director/ServiceWorkersPage'))

// ── Service Worker portal ──────────────────────────────────────────
const WorkerOnboardingPage        = lazy(() => import('@/pages/worker/WorkerOnboardingPage'))
const WorkerDashboardPage         = lazy(() => import('@/pages/worker/WorkerDashboardPage'))
const WorkerMyJobsPage            = lazy(() => import('@/pages/worker/WorkerMyJobsPage'))
const WorkerEarningsPage          = lazy(() => import('@/pages/worker/WorkerEarningsPage'))
const WorkerDisputesPage          = lazy(() => import('@/pages/worker/WorkerDisputesPage'))
const WorkerProfilePage           = lazy(() => import('@/pages/worker/WorkerProfilePage'))
const WorkerNotificationsPage     = lazy(() => import('@/pages/worker/WorkerNotificationsPage'))

// ── Disputes (shared across customer/officer/director — backend already
// role-filters the list, and the detail page's actions are role-aware) ──
const DisputesListPage   = lazy(() => import('@/pages/disputes/DisputesListPage'))
const DisputeDetailPage  = lazy(() => import('@/pages/disputes/DisputeDetailPage'))

// ── Identity service history (shared across all three portals, same
// reasoning as Disputes above — one detail page, backend role-filters
// what the list endpoint returns) ──
const VerifyLookupPage          = lazy(() => import('@/pages/customer/VerifyLookupPage'))
const DirectorVerificationSettings = lazy(() => import('@/pages/director/VerificationSettingsPage'))
const DirectorProviderServices = lazy(() => import('@/pages/director/ProviderServicesPage'))
const DirectorCleanup = lazy(() => import('@/pages/director/CleanupCentrePage'))
const DirectorZonal = lazy(() => import('@/pages/director/ZonalCustomersPage'))
const DirectorSetPin = lazy(() => import('@/pages/director/SetPinPage'))
const DirectorSeasonal = lazy(() => import('@/pages/director/SeasonalThemesPage'))
const DirectorBillsControl = lazy(() => import('@/pages/director/BillsControlPage'))
const ServiceHistoryPage        = lazy(() => import('@/pages/customer/ServiceHistoryPage'))
const ServiceRequestFormPage    = lazy(() => import('@/pages/customer/ServiceRequestFormPage'))
const ServicesPage              = lazy(() => import('@/pages/customer/ServicesPage'))
const AirtimeDataPage           = lazy(() => import('@/pages/customer/AirtimeDataPage'))
const BillPaymentPage           = lazy(() => import('@/pages/customer/BillPaymentPage'))
const EducationPaymentsPage     = lazy(() => import('@/pages/customer/EducationPaymentsPage'))
const ServiceRequestDetailPage  = lazy(() => import('@/pages/services/ServiceRequestDetailPage'))
const ManualServicePage         = lazy(() => import('@/pages/customer/ManualServicePage'))
const ManualServiceHistoryPage  = lazy(() => import('@/pages/customer/ManualServiceHistoryPage'))
const ManualServiceDetailPage   = lazy(() => import('@/pages/customer/ManualServiceDetailPage'))

// ── Cooperative (preview) ──
const CoopHomePage        = lazy(() => import('@/features/coop/pages/CoopHomePage'))
const CoopJoinPage        = lazy(() => import('@/features/coop/pages/JoinPage'))
const CoopTransparency    = lazy(() => import('@/features/coop/pages/TransparencyPage'))
const CoopLoansPage       = lazy(() => import('@/features/coop/pages/LoansPage'))
const CoopNewLoanPage     = lazy(() => import('@/features/coop/pages/NewLoanPage'))
const CoopLoanDetailPage  = lazy(() => import('@/features/coop/pages/LoanDetailPage'))
const CoopPoolPage        = lazy(() => import('@/features/coop/pages/PoolPage'))
const CoopInvitePage      = lazy(() => import('@/features/coop/pages/InvitePage'))
const CoopMemberProfile   = lazy(() => import('@/features/coop/pages/MemberProfilePage'))
const CoopDividendPage    = lazy(() => import('@/features/coop/pages/DividendPage'))
const CoopMePage          = lazy(() => import('@/features/coop/pages/MePage'))
const CoopBankPage        = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.BankPage })))
const FundingFeesPage = lazy(() => import('@/pages/director/FundingFeesPage'))
const AccountingPage = lazy(() => import('@/pages/director/AccountingPage'))
const MaintenanceSwitchPage = lazy(() => import('@/pages/director/MaintenanceSwitchPage'))
const CoopKinPage         = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.KinPage })))
const CoopClosePage       = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.ClosePage })))
const CoopComplaintThreadPage = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.ComplaintThreadPage })))
const CoopWithdrawalsPage = lazy(() => import('@/features/coop/pages/WithdrawalsPage'))
const CoopLoanHistoryPage = lazy(() => import('@/features/coop/pages/LoansPage').then((m) => ({ default: m.LoanHistoryPage })))
const CoopComplaintsPage  = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.ComplaintsPage })))
const CoopConsentsPage    = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.ConsentsPage })))
const CoopMyDividendsPage = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.MyDividendsPage })))
const CoopStatementPage   = lazy(() => import('@/features/coop/pages/AccountPages').then((m) => ({ default: m.StatementPage })))
const DirectorCoopPage    = lazy(() => import('@/features/coop/director/DirectorCoopPage'))

export default function App() {
  // Called for its effects (boot-time session check, router registration
  // for non-React logout paths) — App no longer needs signOut itself now
  // that idle expiry goes through sessionLifecycle.endSession().
  useAuth()
  useNotificationsPoll()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const authLoading = useAuthStore((s) => s.isLoading)
  const user = useAuthStore((s) => s.user)
  const { isDown } = useServerHealthStore()
  const location = useLocation()

  // Preload tab destinations for the authenticated role in background
  useEffect(() => {
    if (user?.role) {
      preloadRoleRoutes(user.role)
    }
  }, [user?.role])

  // The full branded splash (logo reveal animation) plays once per
  // browser tab session — tracked in sessionStorage, which survives a
  // page refresh but clears when the tab/installed-PWA instance is
  // actually closed. That's deliberate: a refresh of an already-open
  // session should behave like an ordinary refresh (straight back to
  // the same page), not replay the app's opening animation every
  // time — only a genuine new app open should see it again.
  const [showFullSplash, setShowFullSplash] = useState(() => {
    try {
      return sessionStorage.getItem('monieking-splash-shown') !== '1'
    } catch {
      // Storage can throw in rare locked-down browser contexts —
      // fail open (show the splash) rather than crash the app over it.
      return true
    }
  })
  const handleSplashDone = () => {
    try { sessionStorage.setItem('monieking-splash-shown', '1') } catch { /* see above */ }
    setShowFullSplash(false)
  }
  // Shown for as long as no one is signed in AND the URL is still "/"
  // — dismissed the instant that stops being true, which happens
  // naturally the moment OnboardingScreen's own buttons (Skip, Get
  // Started, Login) call navigate() to somewhere else. No dismiss
  // callback needed, and nothing inside OnboardingScreen.tsx had to
  // change to make that work.
  const showOnboarding = !isAuthenticated && location.pathname === '/'

  const maint = useMaintenanceStore()
  const staffSide = user?.role === 'director' || user?.role === 'admin'
  // Ask the public /maintenance endpoint now and then (faster while it is on) so the screen appears and clears by itself.
  useEffect(() => {
    let stop = false
    const ask = async () => {
      try {
        const r = await api.get('/maintenance', { timeout: 6000 })
        if (!stop) useMaintenanceStore.getState().set({ on: !!r.data.on, message: r.data.message ?? '', eta: r.data.eta ?? null, startedAt: r.data.started_at ?? null })
      } catch { /* the server-down screen handles real outages */ }
    }
    ask()
    const t = setInterval(ask, maint.on ? 8000 : 30000)
    return () => { stop = true; clearInterval(t) }
  }, [maint.on])
  const onLogin = location.pathname.startsWith('/auth')
  if (!isDown && maint.on && !staffSide && !onLogin) return <MaintenanceModeScreen />

  if (isDown) return <MaintenancePage />

  return (
    <>
      {maint.on && staffSide && (
        <a href="/director/maintenance" className="fixed inset-x-0 top-0 z-[60] bg-red-600 py-1 text-center text-[11px] font-extrabold text-white">Maintenance is ON: customers are paused. Tap to turn off.</a>
      )}
      {/* Overlaid on top, not gating the tree below it — the real app
          (auth check, routing, data fetching) mounts and starts its
          real work immediately, in parallel with the splash animation,
          so nothing sits waiting for the splash to finish before it
          can begin. `keepVisible={authLoading}` is what stops the
          splash from fading out before the real "am I logged in"
          check (useAuth's /users/me call) has actually resolved — see
          SplashScreen's own docstring for why that gap mattered. */}
      {showFullSplash && (
        <SplashScreen keepVisible={authLoading} onDone={handleSplashDone} />
      )}
      {/* On a same-session refresh (full splash already shown once),
          the session check still needs a moment to resolve — this is
          a plain, instant cover for that brief window, not the
          animated splash. Same reasoning as `keepVisible` above:
          without it, a refresh on a slow connection could very briefly
          flash the login/onboarding screen before correcting itself
          once the real auth state comes back — exactly the bug this
          whole mechanism exists to prevent, just for refreshes instead
          of cold opens. */}
      {!showFullSplash && authLoading && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-surface-gradient dark:bg-night-gradient">
          <LogoLoader />
        </div>
      )}
      {!showFullSplash && !authLoading && showOnboarding && (
        <OnboardingCarousel />
      )}
      <InactivityMonitor isAuthenticated={isAuthenticated} />
      {/* Active for every visitor, logged in or not — see the
          component's own docstring for why pre-auth pages matter here
          too. */}
      <AnalyticsTracker />
      <Suspense fallback={<PageContentSkeleton />}>
        <Routes>
          {/* ── Public ──
              "/" used to render LandingPage — detached (see the note
              above the removed import). For a signed-in session it
              sends them straight to their own dashboard (this is the
              PWA's start_url, hit on every app open — an authenticated
              person landing here should never see anything else). For
              a signed-out session it renders nothing at all: the
              onboarding overlay below is entirely responsible for what
              shows up, and unmounts itself the moment OnboardingScreen
              navigates away from "/" — see the effect above. */}
          <Route path="/" element={isAuthenticated && user ? <Navigate to={roleDashboard[user.role]} replace /> : null} />
          <Route path="/legal/terms" element={<TermsOfServicePage />} />
          <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/auth/login"    element={<LoginPage />} />
          <Route path="/auth/register" element={<RegisterPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/location-consent" element={<AuthGuard allowedRoles={['customer']}><LocationConsentPage /></AuthGuard>} />
          <Route path="/worker/onboarding"     element={<AuthGuard allowedRoles={['service_worker']}><WorkerOnboardingPage /></AuthGuard>} />

          {/* ── Authenticated App Layout (Persistently renders BottomNav) ── */}
          <Route element={<AppLayout />}>
            {/* ── Customer ── */}
            <Route path="/customer/dashboard"     element={<AuthGuard allowedRoles={['customer']}><CustomerDashboard /></AuthGuard>} />
            <Route path="/customer/cards"         element={<AuthGuard allowedRoles={['customer']}><CustomerCards /></AuthGuard>} />
            <Route path="/customer/wallet"        element={<AuthGuard allowedRoles={['customer']}><CustomerWallet /></AuthGuard>} />
            <Route path="/customer/wallet/transactions" element={<AuthGuard allowedRoles={['customer']}><CustomerTransactions /></AuthGuard>} />
            {/* Shared across every role — a receipt is viewed the same way regardless of who's looking at it */}
            <Route path="/transactions/:id/receipt" element={<AuthGuard><TransactionReceipt /></AuthGuard>} />
            <Route path="/officer/food-ledger"            element={<AuthGuard allowedRoles={['officer']}><OfficerFoodLedger /></AuthGuard>} />
            <Route path="/director/sms"                  element={<AuthGuard allowedRoles={['director', 'admin']}><DirectorSmsCenter /></AuthGuard>} />
            <Route path="/director/food/oversight"        element={<AuthGuard allowedRoles={['director']}><DirectorFoodOversight /></AuthGuard>} />
            <Route path="/director/food/close-year"       element={<AuthGuard allowedRoles={['director']}><DirectorFoodCloseYear /></AuthGuard>} />
            <Route path="/director/food/archives"         element={<AuthGuard allowedRoles={['director']}><DirectorFoodArchives /></AuthGuard>} />
            <Route path="/director/food/archives/:year"   element={<AuthGuard allowedRoles={['director']}><DirectorFoodArchiveOne /></AuthGuard>} />
            <Route path="/customer/notifications" element={<AuthGuard allowedRoles={['customer']}><CustomerNotifications /></AuthGuard>} />
            <Route path="/customer/kyc"           element={<AuthGuard allowedRoles={['customer']}><KycPage /></AuthGuard>} />
            <Route path="/officer/kyc"            element={<AuthGuard allowedRoles={['officer']}><KycPage /></AuthGuard>} />
            <Route path="/customer/profile"       element={<AuthGuard allowedRoles={['customer']}><CustomerProfile /></AuthGuard>} />
            <Route path="/customer/cards/:cardId/contribute" element={<AuthGuard allowedRoles={['customer']}><ContributePage /></AuthGuard>} />
            <Route path="/customer/cards/:cardId" element={<AuthGuard allowedRoles={['customer']}><CardDetailPage /></AuthGuard>} />
            <Route path="/customer/withdrawals/new"          element={<AuthGuard allowedRoles={['customer']}><WithdrawalPage /></AuthGuard>} />
            <Route path="/customer/disputes"      element={<AuthGuard allowedRoles={['customer']}><DisputesListPage /></AuthGuard>} />
            <Route path="/customer/verify/:kind" element={<AuthGuard allowedRoles={['customer']}><VerifyLookupPage /></AuthGuard>} />
            <Route path="/customer/verify/:kind/:lookupId" element={<AuthGuard allowedRoles={['customer']}><VerifyLookupPage /></AuthGuard>} />
            <Route path="/customer/services/history" element={<AuthGuard allowedRoles={['customer']}><ServiceHistoryPage /></AuthGuard>} />
            <Route path="/customer/services" element={<AuthGuard allowedRoles={['customer']}><ServicesPage /></AuthGuard>} />
            <Route path="/customer/services/:serviceId/request" element={<AuthGuard allowedRoles={['customer']}><ServiceRequestFormPage /></AuthGuard>} />
            <Route path="/customer/airtime-data" element={<AuthGuard allowedRoles={['customer']}><AirtimeDataPage /></AuthGuard>} />
            <Route path="/customer/bill-payments" element={<AuthGuard allowedRoles={['customer']}><BillPaymentPage /></AuthGuard>} />
            <Route path="/customer/education-payments" element={<AuthGuard allowedRoles={['customer']}><EducationPaymentsPage /></AuthGuard>} />
            <Route path="/customer/manual-services/history" element={<AuthGuard allowedRoles={['customer']}><ManualServiceHistoryPage /></AuthGuard>} />
            <Route path="/customer/manual-services/requests/:requestId" element={<AuthGuard allowedRoles={['customer', 'officer', 'director']}><ManualServiceDetailPage /></AuthGuard>} />
            <Route path="/customer/manual-services/:serviceKey" element={<AuthGuard allowedRoles={['customer']}><ManualServicePage /></AuthGuard>} />

            {/* ── Cooperative (preview) ── */}
            <Route path="/coop"                 element={<AuthGuard allowedRoles={['customer']}><CoopHomePage /></AuthGuard>} />
            <Route path="/coop/join"            element={<AuthGuard allowedRoles={['customer']}><CoopJoinPage /></AuthGuard>} />
            <Route path="/coop/transparency"    element={<AuthGuard allowedRoles={['customer']}><CoopTransparency /></AuthGuard>} />
            <Route path="/coop/loans"           element={<AuthGuard allowedRoles={['customer']}><CoopLoansPage /></AuthGuard>} />
            <Route path="/coop/loans/new"       element={<AuthGuard allowedRoles={['customer']}><CoopNewLoanPage /></AuthGuard>} />
            <Route path="/coop/bank" element={<AuthGuard allowedRoles={['customer']}><CoopBankPage /></AuthGuard>} />
            <Route path="/coop/next-of-kin" element={<AuthGuard allowedRoles={['customer']}><CoopKinPage /></AuthGuard>} />
            <Route path="/coop/close" element={<AuthGuard allowedRoles={['customer']}><CoopClosePage /></AuthGuard>} />
            <Route path="/coop/complaints/:id" element={<AuthGuard allowedRoles={['customer']}><CoopComplaintThreadPage /></AuthGuard>} />
            <Route path="/coop/withdrawals" element={<AuthGuard allowedRoles={['customer']}><CoopWithdrawalsPage /></AuthGuard>} />
            <Route path="/coop/loans/history" element={<AuthGuard allowedRoles={['customer']}><CoopLoanHistoryPage /></AuthGuard>} />
            <Route path="/coop/complaints" element={<AuthGuard allowedRoles={['customer']}><CoopComplaintsPage /></AuthGuard>} />
            <Route path="/coop/consents" element={<AuthGuard allowedRoles={['customer']}><CoopConsentsPage /></AuthGuard>} />
            <Route path="/coop/dividends" element={<AuthGuard allowedRoles={['customer']}><CoopMyDividendsPage /></AuthGuard>} />
            <Route path="/coop/statement" element={<AuthGuard allowedRoles={['customer']}><CoopStatementPage /></AuthGuard>} />
            <Route path="/coop/loans/:id"       element={<AuthGuard allowedRoles={['customer']}><CoopLoanDetailPage /></AuthGuard>} />
            <Route path="/coop/pool"            element={<AuthGuard allowedRoles={['customer']}><CoopPoolPage /></AuthGuard>} />
            <Route path="/coop/invites/:id"     element={<AuthGuard allowedRoles={['customer']}><CoopInvitePage /></AuthGuard>} />
            <Route path="/coop/members/:id"     element={<AuthGuard allowedRoles={['customer', 'director']}><CoopMemberProfile /></AuthGuard>} />
            <Route path="/coop/dividend"        element={<AuthGuard allowedRoles={['customer']}><CoopDividendPage /></AuthGuard>} />
            <Route path="/coop/me"              element={<AuthGuard allowedRoles={['customer']}><CoopMePage /></AuthGuard>} />
            <Route path="/director/funding-fees" element={<AuthGuard allowedRoles={['director']}><FundingFeesPage /></AuthGuard>} />
            <Route path="/director/accounting" element={<AuthGuard allowedRoles={['director']}><AccountingPage /></AuthGuard>} />
            <Route path="/director/maintenance" element={<AuthGuard allowedRoles={['director']}><MaintenanceSwitchPage /></AuthGuard>} />
            <Route path="/director/coop"        element={<AuthGuard allowedRoles={['director']}><DirectorCoopPage /></AuthGuard>} />

            {/* ── Officer ── */}
            <Route path="/officer/dashboard"      element={<AuthGuard allowedRoles={['officer']}><OfficerDashboard /></AuthGuard>} />
            <Route path="/officer/customers"      element={<AuthGuard allowedRoles={['officer']}><OfficerCustomers /></AuthGuard>} />
            <Route path="/officer/customers/:customerId" element={<AuthGuard allowedRoles={['officer']}><OfficerCustomerDetail /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/cards/:cardId" element={<AuthGuard allowedRoles={['officer']}><OfficerCardDetail /></AuthGuard>} />
            <Route path="/officer/wallet"         element={<AuthGuard allowedRoles={['officer']}><OfficerWallet /></AuthGuard>} />
            <Route path="/officer/wallet/transactions" element={<AuthGuard allowedRoles={['officer']}><OfficerTransactions /></AuthGuard>} />
            <Route path="/officer/notifications"  element={<AuthGuard allowedRoles={['officer']}><OfficerNotifications /></AuthGuard>} />
            <Route path="/officer/customer-stats" element={<AuthGuard allowedRoles={['officer']}><OfficerCustomerStats /></AuthGuard>} />
            <Route path="/officer/profile"        element={<AuthGuard allowedRoles={['officer']}><OfficerProfile /></AuthGuard>} />
            <Route path="/officer/disputes"       element={<AuthGuard allowedRoles={['officer']}><DisputesListPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/verify/:kind" element={<AuthGuard allowedRoles={['officer']}><VerifyLookupPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/verify/:kind/:lookupId" element={<AuthGuard allowedRoles={['officer']}><VerifyLookupPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/services" element={<AuthGuard allowedRoles={['officer']}><ServiceHistoryPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/services/all" element={<AuthGuard allowedRoles={['officer']}><ServicesPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/services/:serviceId/request" element={<AuthGuard allowedRoles={['officer']}><ServiceRequestFormPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/airtime-data" element={<AuthGuard allowedRoles={['officer']}><AirtimeDataPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/bill-payments" element={<AuthGuard allowedRoles={['officer']}><BillPaymentPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/education-payments" element={<AuthGuard allowedRoles={['officer']}><EducationPaymentsPage /></AuthGuard>} />
            <Route path="/officer/manual-services/history" element={<AuthGuard allowedRoles={['officer']}><ManualServiceHistoryPage /></AuthGuard>} />
            <Route path="/officer/customers/:customerId/manual-services/:serviceKey" element={<AuthGuard allowedRoles={['officer']}><ManualServicePage /></AuthGuard>} />

            {/* ── Director (Admin fused in) ── */}
            <Route path="/director/dashboard"       element={<AuthGuard allowedRoles={['director']}><DirectorDashboard /></AuthGuard>} />
            <Route path="/director/withdrawals"     element={<AuthGuard allowedRoles={['director']}><DirectorWithdrawals /></AuthGuard>} />
            <Route path="/director/staff"           element={<AuthGuard allowedRoles={['director']}><DirectorStaff /></AuthGuard>} />
            <Route path="/director/officers/:officerId" element={<AuthGuard allowedRoles={['director']}><DirectorOfficerDetail /></AuthGuard>} />
            <Route path="/director/customers"       element={<AuthGuard allowedRoles={['director']}><DirectorAllCustomers /></AuthGuard>} />
            <Route path="/director/customers/:customerId/cards/:cardId" element={<AuthGuard allowedRoles={['director']}><DirectorCardDetail /></AuthGuard>} />
            <Route path="/director/customers/:customerId" element={<AuthGuard allowedRoles={['director']}><DirectorCustomerDetail /></AuthGuard>} />
            <Route path="/director/settings"        element={<AuthGuard allowedRoles={['director']}><DirectorSettings /></AuthGuard>} />
            <Route path="/director/verification" element={<AuthGuard allowedRoles={['director']}><DirectorVerificationSettings /></AuthGuard>} />
            <Route path="/director/cleanup" element={<AuthGuard allowedRoles={['director']}><DirectorCleanup /></AuthGuard>} />
            <Route path="/director/zonal-customers" element={<AuthGuard allowedRoles={['director']}><DirectorZonal /></AuthGuard>} />
            <Route path="/director/set-pin" element={<AuthGuard allowedRoles={['director']}><DirectorSetPin /></AuthGuard>} />
            <Route path="/director/seasonal" element={<AuthGuard allowedRoles={['director']}><DirectorSeasonal /></AuthGuard>} />
            <Route path="/director/bills-control" element={<AuthGuard allowedRoles={['director']}><DirectorBillsControl /></AuthGuard>} />
            <Route path="/director/provider-services" element={<AuthGuard allowedRoles={['director']}><DirectorProviderServices /></AuthGuard>} />
            <Route path="/director/identity-services" element={<AuthGuard allowedRoles={['director']}><DirectorIdentityServices /></AuthGuard>} />
            <Route path="/director/service-builder" element={<AuthGuard allowedRoles={['director']}><DirectorServiceBuilder /></AuthGuard>} />
            <Route path="/director/service-builder/:code" element={<AuthGuard allowedRoles={['director']}><DirectorServiceBuilderEdit /></AuthGuard>} />
            <Route path="/director/instant-message" element={<AuthGuard allowedRoles={['director']}><DirectorInstantMessage /></AuthGuard>} />
            <Route path="/director/promo-banners"   element={<AuthGuard allowedRoles={['director']}><DirectorPromoBanners /></AuthGuard>} />
            <Route path="/director/analytics"       element={<AuthGuard allowedRoles={['director']}><DirectorAnalytics /></AuthGuard>} />
            <Route path="/director/live-metrics"    element={<AuthGuard allowedRoles={['director']}><DirectorLiveMetrics /></AuthGuard>} />
            <Route path="/director/system-health"   element={<AuthGuard allowedRoles={['director']}><DirectorSystemHealth /></AuthGuard>} />
            <Route path="/director/report"          element={<AuthGuard allowedRoles={['director']}><DirectorReport /></AuthGuard>} />
            <Route path="/director/audit-log"       element={<AuthGuard allowedRoles={['director']}><DirectorAuditLog /></AuthGuard>} />
            <Route path="/director/broadcast"       element={<AuthGuard allowedRoles={['director']}><DirectorBroadcast /></AuthGuard>} />
            <Route path="/director/notifications"   element={<AuthGuard allowedRoles={['director']}><DirectorNotifications /></AuthGuard>} />
            <Route path="/director/profile"         element={<AuthGuard allowedRoles={['director']}><DirectorProfile /></AuthGuard>} />
            <Route path="/director/more"            element={<AuthGuard allowedRoles={['director']}><DirectorMore /></AuthGuard>} />
            <Route path="/director/disputes"        element={<AuthGuard allowedRoles={['director']}><DisputesListPage /></AuthGuard>} />
            <Route path="/director/service-workers" element={<AuthGuard allowedRoles={['director']}><DirectorServiceWorkers /></AuthGuard>} />

            {/* ── Service Worker ── */}
            <Route path="/worker/dashboard"      element={<AuthGuard allowedRoles={['service_worker']}><WorkerDashboardPage /></AuthGuard>} />
            <Route path="/worker/my-jobs"        element={<AuthGuard allowedRoles={['service_worker']}><WorkerMyJobsPage /></AuthGuard>} />
            <Route path="/worker/jobs"           element={<AuthGuard allowedRoles={['service_worker']}><WorkerMyJobsPage /></AuthGuard>} />
            <Route path="/worker/earnings"       element={<AuthGuard allowedRoles={['service_worker']}><WorkerEarningsPage /></AuthGuard>} />
            <Route path="/worker/disputes"       element={<AuthGuard allowedRoles={['service_worker']}><WorkerDisputesPage /></AuthGuard>} />
            <Route path="/worker/profile"        element={<AuthGuard allowedRoles={['service_worker']}><WorkerProfilePage /></AuthGuard>} />
            <Route path="/worker/notifications"  element={<AuthGuard allowedRoles={['service_worker']}><WorkerNotificationsPage /></AuthGuard>} />

            {/* ── Disputes detail — shared route, all roles ── */}
            <Route path="/disputes/:disputeId" element={<AuthGuard allowedRoles={['customer', 'officer', 'director', 'service_worker']}><DisputeDetailPage /></AuthGuard>} />

            {/* ── Service request detail — one shared route, all three roles ── */}
            <Route path="/services/requests/:requestId" element={<AuthGuard allowedRoles={['customer', 'officer', 'director']}><ServiceRequestDetailPage /></AuthGuard>} />
          </Route>

          {/* ── Fallback ── */}
          <Route path="*" element={<Navigate to="/auth/login" replace />} />
        </Routes>
      </Suspense>

      {/* Scrolling ticker — pinned above the bottom nav on every authenticated page, every role */}
      {isAuthenticated && <InstantMessageTicker />}
      {isAuthenticated && <InstallPrompt />}
      {isAuthenticated && <PushPermissionPrompt />}
      {isAuthenticated && <InAppNotificationBanner />}
    </>
  )
}
