import 'dotenv/config'
import express from 'express'
import path from 'path'
import { getAllTracks, getAlbumInfo, AlbumStat } from './lastfm'
import { initDb, saveStats, loadStats, updateImageUrl, getAlbumsMissingImages, updateReleaseYear, getAlbumsMissingYear, updateSpotifyId, getAlbumsMissingSpotifyId } from './db'
import { getReleaseYear } from './musicbrainz'
import { searchAlbum as spotifySearchAlbum } from './spotify'

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
    if (!hasExistingData) state.status = 'fetching-tracks'
    state.progress = 'Fetching scrobbles...'
    console.log('Syncing Last.fm data for', LASTFM_USER)

    const fromTs = Math.floor(Date.now() / 1000) - 10 * 365 * 24 * 60 * 60
    const tracks = await getAllTracks(LASTFM_USER, fromTs, (page, total) => {
      state.progress = `Fetching scrobbles: page ${page}/${total}`
    })
    state.totalTracks = tracks.length
    console.log(`Got ${tracks.length} tracks`)

    // Build album map
    const albumMap = new Map<string, { artist: string; album: string; tracks: Set<string> }>()
    for (const t of tracks) {
      const key = `${t.artist.toLowerCase()}|||${t.album.toLowerCase()}`
      if (!albumMap.has(key)) albumMap.set(key, { artist: t.artist, album: t.album, tracks: new Set() })
      albumMap.get(key)!.tracks.add(t.name.toLowerCase())
    }

    const albumEntries = Array.from(albumMap.entries())
    console.log(`${albumEntries.length} unique albums — looking up track counts`)
    if (!hasExistingData) state.status = 'fetching-albums'

    const newStats: AlbumStat[] = []
    let done = 0
    for (const [, { artist, album, tracks: listenedSet }] of albumEntries) {
      done++
      state.progress = `Looking up album info: ${done}/${albumEntries.length}`

      const info = await getAlbumInfo(artist, album)
      await new Promise(r => setTimeout(r, 100))

      let stat: AlbumStat
      if (!info || info.totalTracks === 0) {
        stat = {
          album, artist,
          totalTracks: 0,
          listenedTracks: Array.from(listenedSet),
          listenedCount: listenedSet.size,
          percentage: 0,
          complete: false,
          imageUrl: info?.imageUrl,
        }
      } else {
        const matchedCount = info.tracks.filter(t => listenedSet.has(t)).length
        const listenedCount = matchedCount > 0 ? matchedCount : listenedSet.size
        const percentage = Math.min(100, Math.round((listenedCount / info.totalTracks) * 100))
        stat = {
          album: info.name,
          artist: info.artist,
          totalTracks: info.totalTracks,
          listenedTracks: Array.from(listenedSet),
          listenedCount,
          percentage,
          complete: listenedCount >= info.totalTracks,
          imageUrl: info.imageUrl,
        }
      }
      newStats.push(stat)
    }

    newStats.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1
      if (!a.totalTracks && b.totalTracks) return 1
      if (!b.totalTracks && a.totalTracks) return -1
      return b.percentage - a.percentage
    })

    // Persist to DB
    await saveStats(newStats, state.totalTracks)
    
    // Reload from DB to get enriched data (release_year, spotify_id, etc)
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
    console.log('Sync complete —', state.stats.length, 'albums saved to DB')
    
    // Run backfills after sync
    backfillYears()
    backfillSpotifyIds()
    backfillImages()
  } catch (err) {
    state.status = 'error'
    state.progress = String(err)
    console.error('Sync error:', err)
  } finally {
    refreshLock = false
  }
}

async function backfillYears() {
  const missing = await getAlbumsMissingYear()
  if (missing.length === 0) return
  console.log(`Backfilling release years for ${missing.length} albums via MusicBrainz...`)
  for (const { artist, album } of missing) {
    const year = await getReleaseYear(artist, album)
    if (year) {
      await updateReleaseYear(artist, album, year)
      const stat = state.stats.find(
        s => s.artist.toLowerCase() === artist.toLowerCase() &&
             s.album.toLowerCase() === album.toLowerCase()
      )
      if (stat) stat.releaseYear = year
    }
    // MusicBrainz rate limit handled inside getReleaseYear
  }
  console.log('Year backfill complete')
}

async function backfillImages() {
  const missing = await getAlbumsMissingImages()
  if (missing.length === 0) return
  console.log(`Backfilling images for ${missing.length} albums...`)
  for (const { artist, album } of missing) {
    const info = await getAlbumInfo(artist, album)
    if (info?.imageUrl) {
      await updateImageUrl(artist, album, info.imageUrl)
      // Update in-memory state so the proxy endpoint can serve it immediately
      const stat = state.stats.find(
        s => s.artist.toLowerCase() === artist.toLowerCase() &&
             s.album.toLowerCase() === album.toLowerCase()
      )
      if (stat) stat.imageUrl = info.imageUrl
    }
    await new Promise(r => setTimeout(r, 150))
  }
  console.log('Image backfill complete')
}

async function backfillSpotifyIds() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.log('Spotify credentials not set, skipping Spotify ID backfill')
    return
  }
  const missing = await getAlbumsMissingSpotifyId()
  if (missing.length === 0) return
  console.log(`Backfilling Spotify IDs for ${missing.length} albums...`)
  let found = 0
  for (const { artist, album } of missing) {
    const spotifyId = await spotifySearchAlbum(artist, album)
    if (spotifyId) {
      await updateSpotifyId(artist, album, spotifyId)
      const stat = state.stats.find(
        s => s.artist.toLowerCase() === artist.toLowerCase() &&
             s.album.toLowerCase() === album.toLowerCase()
      )
      if (stat) stat.spotifyId = spotifyId
      found++
    }
    // Spotify rate limit: ~30 req/sec, but let's be gentle
    await new Promise(r => setTimeout(r, 100))
  }
  console.log(`Spotify ID backfill complete — found ${found}/${missing.length}`)
}

async function boot() {
  // Init DB schema
  try {
    await initDb()
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

  // DB empty = first ever run, sync from Last.fm
  // DB stale = background re-sync (silent, data already shown)
  const stale = Date.now() - lastSync > SYNC_INTERVAL_MS
  if (!cached) {
    console.log('DB empty — first run, syncing from Last.fm...')
    doRefresh(true)
  } else if (stale) {
    console.log('Data stale, background syncing...')
    doRefresh(true)
  } else {
    // Backfill missing images, release years, and Spotify IDs in the background
    backfillImages()
    backfillYears()
    backfillSpotifyIds()
  }

  // Schedule periodic re-sync
  setInterval(() => doRefresh(), SYNC_INTERVAL_MS)
}

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
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), err => {
    if (err) res.status(500).send('Client not found')
  })
})

app.listen(PORT, () => {
  console.log(`Listening Log on port ${PORT}`)
  boot()
})
