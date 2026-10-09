import { useState, useEffect, useCallback } from 'react'
import LandingPage from './components/LandingPage'
import CreatePage from './components/CreatePage'
import ObligationPage from './components/ObligationPage'

type Route =
  | { page: 'landing' }
  | { page: 'create' }
  | { page: 'obligation'; id: bigint }

function parseRoute(): Route {
  const hash = window.location.hash
  const match = hash.match(/^#\/obligation\/(\d+)$/)
  if (match) return { page: 'obligation', id: BigInt(match[1]) }
  if (hash === '#/create') return { page: 'create' }
  return { page: 'landing' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute)

  // Sync hash ↔ route
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((r: Route) => {
    if (r.page === 'landing') window.location.hash = ''
    else if (r.page === 'create') window.location.hash = '#/create'
    else if (r.page === 'obligation') window.location.hash = `#/obligation/${r.id}`
    setRoute(r)
  }, [])

  if (route.page === 'create') {
    return (
      <CreatePage
        onBack={() => navigate({ page: 'landing' })}
        onCreated={(id) => navigate({ page: 'obligation', id })}
      />
    )
  }

  if (route.page === 'obligation') {
    return (
      <ObligationPage
        obligationId={route.id}
        onBack={() => navigate({ page: 'landing' })}
      />
    )
  }

  return (
    <LandingPage
      onCreateClick={() => navigate({ page: 'create' })}
      onObligationOpen={(id) => navigate({ page: 'obligation', id })}
    />
  )
}
