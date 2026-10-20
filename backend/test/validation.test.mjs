import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isObjectId } from '../utils/common.js'
import { parseBounds, parseDateInput } from '../utils/dates.js'

test('valid date inputs parse and invalid bounds fail with 400', () => {
  assert.equal(parseDateInput('2026-10-20').toISOString().slice(0, 10), '2026-10-20')
  const bounds = parseBounds('2026-10-01', '2026-10-20')
  assert.ok(bounds.from < bounds.to)

  assert.throws(() => parseDateInput('not-a-date'), (err) => err.status === 400)
  assert.throws(() => parseBounds('not-a-date', '2026-10-20'), (err) => err.status === 400)
  assert.throws(() => parseBounds('2026-10-01', 'not-a-date'), (err) => err.status === 400)
})

test('object id validation rejects malformed path parameters', () => {
  assert.equal(isObjectId('6ad6dda3cd9a1a16fe23d5b5'), true)
  assert.equal(isObjectId('6AD6DDA3CD9A1A16FE23D5B5'), true)
  assert.equal(isObjectId('not-an-id'), false)
  assert.equal(isObjectId(''), false)
  assert.equal(isObjectId(undefined), false)
})
