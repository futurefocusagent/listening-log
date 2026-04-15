import pg from 'pg'
import { AlbumStat } from './lastfm.js'
const { Pool } = pg

// Render internal URLs use the short hostname (no domain); external ones have oregon-postgres.render.com
const isInternal = process.env.DATABASE_URL?.match(/@dpg-[^.]+\//) !== null
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isInternal ? false : { rejectUnauthorized: false },
})

export async function initDb() {
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
      release_year INT,
      spotify_id TEXT,
      all_tracks TEXT[] NOT NULL DEFAULT '{}',
      tier TEXT CHECK (tier IN ('top', 'mid', 'low', 'hidden')),
      energy TEXT CHECK (energy IN ('ambient', 'moderate', 'intense')),
      UNIQUE(artist, album)
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS album_tags (
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (artist, album, tag_id)
    );
  `)
  // Ensure columns exist (for upgrades)
  await pool.query(`ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS image_url TEXT`)
  await pool.query(`ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS release_year INT`)
  await pool.query(`ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS spotify_id TEXT`)
  await pool.query(`ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS all_tracks TEXT[] NOT NULL DEFAULT '{}'`)
  await pool.query(`ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS tier TEXT`)
  // Update constraint to include 'hidden'
  await pool.query(`ALTER TABLE album_stats DROP CONSTRAINT IF EXISTS album_stats_tier_check`)
  await pool.query(`ALTER TABLE album_stats ADD CONSTRAINT album_stats_tier_check CHECK (tier IN ('top', 'mid', 'low', 'hidden', 'bookmarked'))`)
  await pool.query(`ALTER TABLE album_stats ADD COLUMN IF NOT EXISTS energy TEXT CHECK (energy IN ('ambient', 'moderate', 'intense'))`)
  console.log('DB initialized')
}

export async function saveStats(stats: AlbumStat[], totalTracks: number) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const s of stats) {
      await client.query(
        `INSERT INTO album_stats
          (artist, album, total_tracks, listened_tracks, all_tracks, listened_count, percentage, complete, image_url, release_year, spotify_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (artist, album) DO UPDATE SET
          total_tracks = EXCLUDED.total_tracks,
          listened_tracks = EXCLUDED.listened_tracks,
          all_tracks = EXCLUDED.all_tracks,
          listened_count = EXCLUDED.listened_count,
          percentage = EXCLUDED.percentage,
          complete = EXCLUDED.complete,
          image_url = COALESCE(EXCLUDED.image_url, album_stats.image_url),
          release_year = COALESCE(EXCLUDED.release_year, album_stats.release_year),
          spotify_id = COALESCE(EXCLUDED.spotify_id, album_stats.spotify_id)`,
        [s.artist, s.album, s.totalTracks, s.listenedTracks, s.allTracks ?? [], s.listenedCount, s.percentage, s.complete, s.imageUrl ?? null, s.releaseYear ?? null, s.spotifyId ?? null]
      )
    }
    // Remove albums no longer in the current sync
    const keys = stats.map(s => `${s.artist}|||${s.album}`)
    await client.query(
      `DELETE FROM album_stats WHERE (artist || '|||' || album) != ALL($1)`,
      [keys]
    )
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

export async function updateAlbumMetadata(
  artist: string, 
  album: string, 
  metadata: { spotifyId?: string; releaseYear?: number; imageUrl?: string; totalTracks?: number }
) {
  const sets: string[] = []
  const values: (string | number)[] = []
  let i = 1

  if (metadata.spotifyId !== undefined) {
    sets.push(`spotify_id = $${i++}`)
    values.push(metadata.spotifyId)
  }
  if (metadata.releaseYear !== undefined) {
    sets.push(`release_year = $${i++}`)
    values.push(metadata.releaseYear)
  }
  if (metadata.imageUrl !== undefined) {
    sets.push(`image_url = $${i++}`)
    values.push(metadata.imageUrl)
  }
  if (metadata.totalTracks !== undefined) {
    sets.push(`total_tracks = $${i++}`)
    values.push(metadata.totalTracks)
  }

  if (sets.length === 0) return

  values.push(artist, album)
  await pool.query(
    `UPDATE album_stats SET ${sets.join(', ')} WHERE artist = $${i++} AND album = $${i}`,
    values
  )
}

export async function getAlbumsMissingMetadata(limit = 100): Promise<Array<{ artist: string; album: string }>> {
  const result = await pool.query<{ artist: string; album: string }>(
    `SELECT artist, album FROM album_stats 
     WHERE spotify_id IS NULL OR release_year IS NULL OR image_url IS NULL
     ORDER BY artist LIMIT $1`,
    [limit]
  )
  return result.rows
}

export async function loadStats(): Promise<{
  stats: AlbumStat[]
  totalTracks: number
  fetchedAt: string | null
} | null> {
  const [statsResult, metaResult, tagsResult] = await Promise.all([
    pool.query<{
      artist: string; album: string; total_tracks: number;
      listened_tracks: string[]; listened_count: number;
      percentage: number; complete: boolean; image_url: string | null;
      release_year: number | null; spotify_id: string | null;
      tier: string | null; energy: string | null;
    }>(`SELECT * FROM album_stats ORDER BY complete ASC, percentage DESC`),
    pool.query<{ key: string; value: string }>(`SELECT * FROM sync_meta`),
    pool.query<{ artist: string; album: string; tag_name: string }>(
      `SELECT at.artist, at.album, t.name as tag_name 
       FROM album_tags at JOIN tags t ON at.tag_id = t.id`
    )
  ])

  if (statsResult.rows.length === 0) return null

  // Build a map of album -> tags
  const tagMap = new Map<string, string[]>()
  for (const row of tagsResult.rows) {
    const key = `${row.artist}|||${row.album}`
    if (!tagMap.has(key)) tagMap.set(key, [])
    tagMap.get(key)!.push(row.tag_name)
  }

  const meta = Object.fromEntries(metaResult.rows.map(r => [r.key, r.value]))
  return {
    stats: statsResult.rows.map(r => ({
      artist: r.artist,
      album: r.album,
      totalTracks: r.total_tracks,
      listenedTracks: r.listened_tracks,
      allTracks: (r as any).all_tracks ?? [],
      listenedCount: r.listened_count,
      percentage: r.percentage,
      complete: r.complete,
      imageUrl: r.image_url ?? undefined,
      releaseYear: r.release_year ?? undefined,
      spotifyId: r.spotify_id ?? undefined,
      tier: r.tier as 'top' | 'mid' | 'low' | 'hidden' | 'bookmarked' | undefined ?? undefined,
      energy: r.energy as 'ambient' | 'moderate' | 'intense' | undefined ?? undefined,
      tags: tagMap.get(`${r.artist}|||${r.album}`) ?? [],
    })),
    totalTracks: parseInt(meta.total_tracks || '0', 10),
    fetchedAt: meta.last_sync || null,
  }
}

// ==================== TAG MANAGEMENT ====================

export type Tag = { id: number; name: string; count: number }

export async function getAllTags(): Promise<Tag[]> {
  const result = await pool.query<{ id: number; name: string; count: string }>(
    `SELECT t.id, t.name, COUNT(at.tag_id)::text as count
     FROM tags t
     LEFT JOIN album_tags at ON t.id = at.tag_id
     GROUP BY t.id, t.name
     ORDER BY t.name`
  )
  return result.rows.map(r => ({ id: r.id, name: r.name, count: parseInt(r.count, 10) }))
}

export async function createTag(name: string): Promise<Tag> {
  const result = await pool.query<{ id: number; name: string }>(
    `INSERT INTO tags (name) VALUES ($1) RETURNING id, name`,
    [name.toLowerCase().trim()]
  )
  return { ...result.rows[0], count: 0 }
}

export async function renameTag(id: number, newName: string): Promise<void> {
  await pool.query(`UPDATE tags SET name = $1 WHERE id = $2`, [newName.toLowerCase().trim(), id])
}

export async function deleteTag(id: number): Promise<void> {
  await pool.query(`DELETE FROM tags WHERE id = $1`, [id])
}

export async function addTagToAlbum(artist: string, album: string, tagId: number): Promise<void> {
  await pool.query(
    `INSERT INTO album_tags (artist, album, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [artist, album, tagId]
  )
}

export async function removeTagFromAlbum(artist: string, album: string, tagId: number): Promise<void> {
  await pool.query(
    `DELETE FROM album_tags WHERE artist = $1 AND album = $2 AND tag_id = $3`,
    [artist, album, tagId]
  )
}

export async function getOrCreateTag(name: string): Promise<Tag> {
  const normalized = name.toLowerCase().trim()
  const existing = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM tags WHERE name = $1`, [normalized]
  )
  if (existing.rows.length > 0) {
    return { ...existing.rows[0], count: 0 }
  }
  return createTag(normalized)
}

// ==================== SETTINGS (key-value) ====================

export async function getSetting(key: string): Promise<string | null> {
  const result = await pool.query<{ value: string }>(
    `SELECT value FROM sync_meta WHERE key = $1`, [key]
  )
  return result.rows[0]?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO sync_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  )
}

// ==================== ALBUM CATEGORIZATION ====================

export async function updateAlbumCategorization(
  artist: string,
  album: string,
  data: { tier?: 'top' | 'mid' | 'low' | 'hidden' | 'bookmarked' | null; energy?: 'ambient' | 'moderate' | 'intense' | null }
): Promise<void> {
  const sets: string[] = []
  const values: (string | null)[] = []
  let i = 1

  if ('tier' in data) {
    sets.push(`tier = $${i++}`)
    values.push(data.tier ?? null)
  }
  if ('energy' in data) {
    sets.push(`energy = $${i++}`)
    values.push(data.energy ?? null)
  }

  if (sets.length === 0) return

  values.push(artist, album)
  await pool.query(
    `UPDATE album_stats SET ${sets.join(', ')} WHERE artist = $${i++} AND album = $${i}`,
    values
  )
}
