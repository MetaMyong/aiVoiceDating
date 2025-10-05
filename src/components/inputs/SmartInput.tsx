import React, { useEffect, useImperativeHandle, useRef } from 'react'

export type SmartInputHandle = {
  commit: () => Promise<void>
  getValue: () => string
  setValue: (v: string) => void
}

export type SmartInputProps = {
  value: string
  onCommit: (value: string) => void | Promise<void>
  onDraftChange?: (value: string) => void
  debugLabel?: string
  placeholder?: string
  className?: string
  type?: string
  autoFocus?: boolean
  commitOnBlur?: boolean
  debounceMs?: number
  disabled?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  id?: string
  name?: string
}

const SmartInput = React.forwardRef<SmartInputHandle, SmartInputProps>(
  ({ value, onCommit, onDraftChange, debugLabel, placeholder, className, type = 'text', autoFocus, commitOnBlur = true, debounceMs, disabled, inputMode, id, name }, ref) => {
    const elRef = useRef<HTMLInputElement | null>(null)
    const draftRef = useRef<string>(value || '')
    const timerRef = useRef<number | null>(null)
    const label = debugLabel || ''
  const log = (...args: any[]) => { try { if (typeof window !== 'undefined' && (window as any).__SMART_DEBUG) { console.log('[SmartInput]', ...args) } } catch {} }

    useEffect(() => {
      const el = elRef.current
      if (!el) return
      if (document.activeElement !== el) {
        el.value = value ?? ''
        draftRef.current = value ?? ''
  // sync external value
      }
    }, [value])

    const flushNow = async (reason: string) => {
      if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null }
      const v = draftRef.current ?? ''
      log('flush start', { reason, vLen: (v||'').length, id: (elRef.current as any)?.id })
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
      <input
        ref={elRef}
        id={id}
        name={name}
        className={className}
        placeholder={placeholder}
        defaultValue={value ?? ''}
        type={type}
        disabled={disabled}
        inputMode={inputMode}
  onFocus={() => { log('focus', { id: (elRef.current as any)?.id }) }}
  onChange={(e) => { draftRef.current = e.target.value; try{ onDraftChange?.(draftRef.current) }catch{}; schedule() }}
        onBlur={commitOnBlur ? (e: React.FocusEvent<HTMLInputElement>) => { 
          log('blur:start', { id: (elRef.current as any)?.id })
          const isInteractive = (el: any) => !!el && (
            el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.isContentEditable
          )
          const to = (e.relatedTarget as HTMLElement)
          const settle = (attempt: number) => {
            const ae = (document.activeElement as any)
            if (attempt < 3 && isInteractive(ae)) {
              requestAnimationFrame(() => settle(attempt + 1))
            } else {
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

SmartInput.displayName = 'SmartInput'

export default SmartInput
