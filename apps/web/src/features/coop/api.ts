import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'

/* ───────── types (kobo everywhere, same as the backend) ───────── */
export interface PublicRules {
  registration_min_kobo: number; loan_rate_bps: number; loan_min_kobo: number; loan_max_kobo: number
  loan_term_months: number; loan_max_active: number; cover_pct: number; guarantee_min_kobo: number
  guarantee_max_kobo: number; guarantee_max_active: number; guarantee_min_commit_pct: number
  guarantor_min_funds_pct: number; loan_max_guarantors: number; loan_request_expiry_days: number
  invite_expiry_hours: number; overdue_daily_bps: number; overdue_cap_pct: number; early_withdrawal_bps: number
  running_cost_bps: number; dividend_contribution_pct: number; dividend_guarantee_pct: number
  dividend_min_balance_kobo: number; dividend_min_months: number; approvals_loan: number
  loan_first_limit_kobo: number; loan_cooling_days: number; year_end_month: number; year_end_day: number
  provisional: string[]
}

export interface MemberSummary {
  member_id: string; card_no: string; status: string; member_since: string; months_member: number
  loans_taken: number; loans_repaid: number; reliability_pct: number | null; has_history: boolean
  guarantees_active: number; guarantees_total: number; guaranteed_active_kobo: number
  contribution_kobo: number; locked_kobo: number; free_kobo: number
  pool_listed: boolean; pool_offer_kobo: number; pool_whatsapp_ok: boolean; pool_note: string | null
  nin_bypassed: boolean; disqualified_this_year: boolean
  history?: { date: string; type: string; delta_kobo: number; balance_kobo: number }[]
}

export interface LoanCard {
  id: string; loan_no: string; status: string; principal_kobo: number; interest_kobo: number; total_kobo: number
  term_months: number; rate_bps: number; purpose: string | null; created_at: string; expires_at: string | null
  due_date: string | null; guaranteed_kobo: number; pending_kobo: number; cover_needed_kobo: number
  total_due_kobo: number; overdue: boolean; decision_note: string | null
}

export interface ScheduleRow {
  n: number; due_date: string; amount_kobo: number; principal_kobo: number; interest_kobo: number
  paid_kobo: number; state: 'paid' | 'late' | 'upcoming'
}

export interface LoanGuarantor {
  guarantee_id: string; member_id: string; name: string; amount_kobo: number; status: string
  signed_at: string | null; expires_at: string
}

export interface LoanDetail extends LoanCard {
  flags: string[]; schedule: ScheduleRow[]; next_instalment: ScheduleRow | null; overdue_days: number
  accrued_charge_kobo: number; charges_due_kobo: number; charges_paid_kobo: number; interest_due_kobo: number
  principal_due_kobo: number; principal_paid_kobo: number; interest_paid_kobo: number
  guarantors: LoanGuarantor[]; steps: { key: string; done: boolean }[]
  overdue_daily_bps: number; overdue_cap_pct: number; still_needed_kobo: number
}

export interface CoopStatus {
  enabled: boolean; access: boolean; test_mode: boolean; is_member: boolean; now: string; clock_offset_days: number
  rules?: PublicRules; member?: MemberSummary; active_loan?: LoanCard | null; pending_invites?: number
}

export interface PoolEntry {
  member_id: string; name: string; card_no: string; months_member: number; offer_kobo: number
  available_kobo: number; reliability_pct: number | null; has_history: boolean; guarantees_active: number
  guarantees_total: number; loans_taken: number; note: string | null; whatsapp_link: string | null
}

export interface InviteRow {
  guarantee_id: string; status: string; amount_kobo: number; loan_no: string; loan_status: string
  principal_kobo: number; borrower: string; borrower_member_id: string; invited_at: string
  expires_at: string; due_date: string | null
}

export interface InviteDetail {
  guarantee_id: string; status: string; amount_kobo: number; expires_at: string
  loan: { loan_no: string; principal_kobo: number; interest_kobo: number; term_months: number; status: string; purpose: string | null }
  borrower: { member_id: string; name: string; card_no: string }
  contract_text: string | null; contract_version: string; ticks: { key: string; label: string }[]
  free_kobo: number; needs_free_kobo: number; eligible: boolean
}

export interface ProfileData {
  member_id: string; name: string; card_no: string; status: string; member_since: string; months_member: number
  loans_taken: number; loans_repaid: number; reliability_pct: number | null; has_history: boolean
  guarantees_active: number; guarantees_total: number; pool_listed: boolean; pool_offer_kobo: number
  pool_note: string | null; nin_linked: boolean; you_are: 'self' | 'director' | 'guarantor' | 'member'
  whatsapp_link?: string
  private?: { phone: string; state: string | null; contribution_kobo: number; locked_kobo: number; free_kobo: number
    history: { date: string; type: string; delta_kobo: number; balance_kobo: number }[] }
}

export interface Transparency {
  range: { start: string; end: string }
  series: { date: string; contributed_kobo: number; withdrawn_kobo: number }[]
  range_totals: { contributed_kobo: number; withdrawn_kobo: number; net_kobo: number }
  cooperative: { members: number; total_contributions_kobo: number; loans_outstanding_kobo: number; loans_active: number }
  profit: {
    year: number; interest_realised_kobo: number; running_cost_kobo: number; overdue_charges_received_kobo: number
    withdrawal_charges_kobo: number; dividend_pool_kobo: number; contribution_share_kobo: number
    guarantee_share_kobo: number; contribution_pct: number; guarantee_pct: number
    overdue_charges_accrued_uncollected_kobo: number; note: string
  }
}

export interface Dividend {
  year: number; pool_kobo: number; contribution_pool_kobo: number; guarantee_pool_kobo: number
  contribution_pct: number; guarantee_pct: number; year_end: string; days_left: number
  qualified_members: number; basis: string; pool_note: string
  me?: {
    qualifies: boolean; reason: string; contribution_share_kobo: number; guarantee_share_kobo: number
    total_kobo: number; contribution_weight_pct: number; guarantee_weight_pct: number; balance_kobo: number
    with_extra?: { extra_kobo: number; total_kobo: number; gain_kobo: number; qualifies: boolean }
  }
  members?: { member_id: string; name: string; card_no: string; balance_kobo: number; qualifies: boolean
    reason: string; contribution_share_kobo: number; guarantee_share_kobo: number; total_kobo: number }[]
  paid_out_check_kobo?: number
}

/* ───────── queries ───────── */
const KEY = ['coop']

export function useCoopStatus() {
  return useQuery<CoopStatus>({
    queryKey: [...KEY, 'status'],
    queryFn: async () => (await api.get('/coop/status')).data,
    staleTime: 15_000,
  })
}
export const useMe = () => useQuery<MemberSummary>({ queryKey: [...KEY, 'me'], queryFn: async () => (await api.get('/coop/me')).data })
export const useLoans = () => useQuery<LoanCard[]>({ queryKey: [...KEY, 'loans'], queryFn: async () => (await api.get('/coop/loans')).data })
export const useLoan = (id?: string) => useQuery<LoanDetail>({
  queryKey: [...KEY, 'loan', id], enabled: !!id, queryFn: async () => (await api.get(`/coop/loans/${id}`)).data,
})
export const usePool = () => useQuery<PoolEntry[]>({ queryKey: [...KEY, 'pool'], queryFn: async () => (await api.get('/coop/pool')).data })
export const useInvites = () => useQuery<InviteRow[]>({ queryKey: [...KEY, 'invites'], queryFn: async () => (await api.get('/coop/invites')).data })
export const useInvite = (id?: string) => useQuery<InviteDetail>({
  queryKey: [...KEY, 'invite', id], enabled: !!id, queryFn: async () => (await api.get(`/coop/invites/${id}`)).data,
})
export const useProfile = (id?: string) => useQuery<ProfileData>({
  queryKey: [...KEY, 'profile', id], enabled: !!id, queryFn: async () => (await api.get(`/coop/members/${id}/profile`)).data,
})
export const usePoolMe = () => useQuery<{ listed: boolean; offer_kobo: number; whatsapp_ok: boolean; note: string | null; free_kobo: number; min_kobo: number; max_kobo: number }>({
  queryKey: [...KEY, 'pool-me'], queryFn: async () => (await api.get('/coop/pool/me')).data,
})
export function useTransparency(range: string, start?: string, end?: string) {
  return useQuery<Transparency>({
    queryKey: [...KEY, 'transparency', range, start, end],
    enabled: range !== 'custom' || (!!start && !!end),
    queryFn: async () => (await api.get('/coop/transparency', { params: { range, start, end } })).data,
    placeholderData: (prev) => prev,
  })
}
export const useDividend = (extraKobo: number) => useQuery<Dividend>({
  queryKey: [...KEY, 'dividend', extraKobo], queryFn: async () => (await api.get('/coop/dividend', { params: { extra_kobo: extraKobo } })).data,
  placeholderData: (prev) => prev,
})

/** One mutation helper: runs the call, refreshes every cooperative screen, shows the server's plain-language error. */
export function useCoopAction<TVars, TRes = any>(fn: (v: TVars) => Promise<TRes>, opts?: { success?: string; onSuccess?: (r: TRes) => void }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: KEY })
      if (opts?.success) toast.success(opts.success)
      opts?.onSuccess?.(r)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
}

export const post = async <T = any>(url: string, body?: unknown) => (await api.post<T>(url, body)).data
export const put = async <T = any>(url: string, body?: unknown) => (await api.put<T>(url, body)).data
