export interface AdminUser {
  id: string
  customer_number: number
  role: 'admin'
  full_name: string
  phone_number: string
  zone_id: string | null
  zone_name: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface CustomerListItem {
  id: string
  customer_number: number
  full_name: string
  phone_number: string
  status: string
  zone_id: string | null
  created_at: string
}

export interface CustomerListPage {
  customers: CustomerListItem[]
  total: number
  page: number
  page_size: number
}

export interface CardOverview {
  id: string
  card_type: string
  rate_kobo: number
  status: string
  created_at: string
  total_days_contributed: number
  total_contributed_kobo: number
  total_withdrawn_kobo: number
  available_balance_kobo: number
  withdrawal_history: {
    id: string
    requested_amount_kobo: number
    net_payable_kobo: number
    status: string
    requested_at: string
    processed_at: string | null
  }[]
}

export interface DisputeSummary {
  id: string
  entity_type: string
  reason: string
  status: string
  created_at: string
}

export interface CustomerFullProfile {
  profile: {
    id: string
    customer_number: number
    full_name: string
    phone_number: string
    zone_id: string | null
    zone_name: string | null
    status: string
    location_consent_status: string
    detected_state: string | null
    bvn_linked: boolean
    nin_linked: boolean
    created_at: string
    updated_at: string
  }
  wallet: {
    balance_kobo: number
    virtual_account_number: string | null
    virtual_account_bank: string | null
  }
  cards: CardOverview[]
  disputes: DisputeSummary[]
}

export interface CustomerStatsOverview {
  total_contributors: number
  food_contributors: number
  regular_contributors: number
  active_contributors: number
  inactive_contributors: number
  new_contributors: number
  total_value_active_kobo: number
  trend: Record<string, number | null> | null
  period: { start_date: string | null; end_date: string | null }
}

// ─── Officers / Zones / Directors (Phase 2 & 3) ───────────────────
export interface StaffListItem {
  id: string
  customer_number: number
  full_name: string
  phone_number: string
  status: string
  zone_id: string | null
  zone_name: string | null
  created_at: string
}

export interface Zone {
  id: string
  name: string
  description: string | null
  created_at: string
  officer_count: number
  current_officer_name: string | null
}

export interface ZoneHistoryEntry {
  id: string
  zone_id: string | null
  zone_name: string | null
  started_at: string
  ended_at: string | null
  assigned_by_director_name: string | null
}

export interface OfficerContributionStats {
  officer_id: string
  amount_gathered_kobo: number
  contribution_count: number
  period: { start_date: string | null; end_date: string | null }
}

// ─── Financial reconciliation (Phase 4) ───────────────────────────
export interface WalletTransactionRow {
  id: string
  type: 'credit' | 'debit'
  category: string
  amount_kobo: number
  balance_after_kobo: number
  reference: string
  description: string | null
  owner_name: string
  owner_customer_number: number
  created_at: string
}

export interface WalletTransactionsPage {
  transactions: WalletTransactionRow[]
  total: number
  page: number
  page_size: number
}

export interface ReconciliationFlag {
  wallet_id: string
  owner_name: string
  owner_customer_number: number
  current_balance_kobo: number
  last_recorded_balance_kobo: number
  difference_kobo: number
}

// ─── Disputes (Phase 5) ────────────────────────────────────────────
export interface DisputeListItem {
  id: string
  raised_by: string
  customer_name: string
  entity_type: string
  entity_id: string
  reason: string
  status: string
  assigned_to: string | null
  handler_name: string | null
  resolution_summary: string | null
  can_resolve: boolean
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface DisputeMessageItem {
  id: string
  sender_id: string
  sender_name: string
  message: string
  read_at: string | null
  created_at: string
}

export interface DisputeDetail extends DisputeListItem {
  messages: DisputeMessageItem[]
}
