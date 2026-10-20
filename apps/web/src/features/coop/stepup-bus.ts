/**
 * A tiny registry so any money request can ask for the withdrawal password, even from places that forgot to.
 * StepUpHost (mounted by every cooperative page) registers the handler; api.ts calls it when the server says
 * "step_up_required", then repeats the request with the password attached.
 */
export type StepUpPayload = { auth_method: 'password' | 'biometric'; withdrawal_password?: string; webauthn_assertion?: object }
export type StepUpHandler = () => Promise<StepUpPayload | null | undefined>

let handler: StepUpHandler | null = null
export const setStepUpHandler = (h: StepUpHandler | null) => { handler = h }
export const askStepUp = async (): Promise<StepUpPayload | null> => (handler ? ((await handler()) ?? null) : null)

export const isStepUpError = (e: any): boolean => e?.response?.status === 403 && e?.response?.data?.code === 'step_up_required'
