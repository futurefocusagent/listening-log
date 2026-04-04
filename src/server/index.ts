import express from 'express'
import path from 'path'
import { getAllTracks, getAlbumInfo, AlbumStat } from './lastfm'

const app = express()
const PORT = process.env.PORT || 3000
const LASTFM_USER = process.env.LASTFM_USER || 'boytunewonder'

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

async function doRefresh() {
  if (refreshLock) return
  refreshLock = true
  try {
    state.status = 'fetching-tracks'
    state.stats = []
    state.progress = 'Fetching scrobbles...'
    console.log('Fetching tracks for', LASTFM_USER)

    const yearsBack = 10
    const fromTs = Math.floor(Date.now() / 1000) - yearsBack * 365 * 24 * 60 * 60
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
    console.log(`${albumEntries.length} unique albums, fetching track counts...`)
    state.status = 'fetching-albums'

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
        }
      }

      // Insert sorted: incomplete by % desc, then complete
      state.stats.push(stat)
      state.stats.sort((a, b) => {
        if (a.complete !== b.complete) return a.complete ? 1 : -1
        if (!a.totalTracks && b.totalTracks) return 1
        if (!b.totalTracks && a.totalTracks) return -1
        return b.percentage - a.percentage
      })
    }

    state.status = 'done'
    state.fetchedAt = new Date().toISOString()
    state.progress = ''
    console.log('Done!')
  } catch (err) {
    state.status = 'error'
    state.progress = String(err)
    console.error('Error:', err)
  } finally {
    refreshLock = false
  }
}

// Start on boot
doRefresh()

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

app.post('/api/refresh', (_req, res) => {
  if (!refreshLock) doRefresh()
  res.json({ ok: true })
})

const clientDist = path.join(__dirname, '../client')
app.use(express.static(clientDist))
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Listening Log server on port ${PORT}`)
})
