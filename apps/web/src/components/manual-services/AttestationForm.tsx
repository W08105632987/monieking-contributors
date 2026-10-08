import { useState, useEffect } from 'react'
import { useManualPricing, priceLabel } from '@/lib/manualServices'
import { FileUploadField } from './FileUploadField'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
  }) => void
}

export function AttestationForm({ onChange }: Props) {
  const { priceOf } = useManualPricing()
  const price = priceLabel(priceOf('nin_attestation', 'default'))
  const [data, setData] = useState<Record<string, any>>({
    nin: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    phone_number: '',
    dob: '',
    gender: '',
    address: '',
    purpose_of_attestation: '',
    destination_country: '',
    passport_number: '',
    nin_slip_url: '',
    photo_url: '',
    additional_doc_url: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const PURPOSE_OPTIONS = [
    'Travel Abroad',
    'Employment Abroad',
    'School Admission Abroad',
    'Visa Application',
    'Embassy Document',
    'Bank Account Opening Abroad',
    'Legal / Court Purposes',
    'Other',
  ]

  useEffect(() => {
    const uploadedFiles = [data.nin_slip_url, data.photo_url, data.additional_doc_url].filter(Boolean)
    onChange({
      service_type: 'nin_attestation',
      form_data: data,
      uploaded_files: uploadedFiles,
    })
  }, [data])

  const inputCls = 'w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-medium text-green-950 dark:text-white outline-none focus:border-green-500 transition-colors'
  const selectCls = `${inputCls} appearance-none`
  const labelCls = 'block text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 mb-1.5'

  return (
    <div className="space-y-5">
      {/* Info Banner */}
      <div className="bg-amber-50 dark:bg-night-700 border border-amber-200 dark:border-night-500 rounded-2xl p-4">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          NIN Attestation is a fixed-price service{price ? ` (${price})` : ''}. Your NIN details will be officially attested and stamped for use abroad or for official purposes.
        </p>
      </div>

      {/* Personal Information */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Personal Information</p>
        <div>
          <label className={labelCls}>NIN (National Identity Number) <span className="text-red-500">*</span></label>
          <input type="text" maxLength={11} value={data.nin} onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
            placeholder="11-digit NIN" className={`${inputCls} font-mono`} />
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
          <label className={labelCls}>Gender <span className="text-red-500">*</span></label>
          <select value={data.gender} onChange={e => update('gender', e.target.value)} className={selectCls}>
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Phone Number <span className="text-red-500">*</span></label>
          <input type="tel" value={data.phone_number} onChange={e => update('phone_number', e.target.value)}
            placeholder="e.g. 08012345678" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Residential Address <span className="text-red-500">*</span></label>
          <input type="text" value={data.address} onChange={e => update('address', e.target.value)}
            placeholder="Full residential address" className={inputCls} />
        </div>
      </div>

      {/* Attestation Details */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-4">
        <p className={labelCls}>Attestation Purpose</p>
        <div>
          <label className={labelCls}>Purpose of Attestation <span className="text-red-500">*</span></label>
          <select value={data.purpose_of_attestation} onChange={e => update('purpose_of_attestation', e.target.value)} className={selectCls}>
            <option value="">Select purpose</option>
            {PURPOSE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Destination Country</label>
          <input type="text" value={data.destination_country} onChange={e => update('destination_country', e.target.value)}
            placeholder="e.g. United Kingdom" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>International Passport Number</label>
          <input type="text" value={data.passport_number} onChange={e => update('passport_number', e.target.value)}
            placeholder="e.g. A12345678" className={inputCls} />
        </div>
      </div>

      {/* Document Uploads */}
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-600 p-4 space-y-5">
        <p className={labelCls}>Required Documents</p>
        <div>
          <label className={labelCls}>NIN Slip / NIMC Card <span className="text-red-500">*</span></label>
          <p className="text-xs text-green-500 dark:text-night-300 mb-2">Upload a clear image of your NIN slip or NIMC card.</p>
          <FileUploadField label="Upload NIN Slip" value={data.nin_slip_url} onChange={url => update('nin_slip_url', url)} accept="image/*,application/pdf" />
        </div>
        <div>
          <label className={labelCls}>Recent Passport Photograph <span className="text-red-500">*</span></label>
          <p className="text-xs text-green-500 dark:text-night-300 mb-2">Upload a recent clear passport photograph (white background preferred).</p>
          <FileUploadField label="Upload Photograph" value={data.photo_url} onChange={url => update('photo_url', url)} accept="image/*" />
        </div>
        <div>
          <label className={labelCls}>Additional Supporting Document (Optional)</label>
          <p className="text-xs text-green-500 dark:text-night-300 mb-2">Affidavit, court order, embassy letter, or other supporting document.</p>
          <FileUploadField label="Upload Additional Document" value={data.additional_doc_url} onChange={url => update('additional_doc_url', url)} accept="image/*,application/pdf" />
        </div>
      </div>
    </div>
  )
}
