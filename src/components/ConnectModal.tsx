/**
 * ConnectModal — Unified wallet connection modal for POOLLESS
 *
 * Primary option: Circle Wallet (user-controlled, no browser extension needed)
 * Secondary options: Browser Wallet, Rabby Wallet (via ConnectKit / wagmi injected)
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useModal } from 'connectkit'
import { X, Loader2, AlertCircle, CircleCheck } from 'lucide-react'
import { useCircleWallet } from '../circleWallet'

interface ConnectModalProps {
  open: boolean
  onClose: () => void
}

// Minimum userId length for Circle
const MIN_USER_ID_LENGTH = 5

export default function ConnectModal({ open, onClose }: ConnectModalProps) {
  const { setOpen: openConnectKit } = useModal()
  const { state, connect, error, isConfigured } = useCircleWallet()

  const [step, setStep] = useState<'choose' | 'circle-id'>('choose')
  const [userId, setUserId] = useState('')
  const [localError, setLocalError] = useState('')

  const busy = state === 'connecting' || state === 'awaiting-challenge' || state === 'loading-wallet'

  const handleChooseCircle = useCallback(() => {
    if (!isConfigured) {
      setLocalError('Circle Wallet is not configured yet. See setup instructions below.')
      return
    }
    setLocalError('')
    setStep('circle-id')
  }, [isConfigured])

  const handleConnect = useCallback(async () => {
    const id = userId.trim()
    if (id.length < MIN_USER_ID_LENGTH) {
      setLocalError(`ID must be at least ${MIN_USER_ID_LENGTH} characters`)
      return
    }
    setLocalError('')
    await connect(id)
    if (state !== 'error') {
      onClose()
    }
  }, [userId, connect, state, onClose])

  const handleBrowserWallet = useCallback(() => {
    onClose()
    openConnectKit(true)
  }, [onClose, openConnectKit])

  const handleBack = useCallback(() => {
    setStep('choose')
    setLocalError('')
  }, [])

  const displayError = localError || (state === 'error' ? error : '')

  const stateLabel =
    state === 'connecting' ? 'Creating account...'
    : state === 'awaiting-challenge' ? 'Waiting for PIN setup...'
    : state === 'loading-wallet' ? 'Loading wallet...'
    : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

          {/* Sheet */}
          <motion.div
            className="relative w-full max-w-sm mx-4 rounded-3xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
              boxShadow: '0 32px 64px rgba(18,45,69,0.18)',
            }}
            initial={{ y: 60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 340, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="px-6 pt-2 pb-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                {step === 'circle-id' ? (
                  <button
                    onClick={handleBack}
                    className="text-sm font-medium"
                    style={{ color: 'var(--muted)' }}
                  >
                    ← Back
                  </button>
                ) : (
                  <div />
                )}
                <p
                  className="display text-base font-bold"
                  style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
                >
                  Connect Wallet
                </p>
                <button
                  onClick={onClose}
                  className="flex items-center justify-center size-7 rounded-lg hover:bg-black/5 transition-colors"
                >
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              {/* Error */}
              {displayError && (
                <div
                  className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-4 text-xs"
                  style={{ background: 'rgba(186,43,76,0.07)', color: 'var(--danger)' }}
                >
                  <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                  <span>{displayError}</span>
                </div>
              )}

              {/* ── STEP: choose ── */}
              {step === 'choose' && (
                <div className="space-y-3">
                  {/* Circle Wallet temporarily frozen pending production access */}
                  <div
                    className="w-full rounded-2xl px-4 py-3.5"
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                      opacity: 0.65,
                    }}
                    aria-label="Circle Wallet coming soon"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                          Circle Wallet
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                          Embedded wallet support coming soon
                        </p>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                        Soon
                      </span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>
                      or
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  </div>

                  {/* Browser wallet */}
                  <button
                    onClick={handleBrowserWallet}
                    className="w-full rounded-2xl px-4 py-3 text-sm font-medium text-left transition-all hover:bg-black/4"
                    style={{
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                      background: 'var(--surface-muted)',
                    }}
                  >
                    Browser Wallet
                    <span className="block text-xs font-normal mt-0.5" style={{ color: 'var(--subtle)' }}>
                      MetaMask, Coinbase, and more
                    </span>
                  </button>

                  {/* Footnote */}
                  <p className="text-xs text-center pt-1" style={{ color: 'var(--subtle)' }}>
                    New to wallets?{' '}
                    <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>
                      Connect a compatible wallet to use POOLLESS on Arc Mainnet.
                    </span>
                  </p>
                </div>
              )}

              {/* ── STEP: circle-id ── */}
              {step === 'circle-id' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
                      Your email or user ID
                    </p>
                    <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
                      This is your identifier for your Circle Wallet. Use your email or any unique ID
                      (minimum 5 characters). It is never shared or stored by POOLLESS.
                    </p>
                    <input
                      type="text"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleConnect() }}
                      placeholder="e.g. alice@example.com"
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                      style={{
                        border: '1px solid var(--border-strong)',
                        color: 'var(--ink)',
                        background: 'var(--surface-muted)',
                      }}
                      disabled={busy}
                      autoFocus
                    />
                  </div>

                  {/* State label */}
                  {stateLabel && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                      <Loader2 className="size-3.5 animate-spin" />
                      {stateLabel}
                    </div>
                  )}

                  {/* CTA */}
                  <button
                    onClick={() => void handleConnect()}
                    disabled={busy || userId.trim().length < MIN_USER_ID_LENGTH}
                    className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ background: 'var(--accent)' }}
                  >
                    {busy
                      ? <><Loader2 className="size-4 animate-spin" />{stateLabel ?? 'Connecting...'}</>
                      : 'Continue'}
                  </button>

                  {/* What happens note */}
                  <div
                    className="rounded-xl px-3 py-2.5 text-xs"
                    style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                  >
                    <p className="flex items-start gap-1.5">
                      <CircleCheck className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                      Circle will open a secure screen where you set a PIN to protect your wallet.
                      Your private keys are never visible to POOLLESS or Circle.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
