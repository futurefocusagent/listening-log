const MB_BASE = 'https://musicbrainz.org/ws/2'
const MB_USER_AGENT = 'listening-log/1.0 (futurefocusagent@gmail.com)'

// Simple rate-limit: MusicBrainz allows 1 req/sec
let lastMbRequest = 0
async function mbGet(path: string, params: Record<string, string>): Promise<unknown> {
  const now = Date.now()
  const wait = 1100 - (now - lastMbRequest)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastMbRequest = Date.now()

  const url = new URL(`${MB_BASE}${path}`)
  url.searchParams.set('fmt', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': MB_USER_AGENT },
  })
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}: ${url}`)
  return res.json()
}

export async function getReleaseYear(artist: string, album: string): Promise<number | null> {
  try {
    const data = await mbGet('/release/', {
      query: `artist:"${artist}" release:"${album}"`,
      limit: '5',
    }) as {
      releases?: Array<{
        title: string
        date?: string
        score?: number
        'artist-credit'?: Array<{ artist: { name: string } }>
      }>
    }

    const releases = data.releases ?? []
    if (releases.length === 0) return null

    // Filter to releases with a date, extract years
    const years = releases
      .filter(r => r.date && /^\d{4}/.test(r.date))
      .map(r => parseInt(r.date!.slice(0, 4), 10))

    if (years.length === 0) return null

    // Return earliest year (original release, not remasters/rereleases)
    return Math.min(...years)
  } catch {
    return null
  }
}
