import type { Track, TrackPoint } from './track'

/**
 * Demo data for trying the viewer out. Everything is generated: a random loop of
 * 5–7 legs walked and cycled at 1 Hz, with a couple of signal dropouts.
 *
 * The start is a random point near one of these public city landmarks, so the
 * track always lands somewhere with streets on the map — never a real recorded
 * position, never the middle of the sea.
 */
const LANDMARKS = [
  { name: '北京 天安门', lat: 39.9087, lon: 116.3975 },
  { name: '上海 人民广场', lat: 31.2304, lon: 121.4737 },
  { name: '广州 珠江新城', lat: 23.1200, lon: 113.3240 },
  { name: '深圳 市民中心', lat: 22.5460, lon: 114.0570 },
  { name: '成都 天府广场', lat: 30.6570, lon: 104.0660 },
  { name: '西安 钟楼', lat: 34.2610, lon: 108.9470 },
  { name: '杭州 西湖', lat: 30.2590, lon: 120.1490 },
  { name: '武汉 黄鹤楼', lat: 30.5450, lon: 114.3020 },
  { name: '南京 新街口', lat: 32.0420, lon: 118.7780 },
  { name: '青岛 五四广场', lat: 36.0630, lon: 120.3840 },
]

const START_JITTER_M = 1500   // stay inside the same neighbourhood
const WALK_KMH = [4.5, 6.5]
const RIDE_KMH = [12, 20]

export function makeSampleTrack(): Track {
  const spot = pick(LANDMARKS)
  const mPerDegLat = 111320
  const mPerDegLon = mPerDegLat * Math.cos((spot.lat * Math.PI) / 180)
  const origin = {
    lat: spot.lat + between(-START_JITTER_M, START_JITTER_M) / mPerDegLat,
    lon: spot.lon + between(-START_JITTER_M, START_JITTER_M) / mPerDegLon,
  }

  // A closed loop of corners around the start, in metres
  const legs = Math.round(between(5, 7))
  const corners: [number, number][] = []
  for (let i = 0; i < legs; i++) {
    const angle = (i / legs) * 2 * Math.PI + between(-0.25, 0.25)
    const radius = between(280, 780)
    corners.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  corners.push(corners[0])

  // Mix walking and cycling legs, and make sure both actually show up
  const modes = corners.slice(1).map(() => (Math.random() < 0.45 ? 'walk' : 'ride'))
  if (modes.every((m) => m === modes[0])) {
    modes[Math.floor(Math.random() * modes.length)] = modes[0] === 'walk' ? 'ride' : 'walk'
  }
  const legSpeeds = modes.map((mode) => {
    const [lo, hi] = mode === 'walk' ? WALK_KMH : RIDE_KMH
    return between(lo, hi)
  })

  const points: TrackPoint[] = []
  let clock = Date.now() - 45 * 60 * 1000   // finish around now
  const dropouts = [between(3, 8) * 60, between(12, 25) * 60].map((start) => [start, start + between(30, 120)])
  let elapsed = 0

  for (let leg = 0; leg < corners.length - 1; leg++) {
    const [x0, y0] = corners[leg]
    const [x1, y1] = corners[leg + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const legMeters = Math.hypot(dx, dy)
    const heading = (450 - (Math.atan2(dy, dx) * 180) / Math.PI) % 360
    const openSky = legSpeeds[leg] > 10   // faster legs are the wide roads

    for (let travelled = 0; travelled < legMeters; ) {
      // slow down near the corners, wobble the rest of the time
      const toCorner = Math.min(travelled, legMeters - travelled)
      const speed = Math.max(0.4, legSpeeds[leg] * (toCorner < 25 ? 0.35 : 1) * between(0.9, 1.1))
      travelled += (speed * 1000) / 3600
      clock += 1000
      elapsed += 1
      if (dropouts.some(([from, to]) => elapsed >= from && elapsed < to)) continue

      const f = travelled / legMeters
      const x = x0 + dx * f + between(-1.6, 1.6)
      const y = y0 + dy * f + between(-1.6, 1.6)
      const hdop = Math.round(Math.max(0.7, (openSky ? 0.9 : 1.9) + between(-0.3, 0.9)) * 10) / 10
      points.push({
        time: new Date(clock),
        lat: origin.lat + y / mPerDegLat,
        lon: origin.lon + x / mPerDegLon,
        alt: 40 + Math.sin(f * Math.PI) * 6 + between(-1, 1),
        speed,
        course: (heading + between(-6, 6) + 360) % 360,
        sats: Math.round(openSky ? between(9, 13) : between(6, 10)),
        hdop,
        fix: hdop < 3 ? '3D' : '2D',
      })
    }
  }

  return { name: `示例轨迹（${spot.name}附近，模拟数据）`, points, skipped: 0 }
}

function between(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}
