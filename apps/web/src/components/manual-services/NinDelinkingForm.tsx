import { useState, useEffect } from 'react'
import { FileUploadField } from './FileUploadField'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
    price_kobo: number
  }) => void
}

const DELINKING_TYPES = [
  {
    id: 'self_service_delinking',
    label: 'Self-Service Delinking',
    priceKobo: 350_000,
    priceDisplay: '₦3,500.00',
    description: 'Delink your SIM or account from NIN through self-service',
  },
  {
    id: 'email_retrieval',
    label: 'Email Retrieval Delinking',
    priceKobo: 350_000,
    priceDisplay: '₦3,500.00',
    description: 'Delink using email retrieval process',
  },
]

export function NinDelinkingForm({ onChange }: Props) {
  const [delinkType, setDelinkType] = useState('self_service_delinking')
  const [data, setData] = useState<Record<string, any>>({
    nin: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    dob: '',
    reason_for_delinking: '',
    account_to_delink: '',
    supporting_doc_url: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const activeType = DELINKING_TYPES.find(d => d.id === delinkType) || DELINKING_TYPES[0]

  useEffect(() => {
    onChange({
      service_type: delinkType,
      form_data: { ...data, delinking_type: delinkType, delinking_label: activeType.label },
      uploaded_files: data.supporting_doc_url ? [data.supporting_doc_url] : [],
      price_kobo: activeType.priceKobo,
    })
  }, [delinkType, data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* Delinking Type */}
      <div className="space-y-2">
        <p className={labelCls}>Delinking Type <span className="text-red-500">*</span></p>
        {DELINKING_TYPES.map(dt => (
          <button
            key={dt.id}
            type="button"
            onClick={() => setDelinkType(dt.id)}
            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all ${
              delinkType === dt.id
                ? 'border-green-600 bg-green-50 dark:bg-night-600 ring-1 ring-green-600'
                : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-700 hover:border-green-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] ${
                delinkType === dt.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 dark:border-night-400'
              }`}>
                {delinkType === dt.id && '✓'}
              </span>
              <div>
                <p className="text-sm font-bold text-green-950 dark:text-white">{dt.label}</p>
                <p className="text-xs text-green-500 dark:text-night-300">{dt.description}</p>
              </div>
            </div>
            <span className="text-sm font-extrabold text-green-700 dark:text-night-200 shrink-0 ml-2">{dt.priceDisplay}</span>
          </button>
        ))}
      </div>

      {/* NIN */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>NIN Details</p>
        <div>
          <label className={labelCls}>NIN (National Identity Number) <span className="text-red-500">*</span></label>
          <input type="text" maxLength={11} value={data.nin} onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
            placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <label className={labelCls}>Account / Phone to Delink <span className="text-red-500">*</span></label>
          <input type="text" value={data.account_to_delink} onChange={e => update('account_to_delink', e.target.value)}
            placeholder="Phone number or account to be delinked" className={inputCls} />
        </div>
      </div>

      {/* Personal Information */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Personal Information</p>
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
        <div>
          <label className={labelCls}>Phone Number <span className="text-red-500">*</span></label>
          <input type="tel" value={data.phone_number} onChange={e => update('phone_number', e.target.value)}
            placeholder="e.g. 08012345678" className={inputCls} />
        </div>
        {delinkType === 'email_retrieval' && (
          <div>
            <label className={labelCls}>Email Address <span className="text-red-500">*</span></label>
            <input type="email" value={data.email} onChange={e => update('email', e.target.value)}
              placeholder="e.g. john@example.com" className={inputCls} />
          </div>
        )}
      </div>

      {/* Reason */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
        <p className={labelCls}>Reason for Delinking</p>
        <textarea rows={3} value={data.reason_for_delinking} onChange={e => update('reason_for_delinking', e.target.value)}
          placeholder="Briefly explain why you need to delink this account..."
          className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm text-green-950 dark:text-white outline-none focus:border-green-500 resize-none" />
      </div>

      {/* Supporting Document */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
        <p className={labelCls}>Supporting Document</p>
        <p className="text-xs text-green-500 dark:text-night-300">Upload any supporting document (e.g. affidavit, ID card, court order).</p>
        <FileUploadField
          label="Upload Supporting Document"
          value={data.supporting_doc_url}
          onChange={url => update('supporting_doc_url', url)}
          accept="image/*,application/pdf"
        />
      </div>
    </div>
  )
}
