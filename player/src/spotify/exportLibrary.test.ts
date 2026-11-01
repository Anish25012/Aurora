import { describe, expect, it, vi } from 'vitest'
import type { Track } from './api'
import { exportSpotifyLibrary } from './exportLibrary'

const track = (id: string, isrc?: string): Track => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  artists: [{ id: 'a1', name: 'Massive Attack' }],
  album: {
    id: 'al1',
    name: 'Mezzanine',
    images: [
      { url: 'small', width: 64 },
      { url: 'big', width: 640 },
    ],
  },
  duration_ms: 200_000,
  explicit: false,
  external_urls: {},
  ...(isrc ? { external_ids: { isrc } } : {}),
})

function fakeApi() {
  return {
    likedSongs: vi.fn(async (offset: number) =>
      offset === 0
        ? { tracks: [track('t1', 'GBAAA9800001'), track('t2')], total: 3, nextOffset: 50 }
        : { tracks: [track('t3')], total: 3, nextOffset: null },
    ),
    me: vi.fn(async () => ({ id: 'me', display_name: 'Me' })),
    allMyPlaylists: vi.fn(async () => [
      { id: 'p1', uri: 'spotify:playlist:p1', name: 'Mine', description: null, images: null, owner: { id: 'me' } },
      { id: 'p2', uri: 'spotify:playlist:p2', name: 'Theirs', description: 'x', images: [], owner: { id: 'other' } },
    ]),
    playlistTracks: vi.fn(async (id: string) =>
      id === 'p1'
        ? { tracks: [track('t1'), track('t4')], total: 2, restricted: false, nextOffset: null }
        : { tracks: [], total: 0, restricted: true, nextOffset: null },
    ),
    allSavedAlbums: vi.fn(async () => [
      {
        id: 'al1',
        uri: 'spotify:album:al1',
        name: 'Mezzanine',
        images: [],
        release_date: '1998',
        album_type: 'album' as const,
        total_tracks: 1,
      },
    ]),
    getAlbum: vi.fn(async () => ({
      id: 'al1',
      uri: 'spotify:album:al1',
      name: 'Mezzanine',
      images: [{ url: 'cover', width: 640 }],
      release_date: '1998-04-20',
      album_type: 'album' as const,
      total_tracks: 1,
      artists: [{ id: 'a1', name: 'Massive Attack' }],
      tracks: [{ ...track('t1'), track_number: 4 }], // album listings carry no ISRC
    })),
    followedArtists: vi.fn(async () => [{ id: 'a1', uri: 'spotify:artist:a1', name: 'Massive Attack', images: [] }]),
  }
}

describe('exporting a Spotify library', () => {
  it('copies liked songs, playlists, albums and artists into Aurora’s own format', async () => {
    const progress = vi.fn()
    const lib = await exportSpotifyLibrary(fakeApi() as never, progress)

    expect(lib.liked.map((l) => l.trackId)).toEqual(['sp:t1', 'sp:t2', 'sp:t3']) // every page
    expect(lib.tracks['sp:t1']).toMatchObject({
      title: 'Song t1',
      artists: ['Massive Attack'],
      album: 'Mezzanine',
      imageUrl: 'big',
      trackNumber: 4, // from the album listing
      isrc: 'GBAAA9800001', // kept, though the album listing had none
    })
    expect(lib.playlists).toEqual([
      expect.objectContaining({ name: 'Mine', own: true, trackIds: ['sp:t1', 'sp:t4'], incomplete: false }),
      expect.objectContaining({ name: 'Theirs', own: false, trackIds: [], incomplete: true }),
    ])
    expect(lib.albums[0]).toMatchObject({ name: 'Mezzanine', releaseDate: '1998-04-20', trackIds: ['sp:t1'] })
    expect(lib.artists).toEqual([{ id: 'sp:a1', name: 'Massive Attack', imageUrl: null }])
    expect(Object.keys(lib.tracks).sort()).toEqual(['sp:t1', 'sp:t2', 'sp:t3', 'sp:t4'])
    expect(progress).toHaveBeenCalledWith('Liked songs: 3 of 3')
  })
})
