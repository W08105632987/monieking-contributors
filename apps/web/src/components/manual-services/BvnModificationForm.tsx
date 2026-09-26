import { useState, useEffect } from 'react'
import { ENROLLMENT_BANKS, NIGERIAN_STATES } from './constants'

interface Props {
  onChange: (payload: {
    service_type: string
    enrollment_bank?: string
    form_data: Record<string, any>
    uploaded_files: string[]
    price_kobo: number
  }) => void
}

const MOD_OPTIONS = [
  { id: 'update_name', label: 'Update Name', isCombo: false },
  { id: 'update_phone', label: 'Update Phone Number', isCombo: false },
  { id: 'update_dob', label: 'Update Date of Birth', isCombo: false },
  { id: 'update_address', label: 'Update Address', isCombo: false },
  { id: 'update_name_dob', label: 'Update Name & DOB', isCombo: true },
  { id: 'update_name_phone', label: 'Update Name & Phone', isCombo: true },
  { id: 'update_name_address', label: 'Update Name & Address', isCombo: true },
  { id: 'update_dob_phone', label: 'Update DOB & Phone', isCombo: true },
]

export function BvnModificationForm({ onChange }: Props) {
  const [modType, setModType] = useState('update_name')
  const [enrollmentBank, setEnrollmentBank] = useState('agency')
  const [data, setData] = useState<Record<string, any>>({
    bvn: '',
    nin: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    phone_number: '',
    second_phone_number: '',
    dob: '',
    address_line_1: '',
    address_line_2: '',
    town_city: '',
    lga: '',
    postal_code: '',
    state: '',
  })

  const update = (key: string, val: any) => setData(prev => ({ ...prev, [key]: val }))

  const selectedMod = MOD_OPTIONS.find(m => m.id === modType) || MOD_OPTIONS[0]
  const selectedBankObj = ENROLLMENT_BANKS.find(b => b.id === enrollmentBank) || ENROLLMENT_BANKS[0]

  // Pricing: Combinations are fixed ₦9,000 (900,000 kobo). Singles depend on Bank.
  const priceKobo = selectedMod.isCombo ? 900000 : selectedBankObj.priceKobo

  useEffect(() => {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([_, v]) => v !== '' && v !== null && v !== undefined)
    )
    onChange({
      service_type: modType,
      enrollment_bank: enrollmentBank,
      form_data: {
        ...cleanData,
        selected_modification: modType,
        enrollment_bank: selectedBankObj.label,
      },
      uploaded_files: [],
      price_kobo: priceKobo,
    })
  }, [modType, enrollmentBank, data, priceKobo])

  const showNameFields = ['update_name', 'update_name_dob', 'update_name_phone', 'update_name_address'].includes(modType)
  const showPhoneFields = ['update_phone', 'update_name_phone', 'update_dob_phone'].includes(modType)
  const showDobField = ['update_dob', 'update_name_dob', 'update_dob_phone'].includes(modType)
  const showAddressFields = ['update_address', 'update_name_address'].includes(modType)

  return (
    <div className="space-y-6">
      {/* Modification Type Checkboxes */}
      <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200">
          Select Modification Type <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {MOD_OPTIONS.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModType(m.id)}
              className={`p-3 rounded-xl border text-left text-xs font-semibold transition-all ${
                modType === m.id
                  ? 'border-green-600 bg-green-50/80 dark:bg-night-600 text-green-950 dark:text-white font-bold ring-2 ring-green-600/20'
                  : 'border-green-100 dark:border-night-500 hover:border-green-300 text-green-900/80 dark:text-night-200 bg-white/70 dark:bg-night-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                  modType === m.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300'
                }`}>
                  {modType === m.id && '✓'}
                </span>
                <span className="truncate">{m.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Enrollment Bank Dropdown */}
      <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200">
            Enrollment Type (Bank) <span className="text-red-500">*</span>
          </label>
          <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
            {selectedMod.isCombo ? 'Fixed Combo Rate ₦9,000' : `Bank Rate: ₦${(selectedBankObj.priceKobo / 100).toLocaleString()}`}
          </span>
        </div>
        <select
          value={enrollmentBank}
          onChange={e => setEnrollmentBank(e.target.value)}
          className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-800 px-4 py-3 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
        >
          {ENROLLMENT_BANKS.map(b => (
            <option key={b.id} value={b.id}>
              {b.label} {!selectedMod.isCombo && `— ₦${(b.priceKobo / 100).toLocaleString()}`}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-green-600/80 dark:text-night-400">
          {selectedMod.isCombo
            ? 'Combination modifications (2 fields at once) are charged at a flat rate of ₦9,000.00.'
            : 'Single field modification fee is determined by your original enrollment bank.'}
        </p>
      </div>

      {/* Common Verification Fields: BVN & NIN */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-bold text-green-800 dark:text-night-200">
            BVN Number (11 digits) <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            maxLength={11}
            value={data.bvn}
            onChange={e => update('bvn', e.target.value.replace(/\D/g, ''))}
            placeholder="Enter your 11-digit BVN"
            className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-green-800 dark:text-night-200">
            NIN Number (11 digits) <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            maxLength={11}
            value={data.nin}
            onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
            placeholder="Enter your 11-digit NIN"
            className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
          />
        </div>
      </div>

      {/* Name Fields */}
      {showNameFields && (
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
            Name Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">First Name *</label>
              <input
                type="text"
                value={data.first_name}
                onChange={e => update('first_name', e.target.value)}
                placeholder="Enter first name"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Middle Name (optional)</label>
              <input
                type="text"
                value={data.middle_name}
                onChange={e => update('middle_name', e.target.value)}
                placeholder="Enter middle name"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Last Name *</label>
              <input
                type="text"
                value={data.last_name}
                onChange={e => update('last_name', e.target.value)}
                placeholder="Enter last name"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Phone Fields */}
      {showPhoneFields && (
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
            Phone Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Phone Number *</label>
              <input
                type="tel"
                maxLength={11}
                value={data.phone_number}
                onChange={e => update('phone_number', e.target.value.replace(/\D/g, ''))}
                placeholder="Enter phone number"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Second Phone Number (optional)</label>
              <input
                type="tel"
                maxLength={11}
                value={data.second_phone_number}
                onChange={e => update('second_phone_number', e.target.value.replace(/\D/g, ''))}
                placeholder="Enter alternative phone"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* DOB Field */}
      {showDobField && (
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200">
            Date of Birth *
          </label>
          <input
            type="date"
            value={data.dob}
            onChange={e => update('dob', e.target.value)}
            className="w-full rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
          />
        </div>
      )}

      {/* Address Fields */}
      {showAddressFields && (
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
            Address Details
          </h3>
          <div>
            <label className="text-xs font-semibold text-green-800 dark:text-night-200">Address Line 1 *</label>
            <input
              type="text"
              value={data.address_line_1}
              onChange={e => update('address_line_1', e.target.value)}
              placeholder="Enter address line 1"
              className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-green-800 dark:text-night-200">Address Line 2</label>
            <input
              type="text"
              value={data.address_line_2}
              onChange={e => update('address_line_2', e.target.value)}
              placeholder="Enter address line 2"
              className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Town / City *</label>
              <input
                type="text"
                value={data.town_city}
                onChange={e => update('town_city', e.target.value)}
                placeholder="Enter town/city"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">LGA *</label>
              <input
                type="text"
                value={data.lga}
                onChange={e => update('lga', e.target.value)}
                placeholder="Enter LGA"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Postal Code</label>
              <input
                type="text"
                value={data.postal_code}
                onChange={e => update('postal_code', e.target.value)}
                placeholder="Enter postal code"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-green-800 dark:text-night-200">State *</label>
            <select
              value={data.state}
              onChange={e => update('state', e.target.value)}
              className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
            >
              <option value="">Select State</option>
              {NIGERIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
