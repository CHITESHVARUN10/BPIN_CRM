import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import RubberSegment from './RubberSegment.jsx'
import {
  MONTHS,
  MONTHS_SHORT,
  WEEKDAYS_MON,
  calendarDays,
  inRange,
  isCurrentPeriod,
  normalizeAnchor,
  periodLabel,
  rangeForMode,
  sameDay,
  shiftAnchor,
  startOfDay,
  startOfMonth,
} from '../utils/periods.js'

const ITEMS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

function CalendarPanel({ mode, anchor, onSelect }) {
  const [cursor, setCursor] = useState(() => startOfMonth(anchor))
  const days = useMemo(() => calendarDays(cursor), [cursor])
  const selected = rangeForMode(mode === 'week' ? 'week' : 'day', anchor)
  const today = startOfDay(new Date())

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Previous month"
        >
          <ChevronLeft size={15} />
        </button>
        <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </p>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Next month"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS_MON.map((weekday) => (
          <span key={weekday} className="py-1 text-center text-[10px] font-medium text-zinc-400">
            {weekday}
          </span>
        ))}
        {days.map((entry) => {
          const active = mode === 'week' ? inRange(entry.date, selected.from, selected.to) : sameDay(entry.date, anchor)
          const isAnchor = sameDay(entry.date, anchor)
          const future = entry.date.getTime() > today.getTime()
          return (
            <button
              key={entry.date.toISOString()}
              type="button"
              disabled={future}
              onClick={() => onSelect(entry.date)}
              className={`relative grid h-8 place-items-center rounded-lg text-[12px] transition ${
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              } ${!entry.inMonth ? 'opacity-35' : ''} ${
                isAnchor ? 'bg-accent font-semibold text-white hover:bg-accent' : ''
              } ${future ? 'cursor-not-allowed opacity-20' : ''}`}
              aria-label={entry.date.toDateString()}
              aria-pressed={active}
            >
              {entry.date.getDate()}
              {entry.isToday && !isAnchor ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent" /> : null}
            </button>
          )
        })}
      </div>
      {mode === 'week' ? (
        <p className="mt-2 text-center text-[10px] text-zinc-400">Pick any day to jump to that week</p>
      ) : null}
    </div>
  )
}

function MonthPanel({ anchor, onSelect }) {
  const [year, setYear] = useState(anchor.getFullYear())
  const today = new Date()

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          onClick={() => setYear((value) => value - 1)}
          className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Previous year"
        >
          <ChevronLeft size={15} />
        </button>
        <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">{year}</p>
        <button
          type="button"
          disabled={year >= today.getFullYear()}
          onClick={() => setYear((value) => value + 1)}
          className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-zinc-800"
          aria-label="Next year"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS_SHORT.map((month, index) => {
          const active = year === anchor.getFullYear() && index === anchor.getMonth()
          const current = year === today.getFullYear() && index === today.getMonth()
          const future = year > today.getFullYear() || (year === today.getFullYear() && index > today.getMonth())
          return (
            <button
              key={month}
              type="button"
              disabled={future}
              onClick={() => onSelect(new Date(year, index, 1))}
              className={`relative rounded-lg py-2 text-[12px] font-medium transition ${
                active
                  ? 'bg-accent text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              } ${future ? 'cursor-not-allowed opacity-25' : ''}`}
              aria-pressed={active}
            >
              {month}
              {current && !active ? <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function YearPanel({ anchor, onSelect }) {
  const today = new Date()
  const currentYear = today.getFullYear()
  const [start, setStart] = useState(() => Math.floor(anchor.getFullYear() / 12) * 12)
  const years = Array.from({ length: 12 }, (_, index) => start + index)
  const nextDisabled = start + 12 > currentYear
  const prevDisabled = start <= 1900

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          disabled={prevDisabled}
          onClick={() => setStart((value) => value - 12)}
          className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          aria-label="Previous years"
        >
          <ChevronLeft size={15} />
        </button>
        <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          {start} – {start + 11}
        </p>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={() => setStart((value) => value + 12)}
          className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          aria-label="Next years"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {years.map((year) => {
          const active = year === anchor.getFullYear()
          const future = year > currentYear
          return (
            <button
              key={year}
              type="button"
              disabled={future}
              onClick={() => onSelect(new Date(year, 0, 1))}
              className={`relative rounded-lg py-2 text-[12px] font-medium tabular-nums transition ${
                active
                  ? 'bg-accent text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              } ${future ? 'cursor-not-allowed opacity-25' : ''}`}
              aria-pressed={active}
            >
              {year}
              {year === currentYear && !active ? (
                <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function PeriodPicker({ mode, anchor, onModeChange, onAnchorChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const current = isCurrentPeriod(mode, anchor)
  const range = rangeForMode(mode, anchor)
  const today = startOfDay(new Date())
  const nextDisabled = range.to.getTime() >= today.getTime()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const changeMode = (next) => {
    setOpen(false)
    onModeChange(next)
  }

  const navigate = (delta) => {
    setOpen(false)
    onAnchorChange(shiftAnchor(mode, anchor, delta))
  }

  const choose = (date) => {
    onAnchorChange(normalizeAnchor(mode, date))
    setOpen(false)
  }

  const goToday = () => {
    onAnchorChange(new Date())
    setOpen(false)
  }

  return (
    <div className={`card flex flex-col gap-2 p-1.5 sm:flex-row sm:items-center ${className}`}>
      <RubberSegment
        items={ITEMS}
        value={mode}
        onChange={changeMode}
        size="sm"
        radius={10}
        inset={3}
        squash={3}
        speed={1}
        glide={75}
        draggable
        ariaLabel="Dashboard period"
        className="sm:w-[280px]"
      />

      <div className="flex min-w-0 items-center gap-1 sm:ml-auto">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={`Previous ${mode}`}
        >
          <ChevronLeft size={16} />
        </button>

        <div ref={wrapRef} className="relative min-w-0 flex-1 sm:flex-none">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="flex min-h-[36px] w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:justify-start"
          >
            <CalendarDays size={14} className="shrink-0 text-zinc-400" />
            <span className="truncate">{periodLabel(mode, anchor)}</span>
            <ChevronDown size={13} className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {open ? (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                role="dialog"
                aria-label={`Choose a ${mode}`}
                className="fixed inset-x-3 bottom-3 z-[80] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[312px]"
              >
                {mode === 'day' || mode === 'week' ? (
                  <CalendarPanel mode={mode} anchor={anchor} onSelect={choose} />
                ) : mode === 'month' ? (
                  <MonthPanel anchor={anchor} onSelect={choose} />
                ) : (
                  <YearPanel anchor={anchor} onSelect={choose} />
                )}

                <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <span className="min-w-0 truncate text-[10px] text-zinc-400">{periodLabel(mode, anchor)}</span>
                  <button
                    type="button"
                    onClick={goToday}
                    className="shrink-0 text-[12px] font-medium text-accent transition hover:text-accent/80"
                  >
                    {mode === 'day' ? 'Today' : mode === 'week' ? 'This week' : mode === 'month' ? 'This month' : 'This year'}
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <button
          type="button"
          disabled={nextDisabled}
          onClick={() => navigate(1)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={`Next ${mode}`}
        >
          <ChevronRight size={16} />
        </button>

        {!current ? (
          <button
            type="button"
            onClick={goToday}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent/10"
          >
            Today
          </button>
        ) : null}
      </div>
    </div>
  )
}
