import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attachPreviousSeries,
  buildDaySeries,
  calendarDays,
  delta,
  eachDay,
  isoDate,
  isCurrentPeriod,
  periodLabel,
  previousRangeForMode,
  rangeForMode,
  shiftAnchor,
  startOfWeek,
  weekdayDistribution,
} from '../src/utils/periods.js'

const day = (y, m, d) => new Date(y, m - 1, d)

test('isoDate uses local calendar parts and never shifts a day', () => {
  assert.equal(isoDate(day(2026, 10, 31)), '2026-10-31')
  assert.equal(isoDate(day(2026, 1, 1)), '2026-01-01')
})

test('week runs Monday through Sunday', () => {
  const { from, to } = rangeForMode('week', day(2026, 10, 31))
  assert.equal(isoDate(from), '2026-10-26')
  assert.equal(isoDate(to), '2026-11-01')
  assert.equal(startOfWeek(day(2026, 11, 1)).getDay(), 1)
})

test('day, month and year ranges are closed intervals', () => {
  assert.deepEqual(
    Object.values(rangeForMode('day', day(2026, 10, 31))).map(isoDate),
    ['2026-10-31', '2026-10-31'],
  )
  assert.deepEqual(
    Object.values(rangeForMode('month', day(2026, 2, 14))).map(isoDate),
    ['2026-02-01', '2026-02-28'],
  )
  assert.deepEqual(
    Object.values(rangeForMode('year', day(2026, 6, 1))).map(isoDate),
    ['2026-01-01', '2026-12-31'],
  )
})

test('previous ranges move one period back', () => {
  assert.equal(isoDate(previousRangeForMode('day', day(2026, 10, 31)).from), '2026-10-30')
  assert.equal(isoDate(previousRangeForMode('week', day(2026, 10, 31)).from), '2026-10-19')
  assert.equal(isoDate(previousRangeForMode('month', day(2026, 1, 15)).from), '2025-12-01')
  assert.equal(isoDate(previousRangeForMode('year', day(2026, 6, 1)).from), '2025-01-01')
})

test('shiftAnchor moves by one unit and normalizes the anchor', () => {
  assert.equal(isoDate(shiftAnchor('day', day(2026, 10, 31), -1)), '2026-10-30')
  assert.equal(isoDate(shiftAnchor('week', day(2026, 10, 31), -1)), '2026-10-19')
  assert.equal(isoDate(shiftAnchor('month', day(2026, 1, 31), 1)), '2026-02-01')
  assert.equal(isoDate(shiftAnchor('year', day(2026, 10, 31), 1)), '2027-01-01')
})

test('buildDaySeries fills missing days with zero and matches DD/MM rows', () => {
  const series = buildDaySeries(
    [
      { _id: '26/10', count: 4 },
      { _id: '28/10', count: 2 },
    ],
    day(2026, 10, 26),
    day(2026, 10, 29),
    'week',
  )
  assert.deepEqual(
    series.map((point) => point.count),
    [4, 0, 2, 0],
  )
  assert.equal(series[0].axis, 'Mon 26')
  assert.equal(series[0].full, 'Monday, 26 October 2026')
})

test('attachPreviousSeries aligns by period index, not calendar date', () => {
  const series = buildDaySeries([{ _id: '26/10', count: 4 }], day(2026, 10, 26), day(2026, 10, 27), 'week')
  const compared = attachPreviousSeries(
    series,
    [{ _id: '19/10', count: 9 }],
    { from: day(2026, 10, 19), to: day(2026, 10, 20) },
  )
  assert.deepEqual(
    compared.map((point) => point.previous),
    [9, 0],
  )
})

test('calendarDays returns six Monday-first weeks', () => {
  const days = calendarDays(day(2026, 10, 1))
  assert.equal(days.length, 42)
  assert.equal(days[0].date.getDay(), 1)
  assert.equal(days.filter((entry) => entry.inMonth).length, 31)
})

test('weekdayDistribution aggregates by Monday-first weekday', () => {
  const series = buildDaySeries(
    [
      { _id: '26/10', count: 2 },
      { _id: '01/11', count: 3 },
    ],
    day(2026, 10, 26),
    day(2026, 11, 1),
  )
  const totals = weekdayDistribution(series)
  assert.equal(totals[0].label, 'Mon')
  assert.equal(totals[0].count, 2)
  assert.equal(totals[6].label, 'Sun')
  assert.equal(totals[6].count, 3)
})

test('delta handles growth, decline, flat and new series', () => {
  assert.equal(delta(12, 10).label, '+20%')
  assert.equal(delta(8, 10).label, '-20%')
  assert.equal(delta(10, 10).label, 'No change')
  assert.equal(delta(3, 0).label, 'New')
  assert.equal(delta(0, 0).label, 'No change')
})

test('eachDay is inclusive and period labels are human readable', () => {
  assert.equal(eachDay(day(2026, 10, 30), day(2026, 11, 1)).length, 3)
  assert.equal(periodLabel('month', day(2026, 10, 31)), 'October 2026')
  assert.equal(periodLabel('day', day(2026, 10, 31)), 'Sat 31 Oct 2026')
})

test('isCurrentPeriod recognizes the current day and rejects a past one', () => {
  assert.equal(isCurrentPeriod('day', new Date()), true)
  assert.equal(isCurrentPeriod('day', day(2020, 1, 1)), false)
})
