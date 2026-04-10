const API_KEY = process.env.LASTFM_API_KEY!
const BASE = 'https://ws.audioscrobbler.com/2.0'

export interface Track {
  name: string
  artist: string
  album: string
  playedAt: string | null
}

export interface AlbumStat {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
  allTracks: string[]  // full tracklist from Spotify, empty if unknown
  listenedCount: number
  percentage: number
  complete: boolean
  imageUrl?: string
  spotifyId?: string
  releaseYear?: number
  tier?: 'top' | 'mid' | 'low'
  energy?: 'ambient' | 'moderate' | 'intense'
  tags?: string[]
}

async function lfmGet(params: Record<string, string>): Promise<unknown> {
  const url = new URL(BASE)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  // Try up to 6 times with increasing delays
  const delays = [1000, 2000, 3000, 5000, 8000, 10000]
  let lastErr: Error = new Error('unknown')
  for (let i = 0; i < delays.length; i++) {
    try {
      const res = await fetch(url.toString())
      if (res.ok) return await res.json()
      const body = await res.text().catch(() => '')
      lastErr = new Error(`HTTP ${res.status}: ${body.slice(0, 100)}`)
      console.log(`Last.fm ${res.status} on attempt ${i + 1}, waiting ${delays[i]}ms`)
    } catch (e) {
      lastErr = e as Error
      console.log(`Last.fm fetch error on attempt ${i + 1}: ${lastErr.message}`)
    }
    await new Promise(r => setTimeout(r, delays[i]))
  }
  throw lastErr
}

export async function getAllTracks(
  user: string,
  fromTs?: number,
  onProgress?: (page: number, total: number) => void
): Promise<Track[]> {
  const tracks: Track[] = []
  let page = 1
  const limit = 200

  while (true) {
    const params: Record<string, string> = {
      method: 'user.getrecenttracks',
      user,
      limit: String(limit),
      page: String(page),
      extended: '0',
    }
    if (fromTs) params.from = String(fromTs)

    const data = (await lfmGet(params)) as {
      recenttracks: {
        track: Array<{
          name: string
          artist: { '#text': string }
          album: { '#text': string }
          date?: { uts: string }
          '@attr'?: { nowplaying: string }
        }>
        '@attr': { totalPages: string; total: string }
      }
    }

    const rt = data.recenttracks
    const totalPages = parseInt(rt['@attr'].totalPages, 10)

    for (const t of rt.track) {
      if (t['@attr']?.nowplaying) continue
      const album = t.album['#text']?.trim()
      if (!album) continue
      tracks.push({
        name: t.name,
        artist: t.artist['#text'],
        album,
        playedAt: t.date ? new Date(parseInt(t.date.uts, 10) * 1000).toISOString() : null,
      })
    }

    if (page >= totalPages || page >= 500) break
    if (onProgress) onProgress(page, totalPages)
    page++
    await new Promise(r => setTimeout(r, 250))
  }

  return tracks
}

export async function getAlbumInfo(artist: string, album: string): Promise<{
  name: string
  artist: string
  totalTracks: number
  tracks: string[]
  imageUrl?: string
} | null> {
  try {
    const data = (await lfmGet({
      method: 'album.getinfo',
      artist,
      album,
    })) as {
      album?: {
        name: string
        artist: string
        image?: Array<{ '#text': string; size: string }>
        tracks?: { track: Array<{ name: string }> | { name: string } }
      }
      error?: number
    }

    if (data.error || !data.album?.tracks) return null

    const raw = data.album.tracks.track
    const trackList = Array.isArray(raw) ? raw : [raw]
    if (!trackList.length) return null

    // Pick largest available image
    const images = data.album.image ?? []
    const preferred = ['extralarge', 'large', 'medium', 'small']
    let imageUrl: string | undefined
    for (const size of preferred) {
      const img = images.find(i => i.size === size)
      if (img?.['#text']) { imageUrl = img['#text']; break }
    }

    return {
      name: data.album.name,
      artist: data.album.artist,
      totalTracks: trackList.length,
      tracks: trackList.map(t => t.name.toLowerCase()),
      imageUrl,
    }
  } catch {
    return null
  }
}

export async function buildAlbumStats(user: string, yearsBack = 10): Promise<{
  stats: AlbumStat[]
  totalTracks: number
  fetchedAt: string
}> {
  // Fetch history from N years back
  const fromTs = Math.floor(Date.now() / 1000) - yearsBack * 365 * 24 * 60 * 60
  const tracks = await getAllTracks(user, fromTs)

  // Build album -> listened tracks map
  const albumMap = new Map<string, { artist: string; album: string; tracks: Set<string> }>()

  for (const t of tracks) {
    const key = `${t.artist.toLowerCase()}|||${t.album.toLowerCase()}`
    if (!albumMap.has(key)) {
      albumMap.set(key, { artist: t.artist, album: t.album, tracks: new Set() })
    }
    albumMap.get(key)!.tracks.add(t.name.toLowerCase())
  }

  const stats: AlbumStat[] = []

  for (const [, { artist, album, tracks: listenedSet }] of albumMap) {
    const info = await getAlbumInfo(artist, album)
    await new Promise(r => setTimeout(r, 100))

    if (!info || info.totalTracks === 0) {
      stats.push({
        album,
        artist,
        totalTracks: 0,
        listenedTracks: Array.from(listenedSet),
        allTracks: [],
        listenedCount: listenedSet.size,
        percentage: 0,
        complete: false,
      })
      continue
    }

    // Count listened tracks that exist in the album
    const matchedCount = info.tracks.filter(t => listenedSet.has(t)).length
    const listenedCount = matchedCount > 0 ? matchedCount : listenedSet.size
    const percentage = Math.min(100, Math.round((listenedCount / info.totalTracks) * 100))

    stats.push({
      album: info.name,
      artist: info.artist,
      totalTracks: info.totalTracks,
      listenedTracks: Array.from(listenedSet),
      allTracks: info.tracks,
      listenedCount,
      percentage,
      complete: listenedCount >= info.totalTracks,
    })
  }

  // Sort: incomplete first sorted by % desc, then complete
  stats.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1
    if (a.totalTracks === 0 && b.totalTracks !== 0) return 1
    if (b.totalTracks === 0 && a.totalTracks !== 0) return -1
    return b.percentage - a.percentage
  })

  return { stats, totalTracks: tracks.length, fetchedAt: new Date().toISOString() }
}
