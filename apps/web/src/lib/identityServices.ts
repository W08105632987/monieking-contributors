import { Fingerprint, Landmark, Receipt, FileCheck2, Building2, Store, Smartphone, Zap, type LucideIcon } from 'lucide-react'
import type { IdentityServiceCategory } from '@/types'

export const CATEGORY_LABEL: Record<IdentityServiceCategory, string> = {
  nimc:        'NIMC services',
  bvn:         'BVN services',
  tin:         'TIN registration',
  attestation: 'Attestation',
  cac:         'CAC+',
  vendor:      'Become a vendor',
  airtime:     'Airtime & data',
  bills:       'Bill payments',
}

export const CATEGORY_ICON: Record<IdentityServiceCategory, LucideIcon> = {
  nimc:        Fingerprint,
  bvn:         Landmark,
  tin:         Receipt,
  attestation: FileCheck2,
  cac:         Building2,
  vendor:      Store,
  airtime:     Smartphone,
  bills:       Zap,
}

export const CATEGORY_ORDER: IdentityServiceCategory[] = [
  'nimc', 'bvn', 'tin', 'attestation', 'cac', 'vendor', 'airtime', 'bills',
]
