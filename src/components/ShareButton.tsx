/**
 * ShareButton — copy invitation link or use Web Share API.
 * Used on ObligationPage and the post-create screen.
 */

import { useState } from 'react'
import { Copy, Share2, Check } from 'lucide-react'
import { buildObligationUrl, shareObligation } from '../hooks/useObligationDiscovery'

interface Props {
  obligationId: bigint
  title: string
  variant?: 'primary' | 'secondary'
  fullWidth?: boolean
}

export default function ShareButton({ obligationId, title, variant = 'secondary', fullWidth = false }: Props) {
  const [copied, setCopied] = useState(false)
  const hasShare = typeof navigator !== 'undefined' && !!navigator.share

  const handleShare = async () => {
    const usedShare = await shareObligation(obligationId, title)
    if (!usedShare) {
      // clipboard fallback
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopy = async () => {
    const url = buildObligationUrl(obligationId)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        const el = document.createElement('textarea')
        el.value = url
        el.style.position = 'fixed'; el.style.opacity = '0'
        document.body.appendChild(el); el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* silent */ }
  }

  const isPrimary = variant === 'primary'

  return (
    <div className={`flex gap-2 ${fullWidth ? 'w-full' : ''}`}>
      {/* Copy link button */}
      <button
        onClick={() => { void handleCopy() }}
        className={`flex items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] ${fullWidth ? 'flex-1' : 'px-4'} py-3`}
        style={
          isPrimary
            ? { background: 'var(--accent)', color: '#fff' }
            : { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }
        }
      >
        {copied ? (
          <><Check className="size-4 shrink-0" style={{ color: isPrimary ? '#fff' : 'var(--success)' }} /> Copied!</>
        ) : (
          <><Copy className="size-4 shrink-0" /> Copy invitation link</>
        )}
      </button>

      {/* Web Share button — only show when API is available */}
      {hasShare && (
        <button
          onClick={() => { void handleShare() }}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          title="Share obligation"
        >
          <Share2 className="size-4" />
        </button>
      )}
    </div>
  )
}
