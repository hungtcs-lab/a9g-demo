import Papa from 'papaparse'
import { parseISO } from 'date-fns'
import { getPathLength } from 'geolib'
import { max, median } from 'd3-array'

export interface TrackPoint {
  time: Date
  lat: number
  lon: number
  alt: number
  speed: number      // km/h
  course: number     // degrees
  sats: number
  hdop: number
  fix: string        // "2D" | "3D" | ...
}

export interface Track {
  name: string
  points: TrackPoint[]
  skipped: number         // rows that could not be parsed
}

interface CsvRow {
  utc: string
  lat: string
  lon: string
  alt_m: string
  speed_kmh: string
  course_deg: string
  sats: string
  hdop: string
  fix: string
}

export function parseCsv(text: string, name: string): Track {
  const { data, meta } = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })
  const fields = meta.fields ?? []
  for (const required of ['utc', 'lat', 'lon']) {
    if (!fields.includes(required)) {
      throw new Error(`${name}：缺少 ${required} 列，确认这是 gpslogger 生成的 CSV`)
    }
  }

  const points: TrackPoint[] = []
  let skipped = 0

  for (const row of data) {
    const time = parseISO(row.utc)
    const lat = Number(row.lat)
    const lon = Number(row.lon)
    if (Number.isNaN(time.getTime()) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped++
      continue
    }
    points.push({
      time,
      lat,
      lon,
      alt: num(row.alt_m),
      speed: num(row.speed_kmh),
      course: num(row.course_deg),
      sats: num(row.sats),
      hdop: num(row.hdop),
      fix: row.fix?.trim() || '—',
    })
  }
  points.sort((a, b) => a.time.getTime() - b.time.getTime())
  return { name, points, skipped }
}

function num(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export interface TrackStats {
  count: number
  from: Date
  to: Date
  loggedS: number      // seconds actually covered by samples
  gaps: number
  longestGapS: number
  distanceM: number
  maxSpeed: number
  medianSats: number
  medianHdop: number
  spreadM: number      // how far the points scatter around the median position
  fix3d: number
}

/** A jump longer than this counts as a dropout rather than a normal 1 Hz sample. */
const GAP_S = 5

export function computeStats(points: TrackPoint[]): TrackStats | null {
  if (points.length === 0) return null

  let gaps = 0
  let longestGap = 0
  let logged = 0
  let distance = 0
  let run: TrackPoint[] = [points[0]]

  const flushRun = () => {
    if (run.length > 1) distance += getPathLength(run.map((p) => ({ latitude: p.lat, longitude: p.lon })))
    run = []
  }

  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].time.getTime() - points[i - 1].time.getTime()) / 1000
    if (dt > GAP_S) {
      gaps++
      longestGap = Math.max(longestGap, dt)
      flushRun()
    } else {
      logged += dt
    }
    run.push(points[i])
  }
  flushRun()

  const centre = { latitude: median(points, (p) => p.lat) ?? 0, longitude: median(points, (p) => p.lon) ?? 0 }
  const spread = max(points, (p) => getPathLength([centre, { latitude: p.lat, longitude: p.lon }])) ?? 0

  return {
    count: points.length,
    from: points[0].time,
    to: points[points.length - 1].time,
    loggedS: logged,
    gaps,
    longestGapS: longestGap,
    distanceM: distance,
    maxSpeed: max(points, (p) => p.speed) ?? 0,
    medianSats: median(points, (p) => p.sats) ?? 0,
    medianHdop: median(points, (p) => p.hdop) ?? 0,
    spreadM: spread,
    fix3d: points.filter((p) => p.fix === '3D').length,
  }
}

/** Keep at most `max` points, evenly spaced, always including the last one. */
export function decimate<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  const step = items.length / limit
  const out: T[] = []
  for (let i = 0; i < limit; i++) out.push(items[Math.floor(i * step)])
  out[out.length - 1] = items[items.length - 1]
  return out
}
