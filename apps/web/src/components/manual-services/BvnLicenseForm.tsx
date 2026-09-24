import { useState, useEffect } from 'react'
import { ENROLLMENT_BANKS } from './constants'
import { FileUploadField } from './FileUploadField'

interface Props {
  onChange: (payload: {
    service_type: string
    enrollment_bank?: string
    form_data: Record<string, any>
    uploaded_files: string[]
    price_kobo: number
  }) => void
}

// ₦7,000 fixed regardless of bank
const PRICE_KOBO = 700_000

export function BvnLicenseForm({ onChange }: Props) {
  const [enrollmentBank, setEnrollmentBank] = useState('agency')
  const [data, setData] = useState<Record<string, any>>({
    bvn: '',
    nin: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    phone_number: '',
    dob: '',
    screenshot_url: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const selectedBankObj = ENROLLMENT_BANKS.find(b => b.id === enrollmentBank) || ENROLLMENT_BANKS[0]

  useEffect(() => {
    onChange({
      service_type: 'bvn_license',
      enrollment_bank: enrollmentBank,
      form_data: {
        ...data,
        enrollment_bank: selectedBankObj.label,
      },
      uploaded_files: data.screenshot_url ? [data.screenshot_url] : [],
      price_kobo: PRICE_KOBO,
    })
  }, [enrollmentBank, data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* Info Banner */}
      <div className="bg-amber-50 dark:bg-night-700 border border-amber-200 dark:border-night-500 rounded-2xl p-4">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          BVN License Creation is a fixed ₦7,000 service. A new BVN will be created and registered with your selected enrollment bank.
        </p>
      </div>

      {/* Enrollment Bank Selection */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
        <p className={labelCls}>Enrollment Bank <span className="text-red-500">*</span></p>
        <div className="grid grid-cols-2 gap-2">
          {ENROLLMENT_BANKS.map(bank => (
            <button
              key={bank.id}
              type="button"
              onClick={() => setEnrollmentBank(bank.id)}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold border-2 text-center transition-all ${
                enrollmentBank === bank.id
                  ? 'border-green-600 bg-green-50 dark:bg-night-600 text-green-900 dark:text-white'
                  : 'border-green-100 dark:border-night-500 bg-white dark:bg-night-800 text-green-700 dark:text-night-200 hover:border-green-300'
              }`}
            >
              {bank.label}
            </button>
          ))}
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
      </div>

      {/* Identity Numbers */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Identity Numbers</p>

        <div>
          <label className={labelCls}>NIN (National Identity Number) <span className="text-red-500">*</span></label>
          <input type="text" maxLength={11} value={data.nin} onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
            placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <label className={labelCls}>Existing BVN (if any)</label>
          <input type="text" maxLength={11} value={data.bvn} onChange={e => update('bvn', e.target.value.replace(/\D/g, ''))}
            placeholder="11-digit BVN (leave blank if none)" className={`${inputCls} font-mono`} />
        </div>
      </div>

      {/* Supporting Document */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
        <p className={labelCls}>Supporting Document (Optional)</p>
        <p className="text-xs text-green-500 dark:text-night-300">Upload any relevant document such as a government-issued ID or screenshot.</p>
        <FileUploadField
          label="Upload Document"
          value={data.screenshot_url}
          onChange={url => update('screenshot_url', url)}
          accept="image/*,application/pdf"
        />
      </div>
    </div>
  )
}
