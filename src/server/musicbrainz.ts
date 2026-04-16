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

export async function getMbAlbumTags(artist: string, album: string): Promise<string[]> {
  try {
    // Step 1: Find the release-group MBID
    const searchData = await mbGet('/release-group/', {
      query: `artist:"${artist}" release:"${album}"`,
      limit: '3',
    }) as {
      'release-groups'?: Array<{ id: string; title: string; score?: number }>
    }

    const groups = searchData['release-groups'] ?? []
    if (groups.length === 0) return []

    const mbid = groups[0].id

    // Step 2: Fetch tags for that release-group
    const tagData = await mbGet(`/release-group/${mbid}`, {
      inc: 'tags',
    }) as {
      tags?: Array<{ name: string; count: number }>
    }

    return (tagData.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .map(t => t.name.toLowerCase())
  } catch {
    return []
  }
}

export interface MbArtistInfo {
  name: string
  disambiguation?: string
  area?: string
  formedYear?: number
  tags: string[]
}

export async function getMbArtistInfo(artist: string): Promise<MbArtistInfo | null> {
  try {
    const searchData = await mbGet('/artist/', {
      query: `artist:"${artist}"`,
      limit: '3',
    }) as { artists?: Array<{ id: string; name: string; score?: number }> }

    const artists = searchData.artists ?? []
    if (artists.length === 0) return null

    const mbid = artists[0].id

    const data = await mbGet(`/artist/${mbid}`, {
      inc: 'tags',
    }) as {
      name: string
      disambiguation?: string
      area?: { name: string }
      'life-span'?: { begin?: string }
      tags?: Array<{ name: string; count: number }>
    }

    const tags = (data.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .map(t => t.name.toLowerCase())
      .slice(0, 10)

    const beginStr = data['life-span']?.begin
    const formedYear = beginStr ? parseInt(beginStr.slice(0, 4), 10) : undefined

    return {
      name: data.name,
      disambiguation: data.disambiguation,
      area: data.area?.name,
      formedYear: formedYear && !isNaN(formedYear) ? formedYear : undefined,
      tags,
    }
  } catch {
    return null
  }
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
