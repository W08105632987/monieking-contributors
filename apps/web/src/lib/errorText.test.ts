import { describe, it, expect } from 'vitest'
import { friendlyError, looksTechnical, safeText, GENERIC_ERROR, UNAVAILABLE_ERROR, NETWORK_ERROR, INVALID_INPUT_ERROR } from './errorText'
import { getErrorMessage } from './api'

const http = (status: number, data: unknown) => ({ isAxiosError: true, message: 'Request failed with status code ' + status, response: { status, data } })

describe('looksTechnical', () => {
  it.each([
    'Payment provider login failed (HTTP 503). Please try again.',
    'Internal server error',
    'Request failed with status code 500',
    'TypeError: Cannot read properties of undefined',
    'duplicate key value violates unique constraint',
    'Failed to fetch https://api.example.com/x',
    'Traceback (most recent call last):',
    '',
  ])('flags %j', (m) => expect(looksTechnical(m)).toBe(true))

  it('flags non-strings', () => {
    expect(looksTechnical(undefined)).toBe(true)
    expect(looksTechnical({})).toBe(true)
  })

  it.each([
    'Insufficient wallet balance.',
    'That is not a valid Nigerian mobile number.',
    'Incorrect PIN.',
  ])('allows %j', (m) => expect(looksTechnical(m)).toBe(false))
})

describe('safeText', () => {
  it('passes safe text and replaces technical text', () => {
    expect(safeText('Incorrect PIN.')).toBe('Incorrect PIN.')
    expect(safeText('HTTP 503', 'Nope')).toBe('Nope')
    expect(safeText(null)).toBe(GENERIC_ERROR)
  })
})

describe('friendlyError', () => {
  it('keeps deliberate 4xx messages', () => {
    expect(friendlyError(http(400, { detail: 'Insufficient wallet balance.' }))).toBe('Insufficient wallet balance.')
  })
  it('hides provider text on 502/503', () => {
    expect(friendlyError(http(502, { detail: 'Payment provider login failed (HTTP 503). Please try again.' }))).toBe(UNAVAILABLE_ERROR)
  })
  it('handles validation arrays and kyc_required', () => {
    expect(friendlyError(http(422, { detail: [{ msg: 'field required', loc: ['body', 'x'] }] }))).toBe(INVALID_INPUT_ERROR)
    expect(friendlyError(http(403, { detail: { code: 'kyc_required', message: 'x' } }))).toBe('')
  })
  it('handles {message} objects', () => {
    expect(friendlyError(http(423, { detail: { code: 'locked', message: 'Too many attempts. Try later.' } }))).toBe('Too many attempts. Try later.')
  })
  it('handles network failures and plain Errors', () => {
    expect(friendlyError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' })).toBe(NETWORK_ERROR)
    expect(friendlyError(new Error('Unexpected token < in JSON at position 0'), 'Oops')).toBe('Oops')
    expect(friendlyError(new Error('Something specific happened'))).toBe('Something specific happened')
    expect(friendlyError(undefined)).toBe(GENERIC_ERROR)
  })
  it('getErrorMessage delegates', () => {
    expect(getErrorMessage(http(503, { detail: 'provider down (HTTP 503)' }))).toBe(UNAVAILABLE_ERROR)
    expect(getErrorMessage(http(500, {}), 'Custom')).toBe(UNAVAILABLE_ERROR)
  })
})
