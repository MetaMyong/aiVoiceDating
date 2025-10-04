import React from 'react'

type IconProps = { className?: string; strokeWidth?: number } & React.SVGProps<SVGSVGElement>

export const IconDownload: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/>
  </svg>
)

export const IconUpload: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M12 21V9m0 0l4 4m-4-4L8 13M4 3h16"/>
  </svg>
)

export const IconTrash: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 6V4h6v2m-8 0l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"/>
  </svg>
)

export const IconCamera: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M4 8h3l2-3h6l2 3h3a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 012-2z"/>
    <circle cx="12" cy="14" r="4" strokeWidth={strokeWidth} />
  </svg>
)

export const IconMic: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <rect x="9" y="2" width="6" height="12" rx="3" strokeWidth={strokeWidth} />
    <path strokeWidth={strokeWidth} strokeLinecap="round" d="M5 12a7 7 0 0014 0M12 19v3"/>
  </svg>
)

export const IconVolume: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinejoin="round" d="M4 10v4h4l6 5V5l-6 5H4z"/>
    <path strokeWidth={strokeWidth} strokeLinecap="round" d="M18 9a3 3 0 010 6M20 7a5 5 0 010 10"/>
  </svg>
)

export const IconRobot: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <rect x="4" y="7" width="16" height="12" rx="3" strokeWidth={strokeWidth} />
    <circle cx="9" cy="13" r="1.5" />
    <circle cx="15" cy="13" r="1.5" />
    <path strokeWidth={strokeWidth} strokeLinecap="round" d="M12 3v4"/>
  </svg>
)

export const IconCog: React.FC<IconProps> = ({ className = 'w-5 h-5', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.66 2l-1.73-3-2.6.6a7.9 7.9 0 00-1.5-.9L14 3h-4l-.83 3.7a7.9 7.9 0 00-1.5.9l-2.6-.6-1.73 3 2.1 1.5a7.7 7.7 0 000 1.8L2.74 14l1.73 3 2.6-.6c.47.35.97.65 1.5.9L10 21h4l.83-3.7c.53-.25 1.03-.55 1.5-.9l2.6.6 1.73-3-2.1-1.5c.07-.6.07-1.2 0-1.8L20.66 10z"/>
  </svg>
)

export const IconUser: React.FC<IconProps> = ({ className = 'w-16 h-16', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <circle cx="12" cy="8" r="4" strokeWidth={strokeWidth} />
    <path strokeWidth={strokeWidth} strokeLinecap="round" d="M4 20a8 8 0 0116 0"/>
  </svg>
)

export const IconSparkles: React.FC<IconProps> = ({ className = 'w-4 h-4', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17z"/>
  </svg>
)

export const IconNote: React.FC<IconProps> = ({ className = 'w-4 h-4', strokeWidth = 1.8, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} {...rest}>
    <path strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" d="M4 4h12l4 4v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/>
    <path strokeWidth={strokeWidth} d="M8 12h8M8 16h8M8 8h6"/>
  </svg>
)
