import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

const SIZES = {
  sm: { height: 32, font: 12 },
  md: { height: 38, font: 13 },
  lg: { height: 44, font: 14 },
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function RubberSegment({
  items = [],
  value,
  defaultValue,
  onChange,
  trackColor,
  thumbColor,
  textColor,
  activeTextColor,
  size = 'md',
  radius = 12,
  inset = 3,
  equalSlots = true,
  stretch = 100,
  squash = 3,
  speed = 1,
  glide = 75,
  draggable = true,
  preset,
  disabled = false,
  className = '',
  ariaLabel = 'Options',
}) {
  const reducedMotion = useReducedMotion()
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const visualRef = useRef({ x: 0, width: 0 })
  const suppressClickRef = useRef(false)
  const [trackWidth, setTrackWidth] = useState(0)
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [drag, setDrag] = useState(null)

  const options = items.map((item) =>
    typeof item === 'string'
      ? { value: item, label: item }
      : { value: item.value ?? item.label, label: item.label ?? String(item.value ?? '') },
  )

  const selected = value !== undefined ? value : internalValue
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  )
  const metrics = SIZES[size] || SIZES.md
  const slotWidth = trackWidth > inset * 2 ? (trackWidth - inset * 2) / Math.max(1, options.length) : 0
  const baseX = inset + selectedIndex * slotWidth

  useLayoutEffect(() => {
    const element = trackRef.current
    if (!element) return
    const measure = () => setTrackWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const select = (index) => {
    const next = options[clamp(index, 0, options.length - 1)]
    if (!next || disabled) return
    if (value === undefined) setInternalValue(next.value)
    onChange?.(next.value, options.indexOf(next))
  }

  const onPointerDown = (event) => {
    if (disabled || !draggable || options.length < 2 || !slotWidth) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = {
      startX: event.clientX,
      moved: false,
      captured: false,
      pointerId: event.pointerId,
    }
    visualRef.current = { x: baseX, width: slotWidth }
    suppressClickRef.current = false
    setDrag({ x: baseX, width: slotWidth })
  }

  const onPointerMove = (event) => {
    const state = dragRef.current
    if (!state) return

    const deltaX = event.clientX - state.startX
    if (Math.abs(deltaX) > 4 && !state.moved) {
      state.moved = true
      state.captured = true
      suppressClickRef.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    const maxX = inset + Math.max(0, options.length - 1) * slotWidth
    const x = clamp(baseX + deltaX, inset, maxX)
    const direction = deltaX >= 0 ? 1 : -1
    const stretchLimit = slotWidth * Math.min(0.3, 0.1 + Math.max(0, Number(stretch) || 0) / 1000)
    const extra = state.moved ? Math.min(stretchLimit, Math.abs(deltaX) * 0.12 + squash) : 0
    const width = Math.min(slotWidth + extra, slotWidth * 1.3)
    const visual = {
      x: direction > 0 ? x : x - extra,
      width,
    }

    visualRef.current = visual
    setDrag(visual)
  }

  const finishDrag = (event, cancelled = false) => {
    if (!dragRef.current) return
    const state = dragRef.current
    dragRef.current = null
    setDrag(null)

    if (!cancelled && state.moved) {
      const center = visualRef.current.x + visualRef.current.width / 2
      const index = Math.round((center - inset - slotWidth / 2) / slotWidth)
      select(index)
      setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    } else {
      suppressClickRef.current = false
    }

    if (state.captured && event?.pointerId !== undefined) {
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      } catch {
        // capture may already be gone (pointer cancel / browser gesture)
      }
    }
  }

  const onKeyDown = (event) => {
    if (disabled || options.length === 0) return
    let next = selectedIndex
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next -= 1
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next += 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    else return
    event.preventDefault()
    select(clamp(next, 0, options.length - 1))
  }

  const spring = reducedMotion || drag
    ? { duration: 0 }
    : {
        type: 'spring',
        stiffness: 520 * Math.max(0.2, Number(speed) || 1),
        damping: Math.max(18, 34 * (Number(glide) || 75) / 75),
        mass: 0.8,
      }

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={ariaLabel}
      data-equal-slots={equalSlots ? 'true' : 'false'}
      data-preset={preset || undefined}
      className={`relative inline-flex w-full select-none items-center overflow-hidden border border-zinc-200/80 bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800 ${
        disabled ? 'opacity-50' : ''
      } ${className}`}
      style={{
        height: metrics.height,
        borderRadius: radius,
        touchAction: 'pan-y',
        backgroundColor: trackColor || undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onPointerLeave={() => {
        if (dragRef.current && !dragRef.current.moved) finishDrag(null, true)
      }}
      onKeyDown={onKeyDown}
    >
      {slotWidth > 0 ? (
        <motion.span
          aria-hidden="true"
          className="segment-thumb absolute left-0 z-0 shadow-[0_1px_2px_rgba(0,0,0,0.14)] ring-1 ring-black/5"
          style={{
            top: inset,
            bottom: inset,
            borderRadius: Math.max(0, radius - inset),
            backgroundColor: thumbColor || undefined,
          }}
          initial={false}
          animate={{
            x: drag ? drag.x : baseX,
            width: drag ? drag.width : slotWidth,
          }}
          transition={spring}
        />
      ) : null}

      {options.map((option, index) => {
        const active = index === selectedIndex
        const color = active ? activeTextColor || '#18181b' : textColor || undefined
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => {
              if (suppressClickRef.current) return
              select(index)
            }}
            className={`relative z-10 flex h-full min-w-0 flex-1 items-center justify-center px-2 font-medium transition-colors duration-200 ${
              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
            } ${!textColor && !active ? 'text-zinc-500 dark:text-zinc-400' : ''}`}
            style={{ fontSize: metrics.font, color }}
          >
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
