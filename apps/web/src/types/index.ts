// ─── Enums ────────────────────────────────────────────────────────
export type UserRole = 'customer' | 'officer' | 'admin' | 'director' | 'service_worker'
export type UserStatus = 'active' | 'suspended' | 'pending_verification'
export type CardType = 'regular' | 'food'
export type CardStatus = 'active' | 'completed' | 'converted' | 'archived'
export type CardCompletionStatus = 'paid' | 'unpaid' | 'partially_paid' | 'withdrawal_pending'
export type WithdrawalStatus = 'pending' | 'claimed' | 'paid' | 'rejected'
export type TxType = 'credit' | 'debit'
export type TxCategory =
  | 'wallet_funding'
  | 'contribution'
  | 'withdrawal'
  | 'charge'
  | 'officer_contribution'
  | 'reversal'
export type ContributionMethod = 'digital' | 'cash_via_officer'
export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'broadcast'

// ─── Core models ──────────────────────────────────────────────────
export interface User {
  id: string
  customer_number: number
  role: UserRole
  full_name: string
  phone_number: string
  email?: string | null
  bank_name: string | null
  account_number: string | null
  account_name: string | null
  face_image_url: string | null
  next_of_kin_name: string | null
  next_of_kin_phone: string | null
  zone_id: string | null
  zone_name: string | null
  created_by: string | null
  is_manual_customer: boolean
  managing_officer_id: string | null
  status: UserStatus
  avatar_url: string | null
  location_consent_status: 'not_asked' | 'granted' | 'declined'
  detected_state: string | null
  has_withdrawal_password?: boolean
  bvn_linked?: boolean
  nin_linked?: boolean
  bvn_last4?: string | null
  nin_last4?: string | null
  sms_alerts_enabled?: boolean
  onboarding_completed?: boolean
  state_of_residence?: string | null
  referral_code?: string | null
  commission_balance_kobo?: number
  created_at: string
  updated_at: string
}

export interface Zone {
  id: string
  name: string
  description: string | null
  officer_count: number
  current_officer_name: string | null
  created_at: string
}

export interface ZoneAssignmentHistory {
  id: string
  zone_id: string | null
  zone_name: string
  started_at: string
  ended_at: string | null
  assigned_by_director_name: string | null
}

export interface Wallet {
  id: string
  owner_id: string
  balance_kobo: number
  virtual_account_number: string | null
  virtual_account_bank: string | null
  virtual_account_ref: string | null
  is_frozen: boolean
  created_at: string
}

export interface WalletTransaction {
  id: string
  wallet_id: string
  type: TxType
  category: TxCategory
  amount_kobo: number
  balance_after_kobo: number
  reference: string
  description: string | null
  related_card_id: string | null
  related_withdrawal_id: string | null
  initiated_by: string
  created_at: string
}

export interface ContributionCard {
  id: string
  card_number: number
  owner_id: string
  card_type: CardType
  rate_kobo: number
  total_days_contributed: number
  total_contributed_kobo: number
  status: CardStatus
  completion_status: CardCompletionStatus | null
  food_eligibility_lost_at: string | null
  created_at: string
  completed_at: string | null
  latest_withdrawal_id?: string | null
  // joined
  owner?: Pick<User, 'full_name' | 'phone_number'>
}

export interface ContributionRecord {
  id: string
  card_id: string
  logical_month: number   // 1–12
  logical_day: number     // 1–31
  amount_kobo: number
  contributed_by: string
  method: ContributionMethod
  reference: string
  created_at: string
}

export interface Withdrawal {
  id: string
  customer_id: string
  card_id: string | null
  source: 'card' | 'wallet'
  requested_amount_kobo: number
  charge_kobo: number
  net_payable_kobo: number
  bank_name: string
  account_number: string
  account_name: string
  status: WithdrawalStatus
  claimed_by_director_id: string | null
  claimed_at: string | null
  processed_at: string | null
  rejection_reason: string | null
  requested_at: string
  customer_name: string | null
  customer_avatar_url: string | null
}

export interface AppNotification {
  id: string
  user_id: string
  title: string
  body: string
  type: NotificationType
  is_read: boolean
  related_entity_id: string | null
  created_at: string
}

// ─── API shapes ───────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  page_size: number
  has_next: boolean
}

export interface ApiError {
  detail: string
  code?: string
}

// ─── Form types ───────────────────────────────────────────────────
export interface RegisterCustomerForm {
  full_name: string
  phone_number: string
  bank_name: string
  account_number: string
  account_name: string
  next_of_kin_name: string
  next_of_kin_phone: string
  password: string
  withdrawal_password: string
  face_image?: File
}

export interface LoginForm {
  phone_number: string
  password: string
}

export interface CreateCardForm {
  card_type: CardType
  rate_kobo: number
}

export interface ContributeForm {
  card_id: string
  amount_kobo: number
}

export interface WithdrawForm {
  card_id: string
  amount_kobo: number
  auth_method: 'password' | 'biometric'
  withdrawal_password?: string
}

// ─── Grid types ───────────────────────────────────────────────────
export interface GridCell {
  month: number
  day: number
  filled: boolean
  withdrawn: boolean
  contribution_id?: string
}

export type CardGrid = GridCell[][]  // [12][31]

// ─── Auth context ─────────────────────────────────────────────────
export interface AuthUser extends User {
  wallet?: Wallet
}

// ─── Director portal: settings ───────────────────────────────────
export interface SystemConfigItem {
  key: string
  value: string
  description: string | null
  updated_by: string | null
  updated_at: string
}

export type PendingRateChangeStatus = 'scheduled' | 'cancelled' | 'applied'

export interface PendingRateChange {
  id: string
  setting_key: string
  current_value_kobo: number
  new_value_kobo: number
  effective_date: string
  status: PendingRateChangeStatus
  created_by: string
  created_at: string
  cancelled_at: string | null
  notified_at: string | null
  days_until_effective: number | null
}

export interface RateChangePreview {
  setting_key: string
  current_value_kobo: number
  new_value_kobo: number
  effective_date: string
  days_until_effective: number
  customers_will_be_notified_on: string
}

// ─── Director portal: instant message ticker ─────────────────────
export type InstantMessagePriority = 'normal' | 'urgent'

export interface InstantMessage {
  id: string
  message: string
  priority: InstantMessagePriority
  target_roles: string
  is_active: boolean
  expires_at: string | null
  created_by: string
  created_at: string
}

// ─── Director portal: promo banners ──────────────────────────────
export type PromoBannerLinkType = 'none' | 'internal_route' | 'external_url'

export interface PromoBanner {
  id: string
  title: string
  subtitle: string | null
  gradient_from: string
  gradient_to: string
  link_type: PromoBannerLinkType
  link_target: string | null
  display_order: number
  is_active: boolean
  start_at: string | null
  end_at: string | null
  target_roles: string
  created_by: string
  created_at: string
  impressions: number
  clicks: number
}

// ─── Director portal: customer overview ──────────────────────────
export interface CustomerCardOverview {
  id: string
  card_type: CardType
  rate_kobo: number
  status: CardStatus
  created_at: string
  total_days_contributed: number
  days_remaining: number
  total_contributed_kobo: number
  total_withdrawn_kobo: number
  available_balance_kobo: number
  withdrawal_history: {
    id: string
    requested_amount_kobo: number
    charge_kobo: number
    net_payable_kobo: number
    status: WithdrawalStatus
    requested_at: string
    processed_at: string | null
  }[]
}

export interface CustomerOverview {
  profile: User
  wallet_balance_kobo: number
  cards: CustomerCardOverview[]
}

// ─── Director portal: analytics ──────────────────────────────────
export interface SystemAnalytics {
  users_by_role: Record<string, number>
  total_active_cards: number
  total_food_cards: number
  total_contributed_kobo: number
  pending_withdrawals: number
  total_paid_out_kobo: number
  total_charges_kobo: number
  period: { start_date: string | null; end_date: string | null }
}

export interface ProfitReport {
  card_withdrawal_charges_kobo: number
  card_withdrawal_count: number
  instant_withdrawal_charges_kobo: number
  instant_withdrawal_count: number
  total_profit_kobo: number
  period: { start_date: string | null; end_date: string | null }
}

export interface ZoneAnalytics {
  by_state: { state: string; count: number }[]
  declined_count: number
  not_asked_count: number
}

// ─── Customer Statistics panel (director general / director→officer /
// officer's own dashboard) ─────────────────────────────────────────
export interface CustomerStatsTrend {
  total_contributors: number | null
  food_contributors: number | null
  regular_contributors: number | null
  active_contributors: number | null
  inactive_contributors: number | null
  new_contributors: number | null
  total_value_active_kobo: number | null
}

export interface CustomerStatsOverview {
  total_contributors: number
  food_contributors: number
  regular_contributors: number
  active_contributors: number
  inactive_contributors: number
  new_contributors: number
  total_value_active_kobo: number
  trend: CustomerStatsTrend | null
  period: { start_date: string | null; end_date: string | null }
}

export interface OfficerContributionStats {
  officer_id: string
  amount_gathered_kobo: number
  contribution_count: number
  period: { start_date: string | null; end_date: string | null }
}

export interface InactiveCustomer {
  id: string
  customer_number: number
  full_name: string
  phone_number: string
  withdrawn_all: boolean
  no_recent_contribution: boolean
  last_contribution_at: string | null
  last_contacted_at: string | null
}

export interface InactiveCustomersPage {
  customers: InactiveCustomer[]
  total: number
  page: number
  page_size: number
}

export type DisputeEntityType = 'wallet_transaction' | 'withdrawal' | 'manual_service'
export type DisputeStatus = 'open' | 'under_review' | 'escalated' | 'resolved'
export type DisputeReason =
  | 'not_mine' | 'amount_wrong' | 'duplicate'
  | 'money_not_received' | 'rejected_in_error' | 'other'
  | 'customer_info_incorrect' | 'portal_unavailable' | 'commission_dispute'

export const DISPUTE_REASON_LABEL: Record<string, string> = {
  not_mine:                 "I didn't make/request this",
  amount_wrong:             'Amount is wrong',
  duplicate:                'This looks like a duplicate',
  money_not_received:       "Money wasn't received",
  rejected_in_error:        'I believe this was rejected in error',
  customer_info_incorrect:  'Customer information is incorrect / invalid',
  portal_unavailable:       'Government / Bank portal unavailable',
  commission_dispute:       'Commission payout discrepancy',
  other:                    'Something else',
}

export interface DisputeMessage {
  id: string
  sender_id?: string | null
  sender_name?: string
  sender_role?: string
  message: string
  is_internal?: boolean
  attachment_url?: string | null
  attachment_name?: string | null
  attachment_size?: number | null
  read_at: string | null
  created_at: string
}

export interface DisputeJobContext {
  customer_name: string
  service_category: string
  service_type: string
  worker_name?: string | null
  ongoing_since: string
  job_status: string
  worker_remarks?: string | null
  commission_kobo: number
  commission_status: string
}

export interface Dispute {
  id: string
  raised_by: string
  customer_name: string
  entity_type: DisputeEntityType
  entity_id: string
  reason: DisputeReason
  status: DisputeStatus
  assigned_to: string | null
  handler_name: string | null
  resolution_summary: string | null
  can_resolve: boolean
  service_request_id?: string | null
  assigned_worker_id?: string | null
  is_escalated?: boolean
  escalated_at?: string | null
  escalation_reason?: string | null
  raised_by_role?: 'customer' | 'service_worker' | string
  is_worker_raised?: boolean
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface DisputeDetail extends Dispute {
  job_context?: DisputeJobContext | null
  messages: DisputeMessage[]
}

// ─── Identity services (NIMC/BVN/TIN/CAC/etc quick actions) ───────
export type IdentityServiceCategory =
  | 'nimc' | 'bvn' | 'tin' | 'attestation' | 'cac' | 'vendor' | 'airtime' | 'bills'
export type IdentityRequestStatus = 'pending' | 'completed' | 'failed' | 'reversed'
export type IdentityRequestInitiatedBy = 'customer' | 'officer'

export interface RequiredField {
  key: string
  label: string
  type: 'text' | 'boolean' | 'file'
  required: boolean
  hint?: string | null
}

export interface IdentityService {
  id: string
  category: IdentityServiceCategory
  code: string
  name: string
  description: string | null
  provider: string
  provider_endpoint: string | null
  price_kobo: number
  is_active: boolean
  required_fields: RequiredField[]
  updated_at: string
}

export interface IdentityServiceRequest {
  id: string
  service_id: string
  service_name: string
  service_category: IdentityServiceCategory
  customer_id: string
  initiated_by: IdentityRequestInitiatedBy
  officer_id: string | null
  status: IdentityRequestStatus
  request_payload: Record<string, unknown>
  response_summary: Record<string, unknown> | null
  failure_reason: string | null
  amount_charged_kobo: number
  provider_reference: string | null
  created_at: string
  completed_at: string | null
}

// ── Bill payments (airtime, data, electricity, cable TV, education) ──
// Separate module from identity services — see
// backend/app/services/bill_payment_service.py for why.
export type BillerCategory = 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'education'
export type BillPaymentStatus = 'pending_validation' | 'validated' | 'pending' | 'completed' | 'failed' | 'reversed'

export interface Biller {
  id: string
  category: BillerCategory
  name: string
  product_id: string
  product_name: string
  price_kobo: number | null   // set for fixed-price products (data/education); null means customer enters an amount
  requires_validation: boolean
}

export interface BillValidationResult {
  validation_reference: string | null
  validated_account_name: string | null
  requires_validation: boolean
}

export interface BillPaymentRequest {
  id: string
  biller_id: string
  biller_name: string
  biller_category: BillerCategory
  customer_id: string
  initiated_by: IdentityRequestInitiatedBy
  officer_id: string | null
  customer_reference: string
  amount_kobo: number
  validated_account_name: string | null
  status: BillPaymentStatus
  failure_reason: string | null
  token: string | null
  amount_charged_kobo: number | null
  monnify_transaction_reference: string | null
  created_at: string
  completed_at: string | null
}

// ─── Manual Services & Service Worker ────────────────────────────
export type ManualServiceStatus = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'disputed'

export interface ManualServiceRequest {
  id: string
  customer_id: string
  customer_name?: string
  customer_phone?: string
  service_id: string
  service_title: string
  service_category: string
  fee_kobo: number
  commission_kobo: number
  form_data: Record<string, any>
  referral_code_used?: string | null
  status: ManualServiceStatus
  assigned_worker_id?: string | null
  assigned_worker_name?: string | null
  claimed_at?: string | null
  claim_expires_at?: string | null
  completed_at?: string | null
  resolution_notes?: string | null
  result_file_url?: string | null
  rejection_reason?: string | null
  created_at: string
  updated_at: string
}

export interface WorkerStats {
  free_workers: number
  busy_workers: number
  unattended_jobs: number
  completed_today: number
  total_workers: number
}

export interface WorkerEarningsSummary {
  commission_balance_kobo: number
  total_earned_kobo: number
  total_withdrawn_kobo: number
  jobs_completed: number
  jobs_in_progress: number
}

export interface ServiceWorkerWithdrawal {
  id: string
  worker_id: string
  worker_name?: string
  worker_phone?: string
  amount_kobo: number
  bank_name: string
  account_number: string
  account_name: string
  status: 'pending' | 'approved' | 'rejected'
  approved_by?: string | null
  rejection_reason?: string | null
  created_at: string
  approved_at?: string | null
}