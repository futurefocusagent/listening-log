import { Pool } from 'pg'
import { AlbumStat } from './lastfm'

// Render internal URLs use the short hostname (no domain); external ones have oregon-postgres.render.com
const isInternal = process.env.DATABASE_URL?.match(/@dpg-[^.]+\//) !== null
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isInternal ? false : { rejectUnauthorized: false },
})

export async function initDb() {
  await pool.query(`
    ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS image_url TEXT;
  `).catch(() => {}) // ignore if already exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_stats (
      id SERIAL PRIMARY KEY,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      total_tracks INT NOT NULL DEFAULT 0,
      listened_tracks TEXT[] NOT NULL DEFAULT '{}',
      listened_count INT NOT NULL DEFAULT 0,
      percentage INT NOT NULL DEFAULT 0,
      complete BOOLEAN NOT NULL DEFAULT FALSE,
      image_url TEXT,
      UNIQUE(artist, album)
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  console.log('DB initialized')
}

export async function saveStats(stats: AlbumStat[], totalTracks: number) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('TRUNCATE album_stats')
    for (const s of stats) {
      await client.query(
        `INSERT INTO album_stats
          (artist, album, total_tracks, listened_tracks, listened_count, percentage, complete, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (artist, album) DO UPDATE SET
          total_tracks = EXCLUDED.total_tracks,
          listened_tracks = EXCLUDED.listened_tracks,
          listened_count = EXCLUDED.listened_count,
          percentage = EXCLUDED.percentage,
          complete = EXCLUDED.complete,
          image_url = COALESCE(EXCLUDED.image_url, album_stats.image_url)`,
        [s.artist, s.album, s.totalTracks, s.listenedTracks, s.listenedCount, s.percentage, s.complete, s.imageUrl ?? null]
      )
    }
    await client.query(
      `INSERT INTO sync_meta (key, value) VALUES ('last_sync', $1), ('total_tracks', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [new Date().toISOString(), String(totalTracks)]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function loadStats(): Promise<{
  stats: AlbumStat[]
  totalTracks: number
  fetchedAt: string | null
} | null> {
  const [statsResult, metaResult] = await Promise.all([
    pool.query<{
      artist: string; album: string; total_tracks: number;
      listened_tracks: string[]; listened_count: number;
      percentage: number; complete: boolean; image_url: string | null
    }>(`SELECT * FROM album_stats ORDER BY complete ASC, percentage DESC`),
    pool.query<{ key: string; value: string }>(`SELECT * FROM sync_meta`)
  ])

  if (statsResult.rows.length === 0) return null

  const meta = Object.fromEntries(metaResult.rows.map(r => [r.key, r.value]))
  return {
    stats: statsResult.rows.map(r => ({
      artist: r.artist,
      album: r.album,
      totalTracks: r.total_tracks,
      listenedTracks: r.listened_tracks,
      listenedCount: r.listened_count,
      percentage: r.percentage,
      complete: r.complete,
      imageUrl: r.image_url ?? undefined,
    })),
    totalTracks: parseInt(meta.total_tracks || '0', 10),
    fetchedAt: meta.last_sync || null,
  }
}
