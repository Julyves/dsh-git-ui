/**
 * IDEA 式时间格式化：不足 60 分钟「x 分钟前」、今天「今天 HH:mm」、
 * 昨天「昨天 HH:mm」、其余「Y/M/D HH:mm」。纯函数，可单元测试。
 */

/** 本地化标签由调用方注入（组件侧经字典提供）。 */
export interface TimeLabels {
  readonly minutesAgo: (n: number) => string
  readonly today: string
  readonly yesterday: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 日历日键（本地时区），用于今天/昨天判定。 */
function dayKey(x: Date): string {
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
}

export function formatWhen(iso: string, now: number, labels: TimeLabels): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  const d = new Date(then)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const seconds = Math.floor((now - then) / 1000)
  if (seconds >= 0 && seconds < 3600) {
    return labels.minutesAgo(Math.max(1, Math.floor(seconds / 60)))
  }
  if (dayKey(d) === dayKey(new Date(now))) return `${labels.today} ${hm}`
  if (dayKey(d) === dayKey(new Date(now - 86_400_000))) return `${labels.yesterday} ${hm}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`
}
