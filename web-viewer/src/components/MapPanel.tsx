import { useEffect, useMemo } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, ScaleControl, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import chroma from 'chroma-js'
import gcoord from 'gcoord'
import type { LatLngExpression, LatLngTuple } from 'leaflet'
import type { TrackPoint } from '../lib/track'
import { decimate } from '../lib/track'

export type Basemap = 'amap' | 'amap-sat' | 'osm'
export type ColorBy = 'speed' | 'hdop' | 'sats'

interface Props {
  points: TrackPoint[]
  fitKey: string          // changes when new files are loaded -> refit the view
  basemap: Basemap
  colorBy: ColorBy
  showHalo: boolean
  cursor: number | null
  follow: boolean         // keep the playhead in view during replay
  onCursorChange: (index: number | null) => void
}

const MAX_DOTS = 2000
const MAX_HALOS = 400

const BASEMAPS: Record<Basemap, { url: string; attribution: string; subdomains: string[]; gcj: boolean }> = {
  amap: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '高德地图',
    gcj: true,
  },
  'amap-sat': {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '高德卫星影像',
    gcj: true,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: [],
    attribution: '© OpenStreetMap',
    gcj: false,
  },
}

const SCALES: Record<ColorBy, chroma.Scale> = {
  speed: chroma.scale(['#5b6b82', '#2f8f9d', '#3faa6d', '#d9a520', '#d2542f']).domain([0, 4, 12, 25, 45]),
  hdop: chroma.scale(['#2f8f9d', '#3faa6d', '#d9a520', '#c0392b']).domain([0.8, 2, 4, 8]),
  sats: chroma.scale(['#c0392b', '#d9a520', '#3faa6d', '#2f8f9d']).domain([3, 5, 8, 11]),
}

export function colorFor(value: number, colorBy: ColorBy): string {
  return SCALES[colorBy](value).hex()
}

function valueOf(point: TrackPoint, colorBy: ColorBy): number {
  return colorBy === 'hdop' ? point.hdop : colorBy === 'sats' ? point.sats : point.speed
}

/** Only shown until a file is loaded, then fitBounds takes over. */
const START_VIEW: LatLngTuple = [39.9087, 116.3975]

export function MapPanel({ points, fitKey, basemap, colorBy, showHalo, cursor, follow, onCursorChange }: Props) {
  const gcj = BASEMAPS[basemap].gcj
  const line = useMemo<LatLngTuple[]>(
    () => points.map((p) => project(p, gcj)),
    [points, gcj],
  )
  const dots = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / MAX_DOTS))
    const picked: { at: LatLngTuple; color: string; index: number }[] = []
    for (let i = 0; i < points.length; i += step) {
      picked.push({ at: project(points[i], gcj), color: colorFor(valueOf(points[i], colorBy), colorBy), index: i })
    }
    return picked
  }, [points, gcj, colorBy])
  const halos = useMemo(
    () => (showHalo ? decimate(points, MAX_HALOS).map((p) => ({ at: project(p, gcj), hdop: p.hdop })) : []),
    [points, gcj, showHalo],
  )

  const spec = BASEMAPS[basemap]

  return (
    <MapContainer className="map" preferCanvas center={START_VIEW} zoom={11} zoomControl>
      <TileLayer key={basemap} url={spec.url} subdomains={spec.subdomains} attribution={spec.attribution} maxZoom={19} />
      <ScaleControl imperial={false} />
      <ResizeWatcher />
      <FitBounds positions={line} fitKey={`${fitKey}|${basemap}`} />

      {halos.map((h, i) => (
        <Circle
          key={`halo-${i}`}
          center={h.at}
          radius={Math.max(3, h.hdop * 5)}
          pathOptions={{ stroke: false, fillColor: colorFor(h.hdop, 'hdop'), fillOpacity: 0.09 }}
          interactive={false}
        />
      ))}

      <Polyline
        positions={line}
        pathOptions={{ color: '#28405a', weight: 2, opacity: cursor === null ? 0.55 : 0.18 }}
        interactive={false}
      />
      {cursor !== null && (
        <Polyline
          positions={line.slice(0, cursor + 1)}
          pathOptions={{ color: '#28405a', weight: 2.5, opacity: 0.75 }}
          interactive={false}
        />
      )}

      {dots
        .filter((d) => cursor === null || d.index <= cursor)
        .map((d) => (
          <CircleMarker
            key={d.index}
            center={d.at}
            radius={3.2}
            pathOptions={{ stroke: false, fillColor: d.color, fillOpacity: 0.95 }}
            eventHandlers={{ click: () => onCursorChange(d.index) }}
          />
        ))}

      {points.length > 0 && (
        <>
          <Marker position={project(points[0], gcj)} icon={endpointIcon('起', '#1d6f6a')} interactive={false} />
          <Marker position={project(points[points.length - 1], gcj)} icon={endpointIcon('止', '#b0442b')} interactive={false} />
        </>
      )}

      {cursor !== null && points[cursor] && follow && <PanTo at={project(points[cursor], gcj)} />}

      {cursor !== null && points[cursor] && (
        <CircleMarker
          center={project(points[cursor], gcj)}
          radius={8}
          pathOptions={{ color: '#f0a202', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }}
          interactive={false}
        />
      )}
    </MapContainer>
  )
}

function project(p: { lat: number; lon: number }, gcj: boolean): LatLngTuple {
  if (!gcj) return [p.lat, p.lon]
  const [lon, lat] = gcoord.transform([p.lon, p.lat], gcoord.WGS84, gcoord.GCJ02) as [number, number]
  return [lat, lon]
}

function endpointIcon(label: string, color: string) {
  return L.divIcon({
    className: 'endpoint',
    html: `<span style="--endpoint:${color}">${label}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

/** The map may be created before the layout settles; keep Leaflet's size in sync. */
function ResizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  return null
}

function PanTo({ at }: { at: LatLngTuple }) {
  const map = useMap()
  useEffect(() => {
    if (!map.getBounds().pad(-0.2).contains(at)) map.panTo(at, { animate: true, duration: 0.4 })
  }, [at, map])
  return null
}

function FitBounds({ positions, fitKey }: { positions: LatLngExpression[]; fitKey: string }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length === 0) return
    map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 18 })
    // Only refit when a different track (or projection) is loaded, not on every filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])
  return null
}
