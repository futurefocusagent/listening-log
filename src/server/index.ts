import 'dotenv/config'
import express from 'express'
import path from 'path'
import { getAllTracks, AlbumStat } from './lastfm.js'
import { initDb, saveStats, loadStats, updateAlbumMetadata, getAlbumsMissingMetadata, getAllTags, createTag, renameTag, deleteTag, addTagToAlbum, removeTagFromAlbum, getOrCreateTag, updateAlbumCategorization } from './db.js'
import { searchAlbum as spotifySearchAlbum, SpotifyAlbumInfo } from './spotify.js'
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
  if (tier !== undefined && tier !== null && !['top', 'mid', 'low'].includes(tier)) {
    return res.status(400).json({ error: 'tier must be top, mid, low, or null' })
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

app.post('/api/refresh', (_req, res) => {
  doRefresh(true)
  res.json({ ok: true })
})

const clientDist = path.join(__dirname, '../client')
app.use(express.static(clientDist))
app.get('*path', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), err => {
    if (err) res.status(500).send('Client not found')
  })
})

app.listen(PORT, () => {
  console.log(`Listening Log on port ${PORT}`)
  boot()
})
