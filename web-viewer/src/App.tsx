import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon, AppShell, Badge, Button, Divider, Drawer, Group, Paper, ScrollArea,
  SegmentedControl, SimpleGrid, Slider, Stack, Switch, Text, Title, Tooltip,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { Dropzone, MIME_TYPES } from '@mantine/dropzone'
import { IconAdjustments, IconPlayerPause, IconPlayerPlay, IconRoute, IconUpload } from '@tabler/icons-react'
import { bisector } from 'd3-array'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { MapPanel, colorFor } from './components/MapPanel'
import type { Basemap, ColorBy } from './components/MapPanel'
import { fmtDistance, fmtDuration, fmtTime } from './lib/format'
import { computeStats, parseCsv } from './lib/track'
import type { Track, TrackPoint } from './lib/track'
import { makeSampleTrack } from './lib/sample'

/** Dropouts longer than this are skipped during replay instead of played out in real time. */
const GAP_SKIP_MS = 5000

const RAMPS: Record<ColorBy, { label: string; stops: { at: number; text: string }[] }> = {
  speed: { label: '速度', stops: [{ at: 0, text: '0' }, { at: 12, text: '12' }, { at: 25, text: '25' }, { at: 45, text: '45 km/h' }] },
  hdop: { label: 'HDOP', stops: [{ at: 0.8, text: '0.8' }, { at: 2, text: '2' }, { at: 4, text: '4' }, { at: 8, text: '8 差' }] },
  sats: { label: '卫星数', stops: [{ at: 3, text: '3' }, { at: 5, text: '5' }, { at: 8, text: '8' }, { at: 11, text: '11 颗' }] },
}

const SPEEDS = [1, 10, 60, 300]

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState<string | null>(null)
  const [minSats, setMinSats] = useState(0)
  const [maxHdop, setMaxHdop] = useState(50)
  const [only3d, setOnly3d] = useState(false)
  const [colorBy, setColorBy] = useState<ColorBy>('speed')
  const [basemap, setBasemap] = useState<Basemap>('amap')
  const [showHalo, setShowHalo] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const [panelOpen, panel] = useDisclosure(false)
  const compact = useMediaQuery('(max-width: 62em)') ?? false
  const cursorRef = useRef<number | null>(null)
  cursorRef.current = cursor

  const allPoints = useMemo(() => {
    const merged = tracks.flatMap((t) => t.points)
    merged.sort((a, b) => a.time.getTime() - b.time.getTime())
    return merged
  }, [tracks])

  const points = useMemo(
    () => allPoints.filter((p) => p.sats >= minSats && p.hdop <= maxHdop && (!only3d || p.fix === '3D')),
    [allPoints, minSats, maxHdop, only3d],
  )
  const stats = useMemo(() => computeStats(points), [points])
  const hasData = allPoints.length > 0
  const filtered = hasData && points.length === 0
  const filtersActive = minSats > 0 || maxHdop < 50 || only3d
  const fitKey = tracks.map((t) => `${t.name}:${t.points.length}`).join('|')

  // Replay: walk a playhead along the recorded timestamps, skipping dropouts
  useEffect(() => {
    if (!playing || points.length === 0) return
    const at = bisector((p: TrackPoint) => p.time.getTime()).left
    let playhead = points[Math.min(cursorRef.current ?? 0, points.length - 1)].time.getTime()
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      playhead += (now - last) * speed
      last = now
      const index = at(points, playhead)
      if (index >= points.length) {
        setCursor(points.length - 1)
        setPlaying(false)
        return
      }
      if (points[index].time.getTime() - playhead > GAP_SKIP_MS) playhead = points[index].time.getTime()
      setCursor(index)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, points])

  async function loadFiles(files: File[]) {
    const parsed: Track[] = []
    const problems: string[] = []
    for (const file of files) {
      try {
        parsed.push(parseCsv(await file.text(), file.name))
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
    }
    setError(problems.join('；') || null)
    if (parsed.length) {
      setTracks(parsed)
      setCursor(null)
      setPlaying(false)
    }
  }

  function loadSample() {
    setTracks([makeSampleTrack()])
    setCursor(null)
    setPlaying(false)
    setError(null)
  }

  function resetFilters() {
    setMinSats(0)
    setMaxHdop(50)
    setOnly3d(false)
  }

  function togglePlay() {
    if (points.length === 0) return
    if (cursor !== null && cursor >= points.length - 1) setCursor(0)
    setPlaying(!playing)
  }

  const controls = (
    <Stack gap="lg" p="md">
      <Stack gap="xs">
        <Dropzone
          onDrop={(files) => void loadFiles(files)}
          accept={[MIME_TYPES.csv, 'text/plain']}
          multiple
          radius="md"
          p="md"
        >
          <Group gap="sm" justify="center" style={{ pointerEvents: 'none' }}>
            <IconUpload size={20} stroke={1.6} />
            <div>
              <Text size="sm">把 CSV 拖进来，或点击选择</Text>
              <Text size="xs" c="dimmed">TF 卡 /gps 目录，一天一个文件，可多选</Text>
            </div>
          </Group>
        </Dropzone>
        <Group gap="xs">
          <Button variant="default" size="xs" leftSection={<IconRoute size={14} />} onClick={loadSample}>
            示例轨迹
          </Button>
          {tracks.map((t) => (
            <Badge key={t.name} variant="light" color="gray" size="sm">
              {t.name} · {t.points.length.toLocaleString()}
            </Badge>
          ))}
        </Group>
        {error && <Text size="xs" c="red">{error}</Text>}
      </Stack>

      {hasData && (
        <>
          <Divider />
          {stats ? (
            <>
          <SimpleGrid cols={3} spacing="sm" verticalSpacing="md">
            <Metric label="记录点" value={stats.count.toLocaleString()} />
            <Metric label="时长" value={fmtDuration(stats.loggedS)} />
            <Metric label="里程" value={fmtDistance(stats.distanceM)} />
            <Metric label="最高速度" value={`${stats.maxSpeed.toFixed(1)} km/h`} />
            <Metric label="卫星中位数" value={String(stats.medianSats)} />
            <Metric label="HDOP 中位数" value={stats.medianHdop.toFixed(1)} />
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt={-8}>
            {fmtTime(stats.from)} 起，{stats.gaps} 处断点
            {stats.gaps > 0 && `，最长 ${fmtDuration(stats.longestGapS)}`}；3D 定位{' '}
            {Math.round((stats.fix3d / stats.count) * 100)}%，散布约 {fmtDistance(stats.spreadM)}。
          </Text>
            </>
          ) : (
            <Text size="sm" c="dimmed">当前筛选条件没有保留任何点。</Text>
          )}

          <Divider label="筛选" labelPosition="left" />
          <Stack gap="md">
            <Field label="卫星数不少于" value={minSats === 0 ? '不限' : `${minSats} 颗`}>
              <Slider min={0} max={12} step={1} value={minSats} onChange={setMinSats} label={null} />
            </Field>
            <Field label="HDOP 不大于" value={maxHdop >= 50 ? '不限' : String(maxHdop)}>
              <Slider min={1} max={50} step={1} value={maxHdop} onChange={setMaxHdop} label={null} />
            </Field>
            <Switch
              size="sm"
              label="只看 3D 定位"
              checked={only3d}
              onChange={(e) => setOnly3d(e.currentTarget.checked)}
            />
            <Group justify="space-between" gap="xs">
              <Text size="xs" c={filtered ? 'red' : 'dimmed'}>
                保留 {points.length.toLocaleString()} / {allPoints.length.toLocaleString()} 点
              </Text>
              {filtersActive && (
                <Button variant="subtle" size="compact-xs" onClick={resetFilters}>
                  重置筛选
                </Button>
              )}
            </Group>
          </Stack>

          <Divider label="显示" labelPosition="left" />
          <Stack gap="sm">
            <Field label="打点颜色">
              <SegmentedControl
                fullWidth
                size="xs"
                value={colorBy}
                onChange={(v) => setColorBy(v as ColorBy)}
                data={[
                  { value: 'speed', label: '速度' },
                  { value: 'hdop', label: 'HDOP' },
                  { value: 'sats', label: '卫星数' },
                ]}
              />
            </Field>
            <Field label="底图">
              <SegmentedControl
                fullWidth
                size="xs"
                value={basemap}
                onChange={(v) => setBasemap(v as Basemap)}
                data={[
                  { value: 'amap', label: '高德' },
                  { value: 'amap-sat', label: '卫星' },
                  { value: 'osm', label: 'OSM' },
                ]}
              />
            </Field>
            <Switch
              size="sm"
              label="画出精度范围"
              checked={showHalo}
              onChange={(e) => setShowHalo(e.currentTarget.checked)}
            />
          </Stack>

          <Divider label="回放" labelPosition="left" />
          <Stack gap="sm" style={{ opacity: filtered ? 0.5 : 1, pointerEvents: filtered ? 'none' : undefined }}>
            <Group gap="sm" wrap="nowrap">
              <ActionIcon size="lg" variant="filled" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
                {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
              </ActionIcon>
              <SegmentedControl
                size="xs"
                value={String(speed)}
                onChange={(v) => setSpeed(Number(v))}
                data={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
              />
            </Group>
            <Slider
              min={0}
              max={Math.max(0, points.length - 1)}
              value={cursor ?? 0}
              onChange={(v) => {
                setPlaying(false)
                setCursor(v)
              }}
              label={null}
            />
            {cursor !== null && points[cursor] ? (
              <PointReadout point={points[cursor]} index={cursor} total={points.length} />
            ) : (
              <Text size="xs" c="dimmed">按播放沿时间走一遍，或拖动滑块、点地图上的点。</Text>
            )}
          </Stack>
        </>
      )}
    </Stack>
  )

  const emptyState = filtered ? (
    <Stack className="stage" align="center" justify="center" gap="xs" p="xl">
      <Title order={2} fw={600} fz="h3">筛选后没有点了</Title>
      <Text c="dimmed" ta="center" maw="40ch">
        {allPoints.length.toLocaleString()} 个点都被条件挡住了。放宽卫星数或 HDOP，数据还在。
      </Text>
      <Button mt="sm" onClick={resetFilters}>重置筛选</Button>
    </Stack>
  ) : (
    <Stack className="stage" align="center" justify="center" gap="xs" p="xl">
      <Title order={2} fw={600}>打开一天的轨迹</Title>
      <Text c="dimmed" ta="center" maw="40ch">
        选择 TF 卡 /gps 目录里的 CSV，例如 20260912.csv。也可以一次选多天，会按时间接起来。
      </Text>
      <Group mt="sm">
        <Button variant="default" onClick={loadSample} leftSection={<IconRoute size={16} />}>
          先看示例轨迹
        </Button>
        {compact && <Button onClick={panel.open} leftSection={<IconUpload size={16} />}>选择文件</Button>}
      </Group>
    </Stack>
  )

  const map =
    points.length > 0 ? (
      <div className="stage">
        <MapPanel
          points={points}
          fitKey={fitKey}
          basemap={basemap}
          colorBy={colorBy}
          showHalo={showHalo}
          cursor={cursor}
          follow={playing}
          onCursorChange={(i) => {
            setPlaying(false)
            setCursor(i)
          }}
        />
        <Legend colorBy={colorBy} />
        {basemap !== 'osm' && (
          <Paper className="crs" withBorder p={6} px={10} radius="sm">
            <Text size="xs" c="dimmed">坐标已按 GCJ-02 纠偏</Text>
          </Paper>
        )}
      </div>
    ) : (
      emptyState
    )

  if (compact) {
    return (
      <div className="shell shell--compact">
        {map}
        <Paper className="dock" withBorder radius={0} p="xs">
          <Group gap="sm" wrap="nowrap">
            <ActionIcon size="lg" variant="filled" onClick={togglePlay} disabled={points.length === 0}
              aria-label={playing ? '暂停' : '播放'}>
              {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
            </ActionIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" c="dimmed" truncate>
                {cursor !== null && points[cursor]
                  ? `${fmtTime(points[cursor].time)} · ${points[cursor].speed.toFixed(1)} km/h`
                  : stats
                    ? `${stats.count.toLocaleString()} 点 · ${fmtDistance(stats.distanceM)}`
                    : filtered
                      ? '筛选后没有点，点右侧调整'
                      : '还没有数据'}
              </Text>
              <Slider
                size="xs"
                mt={2}
                min={0}
                max={Math.max(0, points.length - 1)}
                value={cursor ?? 0}
                onChange={(v) => {
                  setPlaying(false)
                  setCursor(v)
                }}
                label={null}
                disabled={points.length === 0}
              />
            </div>
            <Tooltip label="数据与设置">
              <ActionIcon size="lg" variant="default" onClick={panel.open} aria-label="数据与设置">
                <IconAdjustments size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Paper>
        <Drawer
          opened={panelOpen}
          onClose={panel.close}
          position="bottom"
          size="82%"
          zIndex={1000}
          title="A9G 轨迹"
          padding={0}
          styles={{
            header: { paddingInline: 'var(--mantine-spacing-md)' },
            content: { height: '82dvh', display: 'flex', flexDirection: 'column' },
            body: { flex: 1, minHeight: 0, overflowY: 'auto' },
          }}
        >
          {controls}
        </Drawer>
      </div>
    )
  }

  return (
    <AppShell navbar={{ width: 360, breakpoint: 0 }} padding={0}>
      <AppShell.Navbar>
        <AppShell.Section p="md" pb="sm">
          <Title order={1} fz="h3" fw={600}>A9G 轨迹</Title>
          <Text size="xs" c="dimmed" mt={4}>
            打开 gpslogger 记在 TF 卡上的 CSV，看走过的路线和当时的定位质量。
          </Text>
        </AppShell.Section>
        <Divider />
        <AppShell.Section grow component={ScrollArea}>{controls}</AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>{map}</AppShell.Main>
    </AppShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text fz="lg" fw={600} className="num" lh={1.2}>{value}</Text>
      <Text size="xs" c="dimmed">{label}</Text>
    </div>
  )
}

function Field({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div>
      <Group justify="space-between" gap="xs" mb={6}>
        <Text size="sm" c="dimmed">{label}</Text>
        {value && <Text size="sm" fw={500} className="num">{value}</Text>}
      </Group>
      {children}
    </div>
  )
}

function PointReadout({ point, index, total }: { point: TrackPoint; index: number; total: number }) {
  const rows: [string, string][] = [
    ['时间', fmtTime(point.time)],
    ['坐标', `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`],
    ['速度', `${point.speed.toFixed(1)} km/h`],
    ['海拔', `${point.alt.toFixed(0)} m`],
    ['卫星 / HDOP', `${point.sats} 颗 / ${point.hdop.toFixed(1)}`],
    ['定位', point.fix],
    ['序号', `${(index + 1).toLocaleString()} / ${total.toLocaleString()}`],
  ]
  return (
    <Stack gap={4}>
      {rows.map(([label, value]) => (
        <Group key={label} justify="space-between" gap="md" wrap="nowrap">
          <Text size="sm" c="dimmed">{label}</Text>
          <Text size="sm" className="num" ta="right">{value}</Text>
        </Group>
      ))}
    </Stack>
  )
}

function Legend({ colorBy }: { colorBy: ColorBy }) {
  const ramp = RAMPS[colorBy]
  return (
    <Paper className="legend" withBorder p="xs" px="sm" radius="sm">
      <Text size="xs" c="dimmed" mb={4}>{ramp.label}</Text>
      <Group gap="sm">
        {ramp.stops.map((s) => (
          <Group key={s.text} gap={5} wrap="nowrap">
            <span className="legend__swatch" style={{ background: colorFor(s.at, colorBy) }} />
            <Text size="xs">{s.text}</Text>
          </Group>
        ))}
      </Group>
    </Paper>
  )
}
