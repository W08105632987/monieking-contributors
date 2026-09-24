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

const TIN_TYPES = [
  {
    id: 'individual',
    label: 'Individual TIN Registration',
    priceKobo: 150_000,
    priceDisplay: '₦1,500.00',
    description: 'Register a TIN for a private individual',
  },
  {
    id: 'company',
    label: 'Company / Business TIN Registration',
    priceKobo: 450_000,
    priceDisplay: '₦4,500.00',
    description: 'Register a TIN for a company or business entity',
  },
]

const TITLE_OPTIONS = ['Mr.', 'Mrs.', 'Miss', 'Dr.', 'Prof.', 'Chief', 'Alhaji', 'Alhaja']
const BUSINESS_TYPES = ['Sole Proprietorship', 'Partnership', 'Limited Liability Company (LLC)', 'Public Limited Company (PLC)', 'NGO / Non-Profit', 'Other']

export function TinRegistrationForm({ onChange }: Props) {
  const [tinType, setTinType] = useState('individual')
  const [data, setData] = useState<Record<string, any>>({
    // Individual fields
    title: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    nin: '',
    bvn: '',
    phone_number: '',
    email: '',
    dob: '',
    state_of_origin: '',
    lga: '',
    residential_address: '',
    state_of_residence: '',
    // Company fields
    company_name: '',
    rc_number: '',
    business_type: '',
    business_address: '',
    company_email: '',
    company_phone: '',
    date_of_incorporation: '',
    director_name: '',
    director_nin: '',
    director_phone: '',
    // Supporting docs
    id_card_url: '',
    cac_doc_url: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const activeType = TIN_TYPES.find(t => t.id === tinType) || TIN_TYPES[0]

  useEffect(() => {
    const uploadedFiles = [data.id_card_url, data.cac_doc_url].filter(Boolean)
    onChange({
      service_type: tinType,
      form_data: { ...data, tin_type: tinType, tin_type_label: activeType.label },
      uploaded_files: uploadedFiles,
      price_kobo: activeType.priceKobo,
    })
  }, [tinType, data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const selectCls = `${inputCls} appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%236b7280' d='M4 6l4 4 4-4'/%3E%3C/svg%3E")] bg-no-repeat bg-right-3`
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* TIN Type Selection */}
      <div className="space-y-2">
        <p className={labelCls}>Registration Type <span className="text-red-500">*</span></p>
        {TIN_TYPES.map(tt => (
          <button
            key={tt.id}
            type="button"
            onClick={() => setTinType(tt.id)}
            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all ${
              tinType === tt.id
                ? 'border-green-600 bg-green-50 dark:bg-night-600 ring-1 ring-green-600'
                : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-700 hover:border-green-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] ${
                tinType === tt.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 dark:border-night-400'
              }`}>
                {tinType === tt.id && '✓'}
              </span>
              <div>
                <p className="text-sm font-bold text-green-950 dark:text-white">{tt.label}</p>
                <p className="text-xs text-green-500 dark:text-night-300">{tt.description}</p>
              </div>
            </div>
            <span className="text-sm font-extrabold text-green-700 dark:text-night-200 shrink-0 ml-2">{tt.priceDisplay}</span>
          </button>
        ))}
      </div>

      {/* Individual Registration Fields */}
      {tinType === 'individual' && (
        <>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
            <p className={labelCls}>Personal Information</p>
            <div>
              <label className={labelCls}>Title</label>
              <select value={data.title} onChange={e => update('title', e.target.value)} className={selectCls}>
                <option value="">Select title</option>
                {TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
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
            <div>
              <label className={labelCls}>Email Address</label>
              <input type="email" value={data.email} onChange={e => update('email', e.target.value)}
                placeholder="e.g. john@example.com" className={inputCls} />
            </div>
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
            <p className={labelCls}>Identity & Location</p>
            <div>
              <label className={labelCls}>NIN <span className="text-red-500">*</span></label>
              <input type="text" maxLength={11} value={data.nin} onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
                placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>BVN</label>
              <input type="text" maxLength={11} value={data.bvn} onChange={e => update('bvn', e.target.value.replace(/\D/g, ''))}
                placeholder="11-digit BVN" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>State of Origin <span className="text-red-500">*</span></label>
              <select value={data.state_of_origin} onChange={e => update('state_of_origin', e.target.value)} className={selectCls}>
                <option value="">Select state</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>LGA <span className="text-red-500">*</span></label>
              <input type="text" value={data.lga} onChange={e => update('lga', e.target.value)}
                placeholder="Local Government Area" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Residential Address <span className="text-red-500">*</span></label>
              <input type="text" value={data.residential_address} onChange={e => update('residential_address', e.target.value)}
                placeholder="Full residential address" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>State of Residence <span className="text-red-500">*</span></label>
              <select value={data.state_of_residence} onChange={e => update('state_of_residence', e.target.value)} className={selectCls}>
                <option value="">Select state</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
            <p className={labelCls}>Means of Identification <span className="text-red-500">*</span></p>
            <p className="text-xs text-green-500 dark:text-night-300">Upload a valid government-issued ID card (NIN slip, International Passport, Driver's License, Voter's Card).</p>
            <FileUploadField label="Upload ID Card" value={data.id_card_url} onChange={url => update('id_card_url', url)} accept="image/*,application/pdf" />
          </div>
        </>
      )}

      {/* Company Registration Fields */}
      {tinType === 'company' && (
        <>
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
            <p className={labelCls}>Company Information</p>
            <div>
              <label className={labelCls}>Company / Business Name <span className="text-red-500">*</span></label>
              <input type="text" value={data.company_name} onChange={e => update('company_name', e.target.value)}
                placeholder="e.g. ABC Enterprises Ltd." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>RC Number (CAC Registration Number) <span className="text-red-500">*</span></label>
              <input type="text" value={data.rc_number} onChange={e => update('rc_number', e.target.value)}
                placeholder="e.g. RC1234567" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Type of Business <span className="text-red-500">*</span></label>
              <select value={data.business_type} onChange={e => update('business_type', e.target.value)} className={selectCls}>
                <option value="">Select business type</option>
                {BUSINESS_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date of Incorporation <span className="text-red-500">*</span></label>
              <input type="date" value={data.date_of_incorporation} onChange={e => update('date_of_incorporation', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Company Email <span className="text-red-500">*</span></label>
              <input type="email" value={data.company_email} onChange={e => update('company_email', e.target.value)}
                placeholder="e.g. info@company.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Company Phone <span className="text-red-500">*</span></label>
              <input type="tel" value={data.company_phone} onChange={e => update('company_phone', e.target.value)}
                placeholder="e.g. 08012345678" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Business Address <span className="text-red-500">*</span></label>
              <input type="text" value={data.business_address} onChange={e => update('business_address', e.target.value)}
                placeholder="Full registered business address" className={inputCls} />
            </div>
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
            <p className={labelCls}>Director / Proprietor Information</p>
            <div>
              <label className={labelCls}>Director Full Name <span className="text-red-500">*</span></label>
              <input type="text" value={data.director_name} onChange={e => update('director_name', e.target.value)}
                placeholder="e.g. John Doe" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Director NIN <span className="text-red-500">*</span></label>
              <input type="text" maxLength={11} value={data.director_nin} onChange={e => update('director_nin', e.target.value.replace(/\D/g, ''))}
                placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>Director Phone <span className="text-red-500">*</span></label>
              <input type="tel" value={data.director_phone} onChange={e => update('director_phone', e.target.value)}
                placeholder="e.g. 08012345678" className={inputCls} />
            </div>
          </div>

          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
            <p className={labelCls}>CAC Certificate / Incorporation Document <span className="text-red-500">*</span></p>
            <FileUploadField label="Upload CAC Document" value={data.cac_doc_url} onChange={url => update('cac_doc_url', url)} accept="image/*,application/pdf" />
          </div>
        </>
      )}
    </div>
  )
}
