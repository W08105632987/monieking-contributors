import { useState, useEffect } from 'react'
import { useManualPricing, priceLabel } from '@/lib/manualServices'
import { NIGERIAN_STATES } from './constants'
import { FileUploadField } from './FileUploadField'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
  }) => void
}

const MOD_OPTIONS = [
  { id: 'update_name', label: 'Update Name', isCombo: false },
  { id: 'update_phone', label: 'Update Phone Number', isCombo: false },
  { id: 'update_address', label: 'Update Address', isCombo: false },
  { id: 'update_name_phone', label: 'Update Name & Phone', isCombo: true },
  { id: 'update_name_dob', label: 'Update Name & DOB', isCombo: true },
]

export function SelfServiceModificationForm({ onChange }: Props) {
  const { priceOf } = useManualPricing()
  const [modType, setModType] = useState('update_name')
  const [data, setData] = useState<Record<string, any>>({
    nin: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    phone_number: '',
    new_dob: '',
    address_line_1: '',
    address_line_2: '',
    town_city: '',
    state: '',
    lga: '',
    postal_code: '',
    affidavit_url: '',
    supporting_doc_url: '',
    court_order_url: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const activeOpt = MOD_OPTIONS.find(m => m.id === modType) || MOD_OPTIONS[0]

  const showNameFields = ['update_name', 'update_name_phone', 'update_name_dob'].includes(modType)
  const showPhoneField = ['update_phone', 'update_name_phone'].includes(modType)
  const showAddressFields = modType === 'update_address'
  const showDobField = ['update_name_dob'].includes(modType)

  useEffect(() => {
    const uploadedFiles = [data.affidavit_url, data.supporting_doc_url, data.court_order_url].filter(Boolean)
    onChange({
      service_type: modType,
      form_data: { ...data, modification_type: modType, modification_label: activeOpt.label },
      uploaded_files: uploadedFiles,
    })
  }, [modType, data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const selectCls = `${inputCls} appearance-none`
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-night-700 border border-blue-200 dark:border-night-500 rounded-2xl p-4">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
          Self-Service NIN Modification allows you to update your NIN record directly. An affidavit is required for name changes.
        </p>
      </div>

      {/* Modification Type */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-3">
        <p className={labelCls}>What would you like to modify? <span className="text-red-500">*</span></p>
        <div className="space-y-2">
          {MOD_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setModType(opt.id)}
              className={`w-full flex items-center justify-between p-3.5 rounded-xl border-2 text-left transition-all ${
                modType === opt.id
                  ? 'border-green-600 bg-green-50 dark:bg-night-600 ring-1 ring-green-600'
                  : 'border-green-100 dark:border-night-600 bg-white dark:bg-night-800 hover:border-green-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] ${
                  modType === opt.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 dark:border-night-400'
                }`}>
                  {modType === opt.id && '✓'}
                </span>
                <span className="text-xs font-bold text-green-950 dark:text-white">{opt.label}</span>
              </div>
              <span className="text-xs font-extrabold text-green-700 dark:text-night-200">{priceLabel(priceOf('self_service_modification', opt.id))}</span>
            </button>
          ))}
        </div>
      </div>

      {/* NIN */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4">
        <label className={labelCls}>NIN (National Identity Number) <span className="text-red-500">*</span></label>
        <input type="text" maxLength={11} value={data.nin} onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
          placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
      </div>

      {/* Name Fields */}
      {showNameFields && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
          <p className={labelCls}>New Name Details</p>
          <div>
            <label className={labelCls}>New First Name <span className="text-red-500">*</span></label>
            <input type="text" value={data.first_name} onChange={e => update('first_name', e.target.value)}
              placeholder="Enter new first name" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>New Middle Name</label>
            <input type="text" value={data.middle_name} onChange={e => update('middle_name', e.target.value)}
              placeholder="Enter new middle name (if applicable)" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>New Last Name / Surname <span className="text-red-500">*</span></label>
            <input type="text" value={data.last_name} onChange={e => update('last_name', e.target.value)}
              placeholder="Enter new last name" className={inputCls} />
          </div>
        </div>
      )}

      {/* Phone Field */}
      {showPhoneField && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4">
          <label className={labelCls}>New Phone Number <span className="text-red-500">*</span></label>
          <input type="tel" value={data.phone_number} onChange={e => update('phone_number', e.target.value)}
            placeholder="New phone number (e.g. 08012345678)" className={inputCls} />
        </div>
      )}

      {/* DOB Field */}
      {showDobField && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4">
          <label className={labelCls}>New Date of Birth <span className="text-red-500">*</span></label>
          <input type="date" value={data.new_dob} onChange={e => update('new_dob', e.target.value)} className={inputCls} />
        </div>
      )}

      {/* Address Fields */}
      {showAddressFields && (
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
          <p className={labelCls}>New Address Details</p>
          <div>
            <label className={labelCls}>Address Line 1 <span className="text-red-500">*</span></label>
            <input type="text" value={data.address_line_1} onChange={e => update('address_line_1', e.target.value)}
              placeholder="House number, street name" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Address Line 2</label>
            <input type="text" value={data.address_line_2} onChange={e => update('address_line_2', e.target.value)}
              placeholder="Estate, area, landmark (optional)" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Town / City <span className="text-red-500">*</span></label>
            <input type="text" value={data.town_city} onChange={e => update('town_city', e.target.value)}
              placeholder="e.g. Lagos" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>LGA <span className="text-red-500">*</span></label>
            <input type="text" value={data.lga} onChange={e => update('lga', e.target.value)}
              placeholder="Local Government Area" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>State <span className="text-red-500">*</span></label>
            <select value={data.state} onChange={e => update('state', e.target.value)} className={selectCls}>
              <option value="">Select state</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Postal Code</label>
            <input type="text" value={data.postal_code} onChange={e => update('postal_code', e.target.value)}
              placeholder="e.g. 100001" className={inputCls} />
          </div>
        </div>
      )}

      {/* Supporting Documents */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-5">
        <p className={labelCls}>Supporting Documents</p>

        {showNameFields && (
          <div>
            <label className={labelCls}>Affidavit of Name Change <span className="text-red-500">*</span></label>
            <p className="text-xs text-green-500 dark:text-night-300 mb-2">A sworn affidavit from a court is required for name changes.</p>
            <FileUploadField label="Upload Affidavit" value={data.affidavit_url} onChange={url => update('affidavit_url', url)} accept="image/*,application/pdf" />
          </div>
        )}
        <div>
          <label className={labelCls}>Additional Supporting Document (Optional)</label>
          <p className="text-xs text-green-500 dark:text-night-300 mb-2">Any other relevant document (marriage certificate, court order, utility bill, etc.).</p>
          <FileUploadField label="Upload Supporting Document" value={data.supporting_doc_url} onChange={url => update('supporting_doc_url', url)} accept="image/*,application/pdf" />
        </div>
      </div>
    </div>
  )
}
