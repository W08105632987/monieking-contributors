import { describe, expect, it } from 'vitest'
import { entryLabel } from './lists'
import { isStepUpError, setStepUpHandler, askStepUp } from './stepup-bus'

describe('entryLabel', () => {
  it('gives plain names, never a code word', () => {
    expect(entryLabel('loan_repayment')).toBe('Loan repayment')
    expect(entryLabel('withdrawal_returned')).toBe('Withdrawal returned')
    expect(entryLabel('something_new')).toBe('Something new')
  })
})

describe('step-up bus', () => {
  it('spots the step-up error only', () => {
    expect(isStepUpError({ response: { status: 403, data: { code: 'step_up_required' } } })).toBe(true)
    expect(isStepUpError({ response: { status: 403, data: { code: 'other' } } })).toBe(false)
    expect(isStepUpError(new Error('x'))).toBe(false)
  })
  it('returns null with no handler and the answer with one', async () => {
    setStepUpHandler(null)
    expect(await askStepUp()).toBeNull()
    setStepUpHandler(async () => ({ auth_method: 'password', withdrawal_password: 'pw' }))
    expect((await askStepUp())?.withdrawal_password).toBe('pw')
    setStepUpHandler(null)
  })
})
