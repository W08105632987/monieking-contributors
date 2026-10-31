import { forwardRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Set false for fields that only look like passwords but are PINs. They never get an eye. */
  reveal?: boolean
}

/** A password field with a show/hide eye so people can check what they typed. Use it for passwords, never for PINs. */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput({ reveal = true, className = '', ...rest }, ref) {
  const [show, setShow] = useState(false)
  if (!reveal) return <input ref={ref} type="password" className={className} {...rest} />
  return (
    <div className="relative w-full">
      <input ref={ref} type={show ? 'text' : 'password'} className={`${className} pr-11`} {...rest} />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}   // keep the cursor in the field while toggling
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-green-500 hover:text-green-700 dark:text-night-300 dark:hover:text-white"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
})
