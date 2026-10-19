import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalMediaUrl, deleteStagedMedia, resolveUploadedMedia } from '../utils/blob.js'

test('canonical media URLs stay same-origin and encode the pathname', () => {
  assert.equal(
    canonicalMediaUrl('bpin/tmp/user/photo one.jpg'),
    '/api/files?path=bpin%2Ftmp%2Fuser%2Fphoto%20one.jpg',
  )
})

test('media from another user is rejected before any Blob lookup', async () => {
  await assert.rejects(
    resolveUploadedMedia(
      [{ pathname: 'bpin/tmp/another-user/image-test.jpg', kind: 'image' }],
      { userId: 'current-user', kind: 'image', maxCount: 4 },
    ),
    /Invalid uploaded media path/,
  )

  await assert.rejects(
    deleteStagedMedia('bpin/tmp/another-user/image-test.jpg', 'current-user'),
    /Invalid uploaded media path/,
  )
})

test('too many media items are rejected', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ pathname: `bpin/tmp/current-user/image-${i}.jpg` }))
  await assert.rejects(
    resolveUploadedMedia(items, { userId: 'current-user', kind: 'image', maxCount: 4 }),
    /at most 4/,
  )
})
