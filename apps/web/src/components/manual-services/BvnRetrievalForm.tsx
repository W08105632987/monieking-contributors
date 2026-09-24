import { useState, useEffect } from 'react'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
    price_kobo: number
  }) => void
}

const RETRIEVAL_TYPES = [
  {
    id: 'phone_number',
    label: 'Phone Number Retrieval',
    priceKobo: 70_000,
    priceDisplay: '₦700.00',
    description: 'Retrieve a lost BVN using a phone number',
  },
  {
    id: 'crm_investigation',
    label: 'CRM Investigation',
    priceKobo: 200_000,
    priceDisplay: '₦2,000.00',
    description: 'Deep investigation of BVN records via CRM',
  },
]

export function BvnRetrievalForm({ onChange }: Props) {
  const [retrievalType, setRetrievalType] = useState('phone_number')
  const [data, setData] = useState<Record<string, any>>({
    bvn: '',
    phone_number: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    account_number: '',
    bank_name: '',
    dob: '',
    crm_details: '',
  })

  const update = (key: string, val: string) => setData(prev => ({ ...prev, [key]: val }))

  const activeType = RETRIEVAL_TYPES.find(r => r.id === retrievalType) || RETRIEVAL_TYPES[0]

  useEffect(() => {
    onChange({
      service_type: retrievalType,
      form_data: { ...data, retrieval_type: retrievalType, retrieval_label: activeType.label },
      uploaded_files: [],
      price_kobo: activeType.priceKobo,
    })
  }, [retrievalType, data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* Retrieval Type */}
      <div className="space-y-2">
        <p className={labelCls}>Retrieval Type <span className="text-red-500">*</span></p>
        {RETRIEVAL_TYPES.map(rt => (
          <button
            key={rt.id}
            type="button"
            onClick={() => setRetrievalType(rt.id)}
            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all ${
              retrievalType === rt.id
                ? 'border-green-600 bg-green-50 dark:bg-night-600 ring-1 ring-green-600'
                : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-700 hover:border-green-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] ${
                retrievalType === rt.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 dark:border-night-400'
              }`}>
                {retrievalType === rt.id && '✓'}
              </span>
              <div>
                <p className="text-sm font-bold text-green-950 dark:text-white">{rt.label}</p>
                <p className="text-xs text-green-500 dark:text-night-300">{rt.description}</p>
              </div>
            </div>
            <span className="text-sm font-extrabold text-green-700 dark:text-night-200 shrink-0 ml-2">{rt.priceDisplay}</span>
          </button>
        ))}
      </div>

      {/* Common Fields */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Personal Information</p>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className={labelCls}>First Name <span className="text-red-500">*</span></label>
            <input type="text" value={data.first_name} onChange={e => update('first_name', e.target.value)}
              placeholder="e.g. John" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Middle Name</label>
            <input type="text" value={data.middle_name} onChange={e => update('middle_name', e.target.value)}
              placeholder="e.g. Emeka" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Last Name / Surname <span className="text-red-500">*</span></label>
            <input type="text" value={data.last_name} onChange={e => update('last_name', e.target.value)}
              placeholder="e.g. Doe" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date of Birth <span className="text-red-500">*</span></label>
            <input type="date" value={data.dob} onChange={e => update('dob', e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Phone Number Mode Fields */}
      {retrievalType === 'phone_number' && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
          <p className={labelCls}>Phone & Account Details</p>
          <div>
            <label className={labelCls}>Phone Number <span className="text-red-500">*</span></label>
            <input type="tel" value={data.phone_number} onChange={e => update('phone_number', e.target.value)}
              placeholder="e.g. 08012345678" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Account Number <span className="text-red-500">*</span></label>
            <input type="text" maxLength={10} value={data.account_number} onChange={e => update('account_number', e.target.value.replace(/\D/g, ''))}
              placeholder="10-digit account number" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bank Name <span className="text-red-500">*</span></label>
            <input type="text" value={data.bank_name} onChange={e => update('bank_name', e.target.value)}
              placeholder="e.g. Access Bank" className={inputCls} />
          </div>
        </div>
      )}

      {/* CRM Investigation Mode Fields */}
      {retrievalType === 'crm_investigation' && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
          <p className={labelCls}>CRM Investigation Details</p>
          <div>
            <label className={labelCls}>BVN (if known)</label>
            <input type="text" maxLength={11} value={data.bvn} onChange={e => update('bvn', e.target.value.replace(/\D/g, ''))}
              placeholder="11-digit BVN (optional if unknown)" className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className={labelCls}>Account Number</label>
            <input type="text" maxLength={10} value={data.account_number} onChange={e => update('account_number', e.target.value.replace(/\D/g, ''))}
              placeholder="10-digit account number" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bank Name</label>
            <input type="text" value={data.bank_name} onChange={e => update('bank_name', e.target.value)}
              placeholder="e.g. First Bank" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Additional Details / Description <span className="text-red-500">*</span></label>
            <textarea rows={4} value={data.crm_details} onChange={e => update('crm_details', e.target.value)}
              placeholder="Describe the issue or information to investigate in CRM..."
              className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm text-green-950 dark:text-white outline-none focus:border-green-500 resize-none" />
          </div>
        </div>
      )}
    </div>
  )
}
