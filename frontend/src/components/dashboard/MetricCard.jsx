import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { DeltaPill, Sparkline } from './Charts.jsx'
import { formatDecimal, formatNumber } from '../../utils/periods.js'

export function MetricCard({ label, value, delta, icon: Icon, spark, decimals = 0, delay = 0 }) {
  const reducedMotion = useReducedMotion()
  const [display, setDisplay] = useState(0)
  const previousRef = useRef(0)

  useEffect(() => {
    const from = previousRef.current
    const to = Number(value) || 0
    if (reducedMotion) {
      previousRef.current = to
      setDisplay(to)
      return
    }

    let frame
    const startedAt = performance.now()
    const duration = 620
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (to - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else previousRef.current = to
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, reducedMotion])

  const valueLabel = decimals > 0 ? formatDecimal(display, decimals) : formatNumber(Math.round(display))

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reducedMotion ? 0 : delay, ease: 'easeOut' }}
      className="card group relative overflow-hidden p-4"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-70" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-zinc-500">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-zinc-100 text-zinc-500 transition group-hover:bg-accent/10 group-hover:text-accent dark:bg-zinc-800">
          <Icon size={15} />
        </span>
      </div>
      <p className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-zinc-900 dark:text-zinc-100">
        {valueLabel}
      </p>
      <div className="mt-3 flex items-end justify-between gap-2">
        <DeltaPill delta={delta} />
        {spark?.length > 1 ? (
          <div className="h-9 w-24 opacity-80">
            <Sparkline data={spark} />
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}

export default MetricCard
