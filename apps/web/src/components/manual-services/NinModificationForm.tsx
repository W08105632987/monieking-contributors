import { useState, useEffect } from 'react'
import { NIGERIAN_STATES, MARITAL_STATUSES, EDUCATION_LEVELS } from './constants'
import { FileUploadField } from './FileUploadField'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
  }) => void
}

const MODIFICATION_TYPES = [
  { id: 'update_name', label: 'Update Name' },
  { id: 'update_phone', label: 'Update Phone Number' },
  { id: 'update_dob', label: 'Update Date of Birth' },
  { id: 'update_address', label: 'Update Address' },
  { id: 'update_name_dob', label: 'Update Name & DOB' },
  { id: 'update_name_phone', label: 'Update Name & Phone' },
]

export function NinModificationForm({ onChange }: Props) {
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
    postal_code: '',
    state: '',
    marital_status: '',
    state_of_origin: '',
    lga_of_origin: '',
    village_of_origin: '',
    place_of_birth: '',
    housing_type: '',
    resident_state: '',
    resident_lga: '',
    resident_village: '',
    resident_address: '',
    education_level: '',
    state_of_birth: '',
    lga_of_birth: '',
    village_of_birth: '',
    father_surname: '',
    father_firstname: '',
    father_state_of_origin: '',
    father_lga_of_origin: '',
    father_village_of_origin: '',
    mother_surname: '',
    mother_firstname: '',
    mother_maiden_name: '',
    mother_state_of_origin: '',
    mother_lga_of_origin: '',
    mother_village_of_origin: '',
    supporting_document: '',
  })

  const update = (key: string, val: any) => {
    setData(prev => ({ ...prev, [key]: val }))
  }

  const showNameFields = ['update_name', 'update_name_dob', 'update_name_phone'].includes(modType)
  const showPhoneField = ['update_phone', 'update_name_phone'].includes(modType)
  const showAddressFields = modType === 'update_address'
  const showDobAndFamilyFields = ['update_dob', 'update_name_dob'].includes(modType)

  // Only send fields that are actually on screen for the chosen modification. Anything typed
  // earlier for a different option (and now hidden) must not be submitted.
  const NAME_KEYS = ['first_name', 'middle_name', 'last_name']
  const PHONE_KEYS = ['phone_number']
  const ADDRESS_KEYS = ['address_line_1', 'address_line_2', 'town_city', 'postal_code', 'state']
  const ALWAYS_KEYS = ['nin', 'supporting_document']
  const isVisibleKey = (k: string) =>
    ALWAYS_KEYS.includes(k) ||
    (NAME_KEYS.includes(k) && showNameFields) ||
    (PHONE_KEYS.includes(k) && showPhoneField) ||
    (ADDRESS_KEYS.includes(k) && showAddressFields) ||
    (![...NAME_KEYS, ...PHONE_KEYS, ...ADDRESS_KEYS].includes(k) && showDobAndFamilyFields)

  useEffect(() => {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => isVisibleKey(k) && v !== '' && v !== null && v !== undefined)
    )
    onChange({
      service_type: modType,
      form_data: { ...cleanData, selected_modification: modType },
      uploaded_files: data.supporting_document ? [data.supporting_document] : [],
    })
  }, [modType, data])

  return (
    <div className="space-y-6">
      {/* Modification Type Selector */}
      <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200">
          Select Modification Type <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {MODIFICATION_TYPES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setModType(t.id)}
              className={`p-3 rounded-xl border text-left text-xs font-semibold transition-all ${
                modType === t.id
                  ? 'border-green-600 bg-green-50/80 dark:bg-night-600 text-green-950 dark:text-white font-bold ring-2 ring-green-600/20'
                  : 'border-green-100 dark:border-night-500 hover:border-green-300 text-green-900/80 dark:text-night-200 bg-white/70 dark:bg-night-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                  modType === t.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300'
                }`}>
                  {modType === t.id && '✓'}
                </span>
                <span className="truncate">{t.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* NIN Input - Common */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-green-800 dark:text-night-200">
          NIN Number (11 digits) <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          maxLength={11}
          value={data.nin}
          onChange={e => update('nin', e.target.value.replace(/\D/g, ''))}
          placeholder="Enter 11-digit NIN"
          className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
        />
      </div>

      {/* Name Fields */}
      {showNameFields && (
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
            {modType === 'update_name' ? 'Personal Details (New Name)' : 'New Name Details'}
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
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Middle Name *</label>
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

      {/* Phone Number Field */}
      {showPhoneField && (
        <div className="space-y-1">
          <label className="text-xs font-bold text-green-800 dark:text-night-200">
            New Phone Number <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            maxLength={11}
            value={data.phone_number}
            onChange={e => update('phone_number', e.target.value.replace(/\D/g, ''))}
            placeholder="Enter new phone number (e.g. 08012345678)"
            className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
          />
        </div>
      )}

      {/* Address Details */}
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
            <label className="text-xs font-semibold text-green-800 dark:text-night-200">Address Line 2 *</label>
            <input
              type="text"
              value={data.address_line_2}
              onChange={e => update('address_line_2', e.target.value)}
              placeholder="Enter address line 2"
              className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Postal Code *</label>
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
              {NIGERIAN_STATES.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Date of Birth & Comprehensive Family Information */}
      {showDobAndFamilyFields && (
        <div className="space-y-5">
          {/* DOB & Personal */}
          <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
              Date of Birth & Personal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">New Date of Birth *</label>
                <input
                  type="date"
                  value={data.new_dob}
                  onChange={e => update('new_dob', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Marital Status *</label>
                <select
                  value={data.marital_status}
                  onChange={e => update('marital_status', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select Marital Status</option>
                  {MARITAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">State of Origin *</label>
                <select
                  value={data.state_of_origin}
                  onChange={e => update('state_of_origin', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select State</option>
                  {NIGERIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">L.G.A of Origin *</label>
                <input
                  type="text"
                  value={data.lga_of_origin}
                  onChange={e => update('lga_of_origin', e.target.value)}
                  placeholder="Enter LGA of Origin"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Village/Town of Origin *</label>
                <input
                  type="text"
                  value={data.village_of_origin}
                  onChange={e => update('village_of_origin', e.target.value)}
                  placeholder="Enter Village/Town of Origin"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Place of Birth *</label>
                <input
                  type="text"
                  value={data.place_of_birth}
                  onChange={e => update('place_of_birth', e.target.value)}
                  placeholder="Enter Place of Birth"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>
          </div>

          {/* Residential Details */}
          <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
              Residential Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Hospital or House *</label>
                <select
                  value={data.housing_type}
                  onChange={e => update('housing_type', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select Type</option>
                  <option value="Hospital">Hospital</option>
                  <option value="House">House</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Resident State *</label>
                <select
                  value={data.resident_state}
                  onChange={e => update('resident_state', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select State</option>
                  {NIGERIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Resident L.G.A *</label>
                <input
                  type="text"
                  value={data.resident_lga}
                  onChange={e => update('resident_lga', e.target.value)}
                  placeholder="Enter Resident LGA"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Resident Village/Town *</label>
                <input
                  type="text"
                  value={data.resident_village}
                  onChange={e => update('resident_village', e.target.value)}
                  placeholder="Enter Resident Village/Town"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-green-800 dark:text-night-200">Resident Full Address *</label>
              <input
                type="text"
                value={data.resident_address}
                onChange={e => update('resident_address', e.target.value)}
                placeholder="Enter Full Resident Address"
                className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
              />
            </div>
          </div>

          {/* Education & Contact */}
          <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
              Education & Birth Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Level of Education *</label>
                <select
                  value={data.education_level}
                  onChange={e => update('education_level', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select Education Level</option>
                  {EDUCATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">State of Birth *</label>
                <select
                  value={data.state_of_birth}
                  onChange={e => update('state_of_birth', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select State of Birth</option>
                  {NIGERIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">L.G.A of Birth *</label>
                <input
                  type="text"
                  value={data.lga_of_birth}
                  onChange={e => update('lga_of_birth', e.target.value)}
                  placeholder="Enter LGA of Birth"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Village/Town of Birth *</label>
                <input
                  type="text"
                  value={data.village_of_birth}
                  onChange={e => update('village_of_birth', e.target.value)}
                  placeholder="Enter Village/Town of Birth"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>
          </div>

          {/* Father's Details */}
          <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
              Father's Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Father's Surname *</label>
                <input
                  type="text"
                  value={data.father_surname}
                  onChange={e => update('father_surname', e.target.value)}
                  placeholder="Enter Father's Surname"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Father's Firstname *</label>
                <input
                  type="text"
                  value={data.father_firstname}
                  onChange={e => update('father_firstname', e.target.value)}
                  placeholder="Enter Father's Firstname"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Father's State of Origin *</label>
                <select
                  value={data.father_state_of_origin}
                  onChange={e => update('father_state_of_origin', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select State</option>
                  {NIGERIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Father's LGA of Origin *</label>
                <input
                  type="text"
                  value={data.father_lga_of_origin}
                  onChange={e => update('father_lga_of_origin', e.target.value)}
                  placeholder="Enter Father's LGA"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Father's Village/Town *</label>
                <input
                  type="text"
                  value={data.father_village_of_origin}
                  onChange={e => update('father_village_of_origin', e.target.value)}
                  placeholder="Enter Village/Town"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>
          </div>

          {/* Mother's Details */}
          <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200 border-b pb-2 dark:border-night-600">
              Mother's Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Mother's Surname *</label>
                <input
                  type="text"
                  value={data.mother_surname}
                  onChange={e => update('mother_surname', e.target.value)}
                  placeholder="Enter Mother's Surname"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Mother's Firstname *</label>
                <input
                  type="text"
                  value={data.mother_firstname}
                  onChange={e => update('mother_firstname', e.target.value)}
                  placeholder="Enter Mother's Firstname"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Mother's Maiden Name *</label>
                <input
                  type="text"
                  value={data.mother_maiden_name}
                  onChange={e => update('mother_maiden_name', e.target.value)}
                  placeholder="Enter Mother's Maiden Name"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Mother's State of Origin *</label>
                <select
                  value={data.mother_state_of_origin}
                  onChange={e => update('mother_state_of_origin', e.target.value)}
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                >
                  <option value="">Select State</option>
                  {NIGERIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Mother's LGA of Origin *</label>
                <input
                  type="text"
                  value={data.mother_lga_of_origin}
                  onChange={e => update('mother_lga_of_origin', e.target.value)}
                  placeholder="Enter Mother's LGA"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-green-800 dark:text-night-200">Mother's Village/Town *</label>
                <input
                  type="text"
                  value={data.mother_village_of_origin}
                  onChange={e => update('mother_village_of_origin', e.target.value)}
                  placeholder="Enter Village/Town"
                  className="w-full mt-1 rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 px-3.5 py-2.5 text-sm text-green-950 dark:text-white outline-none focus:border-green-500"
                />
              </div>
            </div>
          </div>

          {/* Optional Attestation Document Upload */}
          <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm">
            <FileUploadField
              label="Upload Supporting Document (Attestation)"
              helperText="Optional sworn affidavit or age declaration document"
              value={data.supporting_document}
              onChange={url => update('supporting_document', url)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
