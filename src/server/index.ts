import 'dotenv/config'
import express from 'express'
import path from 'path'
import { getAllTracks, AlbumStat, getAlbumTopTags, getArtistTopTags } from './lastfm.js'
import { initDb, saveStats, loadStats, updateAlbumMetadata, getAlbumsMissingMetadata, getAllTags, createTag, renameTag, deleteTag, addTagToAlbum, removeTagFromAlbum, getOrCreateTag, updateAlbumCategorization, getSetting, setSetting, getBookmarks } from './db.js'
import { searchAlbum as spotifySearchAlbum, SpotifyAlbumInfo } from './spotify.js'
import { getMbAlbumTags } from './musicbrainz.js'
import { initLoggerDb, startSyncLog, updateSyncLog, logError, finishSyncLog, getRecentSyncLogs, getUnacknowledgedAlerts, acknowledgeAlert, acknowledgeAllAlerts } from './logger.js'

const app = express()
const PORT = process.env.PORT || 3000
const LASTFM_USER = process.env.LASTFM_USER || 'boytunewonder'
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // re-sync every 6 hours

app.use(express.json())

interface State {
  stats: AlbumStat[]
  totalTracks: number
  fetchedAt: string | null
  status: 'idle' | 'fetching-tracks' | 'fetching-albums' | 'done' | 'error'
  progress: string
}

const state: State = {
  stats: [],
  totalTracks: 0,
  fetchedAt: null,
  status: 'idle',
  progress: '',
}

let refreshLock = false
let lastSync = 0

async function doRefresh(force = false) {
  if (refreshLock) return
  if (!force && Date.now() - lastSync < SYNC_INTERVAL_MS) return
  refreshLock = true
  const hasExistingData = state.stats.length > 0
  
  try {
    await startSyncLog()
    
    if (!hasExistingData) state.status = 'fetching-tracks'
    state.progress = 'Fetching scrobbles from Last.fm...'
    await updateSyncLog({ phase: 'fetching-scrobbles' })
    console.log('Syncing Last.fm data for', LASTFM_USER)

    // 1. Get scrobble history from Last.fm (what was listened to)
    const fromTs = Math.floor(Date.now() / 1000) - 10 * 365 * 24 * 60 * 60
    const tracks = await getAllTracks(LASTFM_USER, fromTs, (page, total) => {
      state.progress = `Fetching scrobbles: page ${page}/${total}`
    })
    state.totalTracks = tracks.length
    console.log(`Got ${tracks.length} tracks from Last.fm`)

    // 2. Build album map from scrobbles
    const albumMap = new Map<string, { artist: string; album: string; tracks: Set<string> }>()
    for (const t of tracks) {
      const key = `${t.artist.toLowerCase()}|||${t.album.toLowerCase()}`
      if (!albumMap.has(key)) albumMap.set(key, { artist: t.artist, album: t.album, tracks: new Set() })
      albumMap.get(key)!.tracks.add(t.name.toLowerCase())
    }

    const albumEntries = Array.from(albumMap.entries())
    console.log(`${albumEntries.length} unique albums`)
    await updateSyncLog({ phase: 'enriching-metadata', totalAlbums: albumEntries.length })
    
    if (!hasExistingData) state.status = 'fetching-albums'

    // 3. Enrich each album with Spotify metadata
    const newStats: AlbumStat[] = []
    let done = 0
    let spotifyHits = 0
    let spotifyMisses = 0

    for (const [, { artist, album, tracks: listenedSet }] of albumEntries) {
      done++
      state.progress = `Enriching album ${done}/${albumEntries.length}: ${artist} - ${album}`
      
      if (done % 100 === 0) {
        await updateSyncLog({ albumsProcessed: done, spotifyHits, spotifyMisses })
      }

      // Try Spotify for metadata
      let spotifyInfo: SpotifyAlbumInfo | null = null
      try {
        spotifyInfo = await spotifySearchAlbum(artist, album)
        if (spotifyInfo) {
          spotifyHits++
        } else {
          spotifyMisses++
          logError(artist, album, 'Not found on Spotify')
        }
      } catch (err) {
        spotifyMisses++
        logError(artist, album, `Spotify error: ${(err as Error).message}`)
      }

      // Rate limit: Spotify allows 30 req/sec, but be conservative
      await new Promise(r => setTimeout(r, 50))

      let stat: AlbumStat
      if (spotifyInfo) {
        // Use Spotify data for track matching
        const matchedCount = spotifyInfo.tracks.filter(t => listenedSet.has(t)).length
        const listenedCount = matchedCount > 0 ? matchedCount : listenedSet.size
        const percentage = Math.min(100, Math.round((listenedCount / spotifyInfo.totalTracks) * 100))
        
        stat = {
          album: spotifyInfo.name,
          artist: spotifyInfo.artist,
          totalTracks: spotifyInfo.totalTracks,
          listenedTracks: Array.from(listenedSet),
          allTracks: spotifyInfo.tracks,
          listenedCount,
          percentage,
          complete: listenedCount >= spotifyInfo.totalTracks,
          imageUrl: spotifyInfo.imageUrl ?? undefined,
          releaseYear: spotifyInfo.releaseYear,
          spotifyId: spotifyInfo.spotifyId,
        }
      } else {
        // No Spotify data - use Last.fm scrobble data only
        stat = {
          album,
          artist,
          totalTracks: 0,  // Unknown
          listenedTracks: Array.from(listenedSet),
          allTracks: [],
          listenedCount: listenedSet.size,
          percentage: 0,
          complete: false,
          // No image, year, or Spotify ID
        }
      }
      newStats.push(stat)
    }

    await updateSyncLog({ albumsProcessed: done, spotifyHits, spotifyMisses, phase: 'saving' })

    // Sort: incomplete first (by percentage desc), then complete
    newStats.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1
      if (!a.totalTracks && b.totalTracks) return 1
      if (!b.totalTracks && a.totalTracks) return -1
      return b.percentage - a.percentage
    })

    // 4. Save to DB
    await saveStats(newStats, state.totalTracks)
    
    // 5. Reload from DB to ensure consistency
    const reloaded = await loadStats()
    if (reloaded) {
      state.stats = reloaded.stats
      state.totalTracks = reloaded.totalTracks
      state.fetchedAt = reloaded.fetchedAt
    } else {
      state.stats = newStats
      state.fetchedAt = new Date().toISOString()
    }
    
    lastSync = Date.now()
    state.status = 'done'
    state.progress = ''
    
    await finishSyncLog('success')
    console.log(`Sync complete — ${state.stats.length} albums, ${spotifyHits} Spotify hits, ${spotifyMisses} misses`)
    
  } catch (err) {
    state.status = 'error'
    state.progress = String(err)
    console.error('Sync error:', err)
    await finishSyncLog('error', (err as Error).message)
  } finally {
    refreshLock = false
  }
}

// Background job to enrich albums missing metadata
async function enrichMissingMetadata() {
  const missing = await getAlbumsMissingMetadata(100)
  if (missing.length === 0) return
  
  console.log(`Enriching ${missing.length} albums missing Spotify metadata...`)
  let enriched = 0
  
  for (const { artist, album } of missing) {
    const info = await spotifySearchAlbum(artist, album)
    if (info) {
      await updateAlbumMetadata(artist, album, {
        spotifyId: info.spotifyId,
        releaseYear: info.releaseYear,
        imageUrl: info.imageUrl ?? undefined,
        totalTracks: info.totalTracks,
      })
      
      // Update in-memory state
      const stat = state.stats.find(
        s => s.artist.toLowerCase() === artist.toLowerCase() &&
             s.album.toLowerCase() === album.toLowerCase()
      )
      if (stat) {
        stat.spotifyId = info.spotifyId
        stat.releaseYear = info.releaseYear
        stat.imageUrl = info.imageUrl ?? stat.imageUrl
        stat.totalTracks = info.totalTracks
        stat.allTracks = info.tracks
      }
      enriched++
    }
    await new Promise(r => setTimeout(r, 50))
  }
  
  console.log(`Enriched ${enriched}/${missing.length} albums`)
}

async function boot() {
  // Init DB schemas
  try {
    await initDb()
    await initLoggerDb()
  } catch (err) {
    console.error('DB init failed:', err)
    state.status = 'error'
    state.progress = 'Database unavailable. Please try again later.'
    return
  }

  // Load cached data from DB
  let cached = null
  try {
    cached = await loadStats()
  } catch (err) {
    console.error('DB load failed:', err)
    state.status = 'error'
    state.progress = 'Could not load data from database. Please try again later.'
    return
  }

  if (cached) {
    state.stats = cached.stats
    state.totalTracks = cached.totalTracks
    state.fetchedAt = cached.fetchedAt
    state.status = 'done'
    lastSync = cached.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0
    console.log(`Loaded ${state.stats.length} albums from DB (cached ${cached.fetchedAt})`)
  }

  // DB empty = first ever run, sync from scratch
  // DB stale = background re-sync
  const stale = Date.now() - lastSync > SYNC_INTERVAL_MS
  if (!cached) {
    console.log('DB empty — first run, syncing from Last.fm + Spotify...')
    doRefresh(true)
  } else if (stale) {
    console.log('Data stale, background syncing...')
    doRefresh(true)
  } else {
    // Just enrich any missing metadata in background
    enrichMissingMetadata()
  }

  // Schedule periodic re-sync
  setInterval(() => doRefresh(), SYNC_INTERVAL_MS)
}

// API endpoints
app.get('/api/stats', (_req, res) => {
  res.json({
    loading: state.status === 'fetching-tracks' || state.status === 'fetching-albums',
    status: state.status,
    progress: state.progress,
    stats: state.stats,
    totalTracks: state.totalTracks,
    fetchedAt: state.fetchedAt,
  })
})

app.get('/api/sync-logs', async (_req, res) => {
  const logs = await getRecentSyncLogs(20)
  res.json(logs)
})

app.get('/api/alerts', async (_req, res) => {
  const alerts = await getUnacknowledgedAlerts()
  res.json(alerts)
})

app.post('/api/alerts/:id/ack', async (req, res) => {
  await acknowledgeAlert(parseInt(req.params.id, 10))
  res.json({ ok: true })
})

app.post('/api/alerts/ack-all', async (_req, res) => {
  await acknowledgeAllAlerts()
  res.json({ ok: true })
})

// ==================== TAG MANAGEMENT ====================

app.get('/api/tags', async (_req, res) => {
  const tags = await getAllTags()
  res.json(tags)
})

app.post('/api/tags', async (req, res) => {
  const { name } = req.body
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' })
  try {
    const tag = await createTag(name)
    res.json(tag)
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'tag already exists' })
    throw err
  }
})

app.put('/api/tags/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const { name } = req.body
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' })
  try {
    await renameTag(id, name)
    res.json({ ok: true })
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'tag name already exists' })
    throw err
  }
})

app.delete('/api/tags/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  await deleteTag(id)
  res.json({ ok: true })
})

// ==================== ALBUM CATEGORIZATION ====================

app.put('/api/albums/:artist/:album/categorization', async (req, res) => {
  const { artist, album } = req.params
  const { tier, energy } = req.body
  
  // Validate tier
  if (tier !== undefined && tier !== null && !['top', 'mid', 'low', 'hidden', 'bookmarked'].includes(tier)) {
    return res.status(400).json({ error: 'tier must be top, mid, low, hidden, bookmarked, or null' })
  }
  // Validate energy
  if (energy !== undefined && energy !== null && !['ambient', 'moderate', 'intense'].includes(energy)) {
    return res.status(400).json({ error: 'energy must be ambient, moderate, intense, or null' })
  }
  
  await updateAlbumCategorization(decodeURIComponent(artist), decodeURIComponent(album), { tier, energy })
  
  // Update in-memory state
  const stat = state.stats.find(
    s => s.artist.toLowerCase() === decodeURIComponent(artist).toLowerCase() &&
         s.album.toLowerCase() === decodeURIComponent(album).toLowerCase()
  )
  if (stat) {
    if (tier !== undefined) stat.tier = tier ?? undefined
    if (energy !== undefined) stat.energy = energy ?? undefined
  }
  
  res.json({ ok: true })
})

app.post('/api/albums/:artist/:album/tags', async (req, res) => {
  const { artist, album } = req.params
  const { tagName, tagId } = req.body
  
  let tag
  if (tagId) {
    tag = { id: tagId }
  } else if (tagName) {
    tag = await getOrCreateTag(tagName)
  } else {
    return res.status(400).json({ error: 'tagName or tagId required' })
  }
  
  await addTagToAlbum(decodeURIComponent(artist), decodeURIComponent(album), tag.id)
  
  // Update in-memory state
  const stat = state.stats.find(
    s => s.artist.toLowerCase() === decodeURIComponent(artist).toLowerCase() &&
         s.album.toLowerCase() === decodeURIComponent(album).toLowerCase()
  )
  if (stat) {
    const name = tagName?.toLowerCase().trim() || ''
    if (!stat.tags) stat.tags = []
    if (name && !stat.tags.includes(name)) stat.tags.push(name)
  }
  
  res.json({ ok: true, tag })
})

app.delete('/api/albums/:artist/:album/tags/:tagId', async (req, res) => {
  const { artist, album, tagId } = req.params
  await removeTagFromAlbum(decodeURIComponent(artist), decodeURIComponent(album), parseInt(tagId, 10))
  
  // Note: We'd need the tag name to remove from in-memory state properly
  // For now, just return success and let the client refetch
  
  res.json({ ok: true })
})

// ==================== SUGGESTED TAGS ====================

const suggestedTagsCache = new Map<string, { tags: string[]; ts: number }>()
const SUGGESTED_TAGS_TTL = 5 * 60 * 1000 // 5 minutes

app.get('/api/albums/:artist/:album/suggested-tags', async (req, res) => {
  const artist = decodeURIComponent(req.params.artist)
  const album = decodeURIComponent(req.params.album)

  const cacheKey = `${artist.toLowerCase()}|||${album.toLowerCase()}`
  const cached = suggestedTagsCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < SUGGESTED_TAGS_TTL) {
    return res.json({ tags: cached.tags })
  }

  // Fetch from Last.fm (album + artist tags) and MusicBrainz in parallel
  // Note: MB internally rate-limits to 1 req/sec and makes 2 sequential requests
  const [lfmAlbumTags, lfmArtistTags, mbTags] = await Promise.all([
    getAlbumTopTags(artist, album),
    getArtistTopTags(artist),
    getMbAlbumTags(artist, album),
  ])

  // Combine: Last.fm album tags first (most specific), then MB tags, then Last.fm artist tags
  const seen = new Set<string>()
  const combined: string[] = []
  for (const tag of [...lfmAlbumTags, ...mbTags, ...lfmArtistTags]) {
    const lower = tag.toLowerCase().trim()
    if (lower && !seen.has(lower)) {
      seen.add(lower)
      combined.push(lower)
    }
  }

  const top8 = combined.slice(0, 8)
  suggestedTagsCache.set(cacheKey, { tags: top8, ts: Date.now() })

  res.json({ tags: top8 })
})

// ==================== SPOTIFY NOW PLAYING ====================

const SPOTIFY_REDIRECT_URI = process.env.NODE_ENV === 'production'
  ? 'https://listening-log.onrender.com/api/spotify/callback'
  : 'http://localhost:3000/api/spotify/callback'

// Cached access token to avoid refreshing every 15 seconds
let spotifyAccessToken: string | null = null
let spotifyAccessTokenExpiry = 0

async function getSpotifyAccessToken(): Promise<string | null> {
  if (spotifyAccessToken && Date.now() < spotifyAccessTokenExpiry) {
    return spotifyAccessToken
  }

  const refreshToken = await getSetting('spotify_refresh_token')
  if (!refreshToken) return null

  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) return null

  const data = await res.json() as { access_token: string; expires_in: number }
  spotifyAccessToken = data.access_token
  // Expire 60s early to be safe
  spotifyAccessTokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return spotifyAccessToken
}

app.get('/api/spotify/auth', (_req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state',
  })
  res.redirect(`https://accounts.spotify.com/authorize?${params}`)
})

app.get('/api/spotify/callback', async (req, res) => {
  const { code, error } = req.query as { code?: string; error?: string }

  if (error || !code) {
    return res.status(400).send(`Spotify auth error: ${error || 'missing code'}`)
  }

  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) return res.status(500).send('Failed to exchange code for token')

    const { refresh_token } = await tokenRes.json() as { refresh_token: string }
    await setSetting('spotify_refresh_token', refresh_token)

    // Clear cached access token so next request refreshes
    spotifyAccessToken = null

    res.send('<html><body style="font-family:sans-serif;background:#111;color:#e0e0e0;padding:40px;text-align:center"><h2>Spotify connected!</h2><p>You can close this window.</p></body></html>')
  } catch (err) {
    console.error('Spotify callback error:', err)
    res.status(500).send('Internal error during Spotify auth')
  }
})

app.get('/api/now-playing', async (_req, res) => {
  try {
    const accessToken = await getSpotifyAccessToken()
    if (!accessToken) return res.json({ playing: false })

    const trackRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (trackRes.status === 204) return res.json({ playing: false })
    if (!trackRes.ok) return res.json({ playing: false })

    const data = await trackRes.json() as {
      is_playing: boolean
      progress_ms: number
      item: {
        name: string
        duration_ms: number
        artists: Array<{ name: string }>
        album: { name: string; images: Array<{ url: string }> }
      } | null
    }

    if (!data.is_playing || !data.item) return res.json({ playing: false })

    res.json({
      playing: true,
      track: {
        name: data.item.name,
        artist: data.item.artists.map(a => a.name).join(', '),
        album: data.item.album.name,
        albumArt: data.item.album.images[0]?.url ?? null,
        progress: data.progress_ms,
        duration: data.item.duration_ms,
      },
    })
  } catch (err) {
    console.error('now-playing error:', err)
    res.json({ playing: false })
  }
})

app.post('/api/spotify/play', async (req, res) => {
  const { spotifyId } = req.body
  if (!spotifyId || typeof spotifyId !== 'string') {
    return res.status(400).json({ error: 'spotifyId required' })
  }

  try {
    const accessToken = await getSpotifyAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Spotify not connected' })

    const playRes = await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ context_uri: `spotify:album:${spotifyId}` }),
    })

    if (playRes.status === 204 || playRes.ok) {
      return res.json({ ok: true })
    }

    if (playRes.status === 404) {
      return res.status(404).json({ error: 'No active Spotify device found. Open Spotify on a device first.' })
    }

    return res.status(playRes.status).json({ error: 'Spotify playback failed' })
  } catch (err) {
    console.error('spotify/play error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// Proxy album art — avoids hotlinking, caches in memory
const artCache = new Map<string, { data: Buffer; contentType: string }>()
app.get('/api/albumart', async (req, res) => {
  const { artist, album } = req.query as { artist?: string; album?: string }
  if (!artist || !album) return res.status(400).send('missing params')

  const key = `${artist}|||${album}`
  if (artCache.has(key)) {
    const cached = artCache.get(key)!
    res.set('Content-Type', cached.contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    return res.send(cached.data)
  }

  // Find the imageUrl from state
  const stat = state.stats.find(
    s => s.artist.toLowerCase() === artist.toLowerCase() &&
         s.album.toLowerCase() === album.toLowerCase()
  )
  if (!stat?.imageUrl) return res.status(404).send('no image')

  try {
    const upstream = await fetch(stat.imageUrl)
    if (!upstream.ok) return res.status(404).send('upstream failed')
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    const data = Buffer.from(await upstream.arrayBuffer())
    artCache.set(key, { data, contentType })
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    return res.send(data)
  } catch {
    return res.status(500).send('fetch failed')
  }
})

// ==================== RECENT ALBUMS ====================

interface RecentAlbumEntry {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
  allTracks: string[]
  listenedCount: number
  percentage: number
  complete: boolean
  imageUrl?: string
  spotifyId?: string
  releaseYear?: number
  tier?: 'top' | 'mid' | 'low' | 'hidden' | 'bookmarked'
  energy?: 'ambient' | 'moderate' | 'intense'
  tags?: string[]
  lastListenedAt: string
}

let recentCache: { data: RecentAlbumEntry[]; ts: number } | null = null
const RECENT_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

app.get('/api/recent', async (_req, res) => {
  if (recentCache && Date.now() - recentCache.ts < RECENT_CACHE_TTL) {
    return res.json(recentCache.data)
  }

  try {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
    const tracks = await getAllTracks(LASTFM_USER, thirtyDaysAgo)

    // Group by album key, track most recent listen date per album
    const albumMap = new Map<string, string>() // key -> lastListenedAt
    for (const t of tracks) {
      if (!t.playedAt) continue
      const key = `${t.artist.toLowerCase()}|||${t.album.toLowerCase()}`
      const existing = albumMap.get(key)
      if (!existing || t.playedAt > existing) {
        albumMap.set(key, t.playedAt)
      }
    }

    // Join with state.stats to get full album info
    const recent: RecentAlbumEntry[] = []
    for (const [key, lastListenedAt] of albumMap) {
      const stat = state.stats.find(
        s => `${s.artist.toLowerCase()}|||${s.album.toLowerCase()}` === key
      )
      if (stat) {
        recent.push({ ...stat, lastListenedAt })
      }
    }

    // Sort newest listen first
    recent.sort((a, b) => b.lastListenedAt.localeCompare(a.lastListenedAt))

    recentCache = { data: recent, ts: Date.now() }
    res.json(recent)
  } catch (err) {
    console.error('/api/recent error:', err)
    res.status(500).json({ error: 'Failed to fetch recent albums' })
  }
})

app.get('/api/bookmarks', async (_req, res) => {
  try {
    const bookmarks = await getBookmarks()
    res.json(bookmarks)
  } catch (err) {
    console.error('/api/bookmarks error:', err)
    res.status(500).json({ error: 'Failed to fetch bookmarks' })
  }
})

app.post('/api/refresh', (_req, res) => {
  doRefresh(true)
  res.json({ ok: true })
})

const clientDist = path.join(__dirname, '../client')
app.use(express.static(clientDist))
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), err => {
    if (err) res.status(500).send('Client not found')
  })
})

app.listen(PORT, () => {
  console.log(`Listening Log on port ${PORT}`)
  boot()
})
