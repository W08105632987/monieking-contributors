import { useState, useEffect } from 'react'

interface Props {
  onChange: (payload: {
    service_type: string
    form_data: Record<string, any>
    uploaded_files: string[]
    price_kobo: number
    bulk_count?: number
  }) => void
}

const VALIDATION_TYPES = [
  { id: 'no_record', label: 'No Record Found', priceKobo: 100000, priceDisplay: '₦1,000.00' },
  { id: 'sim_validation', label: 'SIM Validation', priceKobo: 100000, priceDisplay: '₦1,000.00' },
  { id: 'vnin_validation', label: 'v.nin validation', priceKobo: 120000, priceDisplay: '₦1,200.00' },
  { id: 'update_records', label: 'Update Records Validation', priceKobo: 100000, priceDisplay: '₦1,000.00' },
  { id: 'bank_validation', label: 'Bank Validation', priceKobo: 100000, priceDisplay: '₦1,000.00' },
  { id: 'modification_validation', label: 'Modification Validation', priceKobo: 120000, priceDisplay: '₦1,200.00' },
  { id: 'photographic_error', label: 'Photographic Error', priceKobo: 120000, priceDisplay: '₦1,200.00' },
]

export function NinValidationForm({ onChange }: Props) {
  const [submitMode, setSubmitMode] = useState<'single' | 'bulk'>('single')
  const [selectedType, setSelectedType] = useState('no_record')
  const [singleNin, setSingleNin] = useState('')
  const [bulkNinsText, setBulkNinsText] = useState('')

  // Parse valid 11-digit NINs from textarea
  const validNins = bulkNinsText
    .split('\n')
    .map(line => line.trim().replace(/\D/g, ''))
    .filter(line => line.length === 11)
    .slice(0, 50)

  const activeTypeObj = VALIDATION_TYPES.find(v => v.id === selectedType) || VALIDATION_TYPES[0]
  const unitPriceKobo = activeTypeObj.priceKobo

  const totalPriceKobo = submitMode === 'single'
    ? unitPriceKobo
    : unitPriceKobo * Math.max(1, validNins.length)

  useEffect(() => {
    onChange({
      service_type: selectedType,
      form_data: {
        submit_mode: submitMode,
        validation_type: selectedType,
        validation_label: activeTypeObj.label,
        nin: submitMode === 'single' ? singleNin : validNins[0] || '',
        bulk_nins: submitMode === 'bulk' ? validNins : [],
        count: submitMode === 'bulk' ? validNins.length : 1,
      },
      uploaded_files: [],
      price_kobo: totalPriceKobo,
      bulk_count: submitMode === 'bulk' ? Math.max(1, validNins.length) : 1,
    })
  }, [submitMode, selectedType, singleNin, bulkNinsText, validNins.length])

  return (
    <div className="space-y-6">
      {/* Mode Selector */}
      <div className="grid grid-cols-2 gap-2 bg-green-100/50 dark:bg-night-800 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubmitMode('single')}
          className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
            submitMode === 'single'
              ? 'bg-white dark:bg-night-600 text-green-950 dark:text-white shadow-sm'
              : 'text-green-700 dark:text-night-300 hover:text-green-900'
          }`}
        >
          Single Submit
        </button>
        <button
          type="button"
          onClick={() => setSubmitMode('bulk')}
          className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
            submitMode === 'bulk'
              ? 'bg-white dark:bg-night-600 text-green-950 dark:text-white shadow-sm'
              : 'text-green-700 dark:text-night-300 hover:text-green-900'
          }`}
        >
          Bulk Submit
        </button>
      </div>

      {/* Validation Type Selection */}
      <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-green-800 dark:text-night-200">
          Select Validation Type <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {VALIDATION_TYPES.map(vt => (
            <label
              key={vt.id}
              onClick={() => setSelectedType(vt.id)}
              className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                selectedType === vt.id
                  ? 'border-green-600 bg-green-50/70 dark:bg-night-600 ring-1 ring-green-600'
                  : 'border-green-100 dark:border-night-500 hover:border-green-300 bg-white/60 dark:bg-night-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                  selectedType === vt.id ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300'
                }`}>
                  {selectedType === vt.id && '✓'}
                </span>
                <span className="text-xs font-semibold text-green-950 dark:text-white">{vt.label}</span>
              </div>
              <span className="text-xs font-mono font-bold text-green-700 dark:text-night-200">
                {vt.priceDisplay}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Input depending on mode */}
      {submitMode === 'single' ? (
        <div className="space-y-1">
          <label className="text-xs font-bold text-green-800 dark:text-night-200">
            NIN Number (11 digits) <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            maxLength={11}
            value={singleNin}
            onChange={e => setSingleNin(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter 11-digit NIN"
            className="w-full rounded-xl border-2 border-green-100 dark:border-night-600 bg-white dark:bg-night-700 px-4 py-3 text-sm font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
          />
        </div>
      ) : (
        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 border border-green-100 dark:border-night-600 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-green-800 dark:text-night-200">
              Enter NINs (one per line, 11 digits each) <span className="text-red-500">*</span>
            </label>
            <span className="text-xs font-mono font-bold text-green-700 dark:text-night-300">
              NINs entered: {validNins.length} / 50 max
            </span>
          </div>
          <textarea
            rows={6}
            value={bulkNinsText}
            onChange={e => setBulkNinsText(e.target.value)}
            placeholder={"Enter one NIN per line, e.g.:\n12345678901\n98765432101\n11223344556"}
            className="w-full rounded-xl border border-green-200 dark:border-night-500 bg-green-50/20 dark:bg-night-800 p-3 text-xs font-mono text-green-950 dark:text-white outline-none focus:border-green-500"
          />
          <div className="flex justify-between items-center pt-1 border-t dark:border-night-600 text-xs">
            <span className="text-gray-500 dark:text-night-300">Rate per NIN: {activeTypeObj.priceDisplay}</span>
            <span className="font-bold text-green-900 dark:text-white">
              Calculated Total: ₦{((unitPriceKobo * validNins.length) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
