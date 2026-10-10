import { useState, useEffect } from 'react'
import { ArrowRight, Users, Wallet, CheckCircle, LogOut, RefreshCw } from 'lucide-react'
import { NetworkArc } from '@web3icons/react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { useCircleWallet } from '../circleWallet'
import { formatAddress } from '../utils'
import ConnectModal from './ConnectModal'
import ObligationDashboard from './ObligationDashboard'
import { useObligationDiscovery } from '../hooks/useObligationDiscovery'

interface LandingPageProps {
  onCreateClick: () => void
  onObligationOpen: (id: bigint) => void
}

export default function LandingPage({ onCreateClick, onObligationOpen }: LandingPageProps) {
  const [modalOpen, setModalOpen] = useState(false)

  // Circle Wallet
  const { state: circleState, session, disconnect: circleDisconnect } = useCircleWallet()
  const isCircleConnected = circleState === 'connected' && !!session?.wallet
  const circleAddress = isCircleConnected ? (session.wallet!.address as `0x${string}`) : undefined

  // Browser wallet (wagmi)
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()

  // Effective connected address — Circle preferred
  const effectiveAddress = circleAddress ?? (wagmiConnected ? wagmiAddress : undefined)
  const isConnected = !!effectiveAddress

  // Obligation discovery from Arc Mainnet
  const { obligations, loading, error, totalCount, refetch } = useObligationDiscovery(effectiveAddress)

  // Auto-open obligation if the hash contains an ID at mount time
  // (handles direct URL access like #/obligation/1 arriving on landing page before router kicks in)
  useEffect(() => {
    const match = window.location.hash.match(/^#\/obligation\/(\d+)$/)
    if (match) {
      onObligationOpen(BigInt(match[1]))
    }
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="w-full border-b" style={{ borderColor: 'var(--border)', background: 'rgba(249,249,252,0.92)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">

          {/* Logo */}
          <span
            className="display text-xl font-bold shrink-0"
            style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}
          >
            POOLLESS
          </span>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Arc Mainnet chip */}
            <div
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <NetworkArc variant="branded" size={12} />
              Arc Mainnet
            </div>

            {/* Circle Wallet connected state */}
            {isCircleConnected && (
              <div className="flex items-center gap-1.5">
                <div
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
                >
                  <span className="size-1.5 rounded-full bg-green-500 inline-block" />
                  {formatAddress(session.wallet!.address)}
                </div>
                <button
                  onClick={circleDisconnect}
                  className="flex items-center justify-center size-8 rounded-full hover:bg-black/5 transition-colors"
                  title="Disconnect"
                >
                  <LogOut className="size-3.5" style={{ color: 'var(--muted)' }} />
                </button>
              </div>
            )}

            {/* Browser wallet connected state */}
            {!isCircleConnected && (
              <ConnectKitButton.Custom>
                {({ isConnected: wagmiConn, address, show }) =>
                  wagmiConn && address ? (
                    <div
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
                      onClick={show}
                    >
                      <span className="size-1.5 rounded-full bg-green-500 inline-block" />
                      {formatAddress(address)}
                    </div>
                  ) : (
                    <button
                      onClick={() => setModalOpen(true)}
                      className="text-sm font-semibold px-4 py-2 rounded-full text-white transition-colors"
                      style={{ background: 'var(--accent)' }}
                    >
                      Connect wallet
                    </button>
                  )
                }
              </ConnectKitButton.Custom>
            )}
          </div>
        </div>
      </header>

      <ConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-10 lg:py-16">

        {isConnected ? (
          /* ── Connected experience ──────────────────────────────────── */
          <div className="flex flex-col gap-10">

            {/* Welcome + create CTA */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1
                  className="display text-3xl font-bold"
                  style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}
                >
                  Your obligations
                </h1>
                <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                  Discovered from Arc Mainnet for{' '}
                  <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
                    {formatAddress(effectiveAddress)}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={refetch}
                  className="flex items-center justify-center size-9 rounded-xl transition-colors hover:bg-black/5"
                  style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
                  title="Refresh"
                >
                  <RefreshCw className="size-4" />
                </button>
                <button
                  onClick={onCreateClick}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: 'var(--accent)' }}
                >
                  New obligation
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            {/* Dashboard */}
            <ObligationDashboard
              obligations={obligations}
              loading={loading}
              error={error}
              totalCount={totalCount}
              onOpen={onObligationOpen}
              onRefetch={refetch}
            />
          </div>

        ) : (
          /* ── Disconnected hero ─────────────────────────────────────── */
          <div className="flex flex-col lg:flex-row lg:items-start lg:gap-24">

            {/* Left: hero text */}
            <div className="flex-1 min-w-0 mb-10 lg:mb-0">
              <h1
                className="display font-bold mb-5"
                style={{
                  color: 'var(--ink)',
                  letterSpacing: '-0.04em',
                  lineHeight: 1.08,
                  fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                }}
              >
                Many people.
                <br />
                One obligation.
                <br />
                No treasurer.
              </h1>
              <p
                className="text-base mb-8"
                style={{ color: 'var(--muted)', maxWidth: '42ch' }}
              >
                Create one shared obligation. Everyone commits their own share.
                When the group completes it, the recipient gets paid directly.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 max-w-sm">
                <button
                  onClick={() => setModalOpen(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: 'var(--accent)' }}
                >
                  Connect wallet
                </button>
                <button
                  onClick={onCreateClick}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                >
                  Create an obligation
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            {/* Right: how it works card */}
            <div
              className="lg:w-[420px] shrink-0 rounded-3xl overflow-hidden"
              style={{
                background: 'var(--surface-strong)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <div className="px-6 pt-6 pb-2">
                <p
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}
                >
                  How it works
                </p>
              </div>

              {/* Three steps */}
              <div className="grid grid-cols-1">
                <Step
                  number="01"
                  icon={<Users size={16} />}
                  title="Create the obligation"
                  body="Set a title, total amount, recipient, deadline, and each contributor's named share."
                />
                <Step
                  number="02"
                  icon={<Wallet size={16} />}
                  title="Each person funds their share"
                  body="Contributors connect their wallet and approve only their own USDC amount. No one holds anyone else's money."
                  borderTop
                />
                <Step
                  number="03"
                  icon={<CheckCircle size={16} />}
                  title="Payment goes direct"
                  body="When every share is funded, the smart contract pays the full amount to the recipient."
                  borderTop
                />
              </div>

              <div className="px-6 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  A collective payment commitment protocol — built on Arc with USDC.
                </p>
              </div>
            </div>
          </div>
        )}
        {/* Public Arc Mainnet settlement demonstration */}
        <section
          className="mt-12 rounded-3xl p-6 sm:p-8"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <div
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: 'var(--accent)' }}
              >
                Verified on Arc Mainnet
              </div>

              <h2
                className="display text-2xl font-bold mb-3"
                style={{ color: 'var(--ink)' }}
              >
                Two contributors. One obligation. Settled automatically.
              </h2>

              <p
                className="text-sm mb-4"
                style={{ color: 'var(--muted)' }}
              >
                Explore a real USDC payment completed through POOLLESS.
                No wallet connection required.
              </p>

              <div className="flex flex-wrap gap-2">
                {[
                  '2 contributors',
                  '0.002 USDC settled',
                  'Arc Mainnet',
                  'Settled',
                ].map((item) => (
                  <span
                    key={item}
                    className="text-xs font-medium px-3 py-1.5 rounded-full"
                    style={{
                      background: 'var(--surface-muted)',
                      color: 'var(--ink-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onObligationOpen(1n)}
              className="shrink-0 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--accent)' }}
            >
              Explore Live Settlement
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

// ─── Step component ───────────────────────────────────────────────────────────

function Step({
  number,
  icon,
  title,
  body,
  borderTop = false,
}: {
  number: string
  icon: React.ReactNode
  title: string
  body: string
  borderTop?: boolean
}) {
  return (
    <div
      className="px-6 py-5 flex items-start gap-4"
      style={borderTop ? { borderTop: '1px solid var(--border)' } : undefined}
    >
      <div
        className="flex-shrink-0 flex items-center justify-center size-8 rounded-xl mt-0.5"
        style={{ background: 'var(--surface-muted)', color: 'var(--accent)', border: '1px solid var(--border)' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="mono text-xs font-bold" style={{ color: 'var(--subtle)' }}>{number}</span>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{body}</p>
      </div>
    </div>
  )
}
