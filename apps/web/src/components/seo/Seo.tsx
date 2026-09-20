import { useEffect } from 'react'

interface SeoProps {
  title: string
  description?: string
  /** Authenticated app screens must never be indexed — financial data
   * behind a login wall has no business in a search index, and Google
   * couldn't meaningfully render it anyway. Only the public marketing
   * page and the login screen itself should ever pass noindex={false}. */
  noindex?: boolean
}

/**
 * No react-helmet or similar — for an app this size, a single
 * useEffect that sets document.title and upserts a handful of meta
 * tags is simpler than a new dependency and does everything actually
 * needed. Called from individual pages that opt in — currently just
 * the public landing page and the login screen; every authenticated
 * route deliberately does NOT call this (see AuthGuard, which sets a
 * blanket noindex once for the whole authenticated app instead).
 */
export function Seo({ title, description, noindex = true }: SeoProps) {
  useEffect(() => {
    document.title = title

    const upsert = (selector: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector)
      if (!el) {
        el = document.createElement('meta')
        document.head.appendChild(el)
      }
      Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v))
    }

    if (description) {
      upsert('meta[name="description"]', { name: 'description', content: description })
      upsert('meta[property="og:description"]', { property: 'og:description', content: description })
    }
    upsert('meta[property="og:title"]', { property: 'og:title', content: title })
    upsert('meta[name="robots"]', { name: 'robots', content: noindex ? 'noindex, nofollow' : 'index, follow' })
  }, [title, description, noindex])

  return null
}
