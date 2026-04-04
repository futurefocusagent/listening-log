import 'dotenv/config'
import express from 'express'
import path from 'path'
import { getAllTracks, getAlbumInfo, AlbumStat } from './lastfm'
import { initDb, saveStats, loadStats } from './db'

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

      state.stats.push(stat)
      state.stats.sort((a, b) => {
        if (a.complete !== b.complete) return a.complete ? 1 : -1
        if (!a.totalTracks && b.totalTracks) return 1
        if (!b.totalTracks && a.totalTracks) return -1
        return b.percentage - a.percentage
      })
    }

    // Persist to DB
    await saveStats(state.stats, state.totalTracks)
    lastSync = Date.now()
    state.status = 'done'
    state.fetchedAt = new Date().toISOString()
    state.progress = ''
    console.log('Sync complete —', state.stats.length, 'albums saved to DB')
  } catch (err) {
    state.status = 'error'
    state.progress = String(err)
    console.error('Sync error:', err)
  } finally {
    refreshLock = false
  }
}

async function boot() {
  // Init DB schema
  try {
    await initDb()
  } catch (err) {
    console.error('DB init failed:', err)
  }

  // Load cached data from DB immediately (instant response on wake)
  let cached = null
  try {
    cached = await loadStats()
  } catch (err) {
    console.error('DB load failed, will sync from Last.fm:', err)
  }

  if (cached) {
    state.stats = cached.stats
    state.totalTracks = cached.totalTracks
    state.fetchedAt = cached.fetchedAt
    state.status = 'done'
    lastSync = cached.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0
    console.log(`Loaded ${state.stats.length} albums from DB (cached ${cached.fetchedAt})`)
  }

  // Sync in background if stale or empty — always silent if we have data
  const stale = Date.now() - lastSync > SYNC_INTERVAL_MS
  if (!cached || stale) {
    console.log(cached ? 'Cache stale, background syncing...' : 'No cache, syncing from Last.fm...')
    doRefresh(true)
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
