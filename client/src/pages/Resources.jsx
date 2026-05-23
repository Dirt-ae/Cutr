import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import MainNav from '../components/MainNav'
import { API_URL } from '../utils/api'

export default function Resources({ user, logout }) {
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadResources = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${API_URL}/api/resources`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load resources')
        setResources(Array.isArray(data) ? data : [])
      } catch (e) {
        setError(e.message || 'Failed to load resources')
      } finally {
        setLoading(false)
      }
    }

    loadResources()
  }, [])

  const groupedResources = useMemo(() => {
    return resources.reduce((groups, resource) => {
      const category = resource.category || 'General'
      if (!groups[category]) groups[category] = []
      groups[category].push(resource)
      return groups
    }, {})
  }, [resources])

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <section className="mb-10 text-center">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
            Resources
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Helpful websites for editors.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-white/50 sm:text-base">
            A curated list of tools, learning sites, assets, and references for anime, Call of Duty, and IRL edit creators.
          </p>
        </section>

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 text-sm text-white/45 sm:p-12">
            <Loader2 size={16} className="animate-spin" />
            Loading resources...
          </div>
        ) : error ? (
          <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 p-5 text-center text-sm text-red-200 sm:p-8">
            {error}
          </div>
        ) : resources.length === 0 ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 text-center sm:p-12">
            <h2 className="text-lg font-semibold">No resources yet.</h2>
            <p className="mt-2 text-sm text-white/45">Check back soon for helpful editor links.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(groupedResources).map(([category, items]) => (
              <section key={category}>
                <h2 className="mb-4 text-xl font-bold tracking-tight">{category}</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((resource) => (
                    <a
                      key={resource.id}
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 transition-colors hover:bg-white/[0.075]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-white">{resource.title}</h3>
                          {resource.description && (
                            <p className="mt-2 text-sm leading-relaxed text-white/50">
                              {resource.description}
                            </p>
                          )}
                        </div>
                        <ExternalLink size={16} className="mt-1 shrink-0 text-white/35 transition-colors group-hover:text-white" />
                      </div>
                      <p className="mt-4 truncate text-xs text-white/30">{resource.url}</p>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
