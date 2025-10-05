import React, { useEffect, useImperativeHandle, useRef } from 'react'

export type SmartTextareaHandle = {
  commit: () => Promise<void>
  getValue: () => string
  setValue: (v: string) => void
}

export type SmartTextareaProps = {
  value: string
  onCommit: (value: string) => void | Promise<void>
  onDraftChange?: (value: string) => void
  debugLabel?: string
  placeholder?: string
  className?: string
  rows?: number
  autoFocus?: boolean
  commitOnBlur?: boolean
  debounceMs?: number
  disabled?: boolean
  id?: string
  name?: string
}

// Uncontrolled textarea that stores draft in a ref to avoid re-renders.
// Commits on blur or when commit() is called, with optional debounce.
const SmartTextarea = React.forwardRef<SmartTextareaHandle, SmartTextareaProps>(
  ({ value, onCommit, onDraftChange, debugLabel, placeholder, className, rows = 6, autoFocus, commitOnBlur = true, debounceMs, disabled, id, name }, ref) => {
    const elRef = useRef<HTMLTextAreaElement | null>(null)
    const draftRef = useRef<string>(value || '')
    const timerRef = useRef<number | null>(null)
    const label = debugLabel || ''
  const log = (...args: any[]) => { try { if (typeof window !== 'undefined' && (window as any).__SMART_DEBUG) { console.log('[SmartTextarea]', ...args) } } catch {} }

    // Keep external value in sync when not focused
    useEffect(() => {
      const el = elRef.current
      if (!el) return
      if (document.activeElement !== el) {
        el.value = value ?? ''
        draftRef.current = value ?? ''
        log('sync external value', { valueLen: (value||'').length })
      }
    }, [value])

    const flushNow = async (reason: string) => {
      if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null }
      const v = draftRef.current ?? ''
  log('flush start', { reason, vLen: v?.length, id: (elRef.current as any)?.id, active: (document.activeElement as any)?.tagName })
      await onCommit(v)
  log('flush end', { reason, id: (elRef.current as any)?.id })
    }

    const schedule = () => {
      if (!debounceMs) return
      if (timerRef.current) window.clearTimeout(timerRef.current)
  log('schedule debounce', { debounceMs, id: (elRef.current as any)?.id })
      timerRef.current = window.setTimeout(() => { flushNow('debounce') }, debounceMs) as any
    }

    useImperativeHandle(ref, () => ({
      commit: async () => { await flushNow('manual') },
      getValue: () => draftRef.current ?? '',
      setValue: (v: string) => {
        draftRef.current = v ?? ''
        const el = elRef.current
        if (el && document.activeElement !== el) el.value = v ?? ''
      }
    }), [])

    useEffect(() => {
  // mount
  return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
    }, [])

    return (
      <textarea
        ref={elRef}
        id={id}
        name={name}
        className={className}
        placeholder={placeholder}
        defaultValue={value ?? ''}
        rows={rows}
        disabled={disabled}
  onFocus={() => { log('focus', { id: (elRef.current as any)?.id }) }}
  onChange={(e) => { draftRef.current = e.target.value; try{ onDraftChange?.(draftRef.current) }catch{}; schedule() }}
        onBlur={commitOnBlur ? (e: React.FocusEvent<HTMLTextAreaElement>) => { 
          log('blur:start', { id: (elRef.current as any)?.id })
          const isInteractive = (el: any) => !!el && (
            el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.isContentEditable
          )
          const to = (e.relatedTarget as HTMLElement)
          // blur start
          const settle = (attempt: number) => {
            const ae = (document.activeElement as any)
            if (attempt < 3 && isInteractive(ae)) {
              requestAnimationFrame(() => settle(attempt + 1))
            } else {
              // Give the next focus target one more tick to fully mount before committing
              setTimeout(() => { flushNow('blur') }, 0)
            }
          }
          requestAnimationFrame(() => settle(1))
        } : undefined}
        autoFocus={autoFocus}
      />
    )
  }
)

SmartTextarea.displayName = 'SmartTextarea'

export default SmartTextarea
