import { useState, useEffect } from 'react'
import { NIGERIAN_STATES } from './constants'
import { FileUploadField } from './FileUploadField'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
    price_kobo: number
  }) => void
}

const CAC_TYPES = [
  {
    id: 'business_name',
    label: 'Business Name Registration',
    priceKobo: 3_500_000,
    priceDisplay: '₦35,000.00',
    description: 'Register a sole proprietorship or partnership business name (CAC BN)',
  },
  {
    id: 'company',
    label: 'Limited Liability Company',
    priceKobo: 5_000_000,
    priceDisplay: '₦50,000.00',
    description: 'Incorporate a private limited liability company (CAC RC)',
  },
]

const BUSINESS_NATURE = [
  'Trading / Commerce',
  'Manufacturing / Production',
  'Construction',
  'Real Estate',
  'Agriculture',
  'ICT / Technology',
  'Education',
  'Healthcare',
  'Logistics / Transport',
  'Financial Services',
  'Consulting / Professional Services',
  'Entertainment / Media',
  'Food & Beverage',
  'Fashion / Textiles',
  'Other',
]

export function CacRegistrationForm({ onChange }: Props) {
  const [cacType, setCacType] = useState('business_name')
  const [data, setData] = useState<Record<string, any>>({
    // Common fields
    proposed_name_1: '',
    proposed_name_2: '',
    proposed_name_3: '',
    nature_of_business: '',
    business_address: '',
    state: '',
    city: '',
    lga: '',
    postal_code: '',
    email: '',
    phone: '',
    // Proprietor / Director 1
    proprietor_first_name: '',
    proprietor_middle_name: '',
    proprietor_last_name: '',
    proprietor_nin: '',
    proprietor_bvn: '',
    proprietor_dob: '',
    proprietor_phone: '',
    proprietor_email: '',
    proprietor_address: '',
    proprietor_occupation: '',
    // Director 2 (for company)
    director2_full_name: '',
    director2_nin: '',
    director2_phone: '',
    // Documents
    proprietor_id_url: '',
    proprietor_photo_url: '',
    director2_id_url: '',
    director2_photo_url: '',
    signature_url: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const activeType = CAC_TYPES.find(c => c.id === cacType) || CAC_TYPES[0]

  useEffect(() => {
    const uploadedFiles = [
      data.proprietor_id_url,
      data.proprietor_photo_url,
      data.director2_id_url,
      data.director2_photo_url,
      data.signature_url,
    ].filter(Boolean)

    onChange({
      service_type: cacType,
      form_data: { ...data, cac_type: cacType, cac_type_label: activeType.label },
      uploaded_files: uploadedFiles,
      price_kobo: activeType.priceKobo,
    })
  }, [cacType, data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const selectCls = `${inputCls} appearance-none`
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* CAC Type Selection */}
      <div className="space-y-2">
        <p className={labelCls}>Registration Type <span className="text-red-500">*</span></p>
        {CAC_TYPES.map(ct => (
          <button
            key={ct.id}
            type="button"
            onClick={() => setCacType(ct.id)}
            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all ${
              cacType === ct.id
                ? 'border-green-600 bg-green-50 dark:bg-night-600 ring-1 ring-green-600'
                : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-700 hover:border-green-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] ${
                cacType === ct.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 dark:border-night-400'
              }`}>
                {cacType === ct.id && '✓'}
              </span>
              <div>
                <p className="text-sm font-bold text-green-950 dark:text-white">{ct.label}</p>
                <p className="text-xs text-green-500 dark:text-night-300">{ct.description}</p>
              </div>
            </div>
            <span className="text-sm font-extrabold text-green-700 dark:text-night-200 shrink-0 ml-2">{ct.priceDisplay}</span>
          </button>
        ))}
      </div>

      {/* Proposed Names */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Proposed Business Names (in order of preference)</p>
        <div>
          <label className={labelCls}>1st Choice <span className="text-red-500">*</span></label>
          <input type="text" value={data.proposed_name_1} onChange={e => update('proposed_name_1', e.target.value)}
            placeholder="e.g. ABC Ventures" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>2nd Choice <span className="text-red-500">*</span></label>
          <input type="text" value={data.proposed_name_2} onChange={e => update('proposed_name_2', e.target.value)}
            placeholder="e.g. ABC Global Ventures" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>3rd Choice</label>
          <input type="text" value={data.proposed_name_3} onChange={e => update('proposed_name_3', e.target.value)}
            placeholder="e.g. ABC International Ventures" className={inputCls} />
        </div>
      </div>

      {/* Business Details */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Business Details</p>
        <div>
          <label className={labelCls}>Nature of Business <span className="text-red-500">*</span></label>
          <select value={data.nature_of_business} onChange={e => update('nature_of_business', e.target.value)} className={selectCls}>
            <option value="">Select nature of business</option>
            {BUSINESS_NATURE.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Business Address <span className="text-red-500">*</span></label>
          <input type="text" value={data.business_address} onChange={e => update('business_address', e.target.value)}
            placeholder="Street address of the business" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>City <span className="text-red-500">*</span></label>
          <input type="text" value={data.city} onChange={e => update('city', e.target.value)}
            placeholder="e.g. Lagos" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>LGA <span className="text-red-500">*</span></label>
          <input type="text" value={data.lga} onChange={e => update('lga', e.target.value)}
            placeholder="e.g. Ikeja" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>State <span className="text-red-500">*</span></label>
          <select value={data.state} onChange={e => update('state', e.target.value)} className={selectCls}>
            <option value="">Select state</option>
            {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Business Email <span className="text-red-500">*</span></label>
          <input type="email" value={data.email} onChange={e => update('email', e.target.value)}
            placeholder="e.g. info@business.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Business Phone <span className="text-red-500">*</span></label>
          <input type="tel" value={data.phone} onChange={e => update('phone', e.target.value)}
            placeholder="e.g. 08012345678" className={inputCls} />
        </div>
      </div>

      {/* Proprietor / Director 1 */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>{cacType === 'business_name' ? 'Proprietor' : 'Director 1'} Information</p>
        <div>
          <label className={labelCls}>First Name <span className="text-red-500">*</span></label>
          <input type="text" value={data.proprietor_first_name} onChange={e => update('proprietor_first_name', e.target.value)}
            placeholder="e.g. John" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Middle Name</label>
          <input type="text" value={data.proprietor_middle_name} onChange={e => update('proprietor_middle_name', e.target.value)}
            placeholder="e.g. Emeka" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Last Name / Surname <span className="text-red-500">*</span></label>
          <input type="text" value={data.proprietor_last_name} onChange={e => update('proprietor_last_name', e.target.value)}
            placeholder="e.g. Doe" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>NIN <span className="text-red-500">*</span></label>
          <input type="text" maxLength={11} value={data.proprietor_nin} onChange={e => update('proprietor_nin', e.target.value.replace(/\D/g, ''))}
            placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <label className={labelCls}>BVN <span className="text-red-500">*</span></label>
          <input type="text" maxLength={11} value={data.proprietor_bvn} onChange={e => update('proprietor_bvn', e.target.value.replace(/\D/g, ''))}
            placeholder="11-digit BVN" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <label className={labelCls}>Date of Birth <span className="text-red-500">*</span></label>
          <input type="date" value={data.proprietor_dob} onChange={e => update('proprietor_dob', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone Number <span className="text-red-500">*</span></label>
          <input type="tel" value={data.proprietor_phone} onChange={e => update('proprietor_phone', e.target.value)}
            placeholder="e.g. 08012345678" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Email Address <span className="text-red-500">*</span></label>
          <input type="email" value={data.proprietor_email} onChange={e => update('proprietor_email', e.target.value)}
            placeholder="e.g. john@example.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Residential Address <span className="text-red-500">*</span></label>
          <input type="text" value={data.proprietor_address} onChange={e => update('proprietor_address', e.target.value)}
            placeholder="Full residential address" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Occupation <span className="text-red-500">*</span></label>
          <input type="text" value={data.proprietor_occupation} onChange={e => update('proprietor_occupation', e.target.value)}
            placeholder="e.g. Businessman, Trader, Engineer" className={inputCls} />
        </div>
      </div>

      {/* Director 2 (Company only) */}
      {cacType === 'company' && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
          <p className={labelCls}>Director 2 Information (Required for LLC)</p>
          <div>
            <label className={labelCls}>Full Name <span className="text-red-500">*</span></label>
            <input type="text" value={data.director2_full_name} onChange={e => update('director2_full_name', e.target.value)}
              placeholder="e.g. Jane Doe" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>NIN <span className="text-red-500">*</span></label>
            <input type="text" maxLength={11} value={data.director2_nin} onChange={e => update('director2_nin', e.target.value.replace(/\D/g, ''))}
              placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className={labelCls}>Phone Number <span className="text-red-500">*</span></label>
            <input type="tel" value={data.director2_phone} onChange={e => update('director2_phone', e.target.value)}
              placeholder="e.g. 08098765432" className={inputCls} />
          </div>
        </div>
      )}

      {/* Document Uploads */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-5">
        <p className={labelCls}>Required Documents</p>
        <div>
          <label className={labelCls}>{cacType === 'business_name' ? 'Proprietor' : 'Director 1'} — Valid ID Card <span className="text-red-500">*</span></label>
          <FileUploadField label="Upload ID Card" value={data.proprietor_id_url} onChange={url => update('proprietor_id_url', url)} accept="image/*,application/pdf" />
        </div>
        <div>
          <label className={labelCls}>{cacType === 'business_name' ? 'Proprietor' : 'Director 1'} — Passport Photograph <span className="text-red-500">*</span></label>
          <FileUploadField label="Upload Passport Photo" value={data.proprietor_photo_url} onChange={url => update('proprietor_photo_url', url)} accept="image/*" />
        </div>
        {cacType === 'company' && (
          <>
            <div>
              <label className={labelCls}>Director 2 — Valid ID Card <span className="text-red-500">*</span></label>
              <FileUploadField label="Upload Director 2 ID" value={data.director2_id_url} onChange={url => update('director2_id_url', url)} accept="image/*,application/pdf" />
            </div>
            <div>
              <label className={labelCls}>Director 2 — Passport Photograph <span className="text-red-500">*</span></label>
              <FileUploadField label="Upload Director 2 Photo" value={data.director2_photo_url} onChange={url => update('director2_photo_url', url)} accept="image/*" />
            </div>
          </>
        )}
        <div>
          <label className={labelCls}>Signature (Optional)</label>
          <p className="text-xs text-green-500 dark:text-night-300 mb-2">Upload a scanned copy of your signature on white paper.</p>
          <FileUploadField label="Upload Signature" value={data.signature_url} onChange={url => update('signature_url', url)} accept="image/*" />
        </div>
      </div>
    </div>
  )
}
