import { intervalToDuration } from 'date-fns'

/** GPS timestamps are UTC; the logger is used in China, so show Beijing time. */
export function fmtTime(time: Date): string {
  return time.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const { days = 0, hours = 0, minutes = 0 } = intervalToDuration({ start: 0, end: Math.round(seconds) * 1000 })
  const parts = [days && `${days} 天`, hours && `${hours} 时`, minutes && `${minutes} 分`]
  return parts.filter(Boolean).slice(0, 2).join(' ')
}

export function fmtDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(0)} m`
}
