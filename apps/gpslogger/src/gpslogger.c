/*
 * GPS logger: record GPS fixes to the TF card as CSV, one file per UTC day.
 *
 *   /t/gps/YYYYMMDD.csv   utc,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,fix
 *
 * UART1 (TX1/RX1, 115200 8N1) prints status and accepts commands (end with newline):
 *   status   print current state
 *   sim      toggle simulated NMEA input (tests TF logging without satellites; the
 *            fake date 2007-01-26 also exercises the rollover fix -> 20260911.csv)
 *
 * LEDs:
 *   IO27  toggles on every point written, blinking every second = TF card error
 *   IO28  solid = GPS fixed, blinking = GPS data but no fix, off = no GPS data
 */
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>

#include "api_os.h"
#include "api_debug.h"
#include "api_event.h"
#include "api_fs.h"
#include "api_gps.h"
#include "api_hal_gpio.h"
#include "api_hal_uart.h"
#include "gps.h"
#include "gps_parse.h"


#define MAIN_TASK_STACK_SIZE    (2048 * 4)
#define MAIN_TASK_PRIORITY      0
#define MAIN_TASK_NAME         "Main Task"

#define STATUS_TASK_STACK_SIZE  (2048 * 4)
#define STATUS_TASK_PRIORITY    1
#define STATUS_TASK_NAME       "Status Task"

#define LED_TF                  GPIO_PIN27
#define LED_GPS                 GPIO_PIN28

#define LOG_DIR                 "/t/gps"
#define LOG_HEADER              "utc,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,fix\r\n"
#define LOG_INTERVAL_S          1       // record one point every N seconds of GPS time
#define FLUSH_EVERY_POINTS      10      // at most this many points are lost on power cut

#define STATUS_INTERVAL_S       10
#define OPEN_FAIL_LOG_EVERY     60      // report a failing card open once per this many tries

static HANDLE mainTaskHandle = NULL;

static volatile uint32_t gpsBytes = 0;
static volatile bool simulate = false;
static bool tfError = false;

static int32_t logFd = -1;
static int logDate = -1;
static uint32_t openFailures = 0;   // consecutive failed opens, used to mute repeats
static char logPath[32];
static uint32_t pointsInFile = 0;
static uint32_t pointsTotal = 0;
static uint32_t pointsUnflushed = 0;
static int lastLoggedSecond = -1;
static char lastRow[128];

static GPIO_config_t ledTf = {
    .mode         = GPIO_MODE_OUTPUT,
    .pin          = LED_TF,
    .defaultLevel = GPIO_LEVEL_LOW
};
static GPIO_config_t ledGps = {
    .mode         = GPIO_MODE_OUTPUT,
    .pin          = LED_GPS,
    .defaultLevel = GPIO_LEVEL_LOW
};


static void Log(const char* fmt, ...)
{
    char buf[256];
    va_list args;

    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    Trace(1, "%s", buf);
    UART_Write(UART1, (uint8_t*)buf, strlen(buf));
    UART_Write(UART1, (uint8_t*)"\r\n", 2);
}

static void ToggleLed(GPIO_config_t* led)
{
    GPIO_LEVEL level;

    GPIO_GetLevel(*led, &level);
    GPIO_SetLevel(*led, level == GPIO_LEVEL_HIGH ? GPIO_LEVEL_LOW : GPIO_LEVEL_HIGH);
}

static double FloatOf(const struct minmea_float* f)
{
    return f->scale ? (double)f->value / f->scale : 0;
}

// ddmm.mmmm -> degree
static double NmeaToDegree(const struct minmea_float* f)
{
    int deg;

    if(f->scale == 0)
        return 0;
    deg = (int)(f->value / f->scale / 100);
    return deg + (double)(f->value - deg * f->scale * 100) / f->scale / 60.0;
}


/*
 * The GPS chip's firmware predates the 2019-04-06 GPS week rollover, so it reports
 * dates 1024 weeks (7168 days) in the past (2026 comes back as 2007). Time of day and
 * position are unaffected. Shift any pre-rollover date forward by one 1024-week epoch.
 */
#define ROLLOVER_DAYS       7168

// Howard Hinnant's civil calendar algorithms
static long DaysFromCivil(int y, int m, int d)
{
    long era;
    unsigned yoe, doy, doe;

    y -= m <= 2;
    era = (y >= 0 ? y : y - 399) / 400;
    yoe = (unsigned)(y - era * 400);
    doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097L + (long)doe - 719468L;
}

static void CivilFromDays(long z, int* y, int* m, int* d)
{
    long era, yr;
    unsigned doe, yoe, doy, mp, mm;

    z += 719468L;
    era = (z >= 0 ? z : z - 146096) / 146097;
    doe = (unsigned)(z - era * 146097);
    yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    yr = (long)yoe + era * 400;
    doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    mp = (5 * doy + 2) / 153;
    *d = (int)(doy - (153 * mp + 2) / 5 + 1);
    mm = mp + (mp < 10 ? 3 : -9);
    *m = (int)mm;
    *y = (int)(yr + (mm <= 2));
}

// Returns true when the date was shifted
static bool UnrollDate(int* year, int* month, int* day)
{
    long days = DaysFromCivil(*year, *month, *day);

    if(days >= DaysFromCivil(2019, 4, 6))
        return false;
    CivilFromDays(days + ROLLOVER_DAYS, year, month, day);
    return true;
}

static int FixType(const GPS_Info_t* gps)
{
    return gps->gsa[0].fix_type > gps->gsa[1].fix_type ? gps->gsa[0].fix_type : gps->gsa[1].fix_type;
}

static void CloseLogFile(void)
{
    if(logFd >= 0)
    {
        API_FS_Flush(logFd);
        API_FS_Close(logFd);
        logFd = -1;
    }
    pointsUnflushed = 0;
}

static bool OpenLogFile(int date)
{
    int64_t size;

    CloseLogFile();
    API_FS_Mkdir(LOG_DIR, 0);   // fails harmlessly when it already exists

    snprintf(logPath, sizeof(logPath), LOG_DIR "/%08d.csv", date);
    logFd = API_FS_Open(logPath, FS_O_WRONLY | FS_O_CREAT | FS_O_APPEND, 0);
    if(logFd < 0)
    {
        // One failed open per point would flood the log, so only report now and then
        if(openFailures % OPEN_FAIL_LOG_EVERY == 0)
            Log("[TF] open %s failed: %d%s (card inserted? it is only mounted at boot)",
                logPath, (int)logFd, openFailures ? ", still failing" : "");
        ++openFailures;
        tfError = true;
        return false;
    }
    if(openFailures)
    {
        Log("[TF] card back after %u failed opens", (unsigned)openFailures);
        openFailures = 0;
    }

    size = API_FS_GetFileSize(logFd);
    API_FS_Seek(logFd, 0, FS_SEEK_END);
    if(size <= 0)
        API_FS_Write(logFd, (uint8_t*)LOG_HEADER, strlen(LOG_HEADER));

    logDate = date;
    pointsInFile = 0;
    tfError = false;
    Log("[TF] logging to %s (existing size %d bytes)", logPath, (int)size);
    return true;
}

static void LogFix(const GPS_Info_t* gps)
{
    const struct minmea_sentence_rmc* rmc = &gps->rmc;
    static bool rolloverLogged = false;
    int year, month, day;
    int second;
    int date;
    int fixType;
    int32_t len;

    if(!rmc->valid || rmc->date.year < 0)
    {
        // Fix lost: don't leave points sitting in the write buffer
        if(logFd >= 0 && pointsUnflushed > 0)
        {
            API_FS_Flush(logFd);
            pointsUnflushed = 0;
        }
        return;
    }
    second = rmc->time.hours * 3600 + rmc->time.minutes * 60 + rmc->time.seconds;
    if(second == lastLoggedSecond || second % LOG_INTERVAL_S != 0)
        return;
    lastLoggedSecond = second;

    year = 2000 + rmc->date.year;
    month = rmc->date.month;
    day = rmc->date.day;
    if(UnrollDate(&year, &month, &day) && !rolloverLogged)
    {
        rolloverLogged = true;
        Log("[GPS] week rollover: chip says %04d-%02d-%02d, logging as %04d-%02d-%02d",
            2000 + rmc->date.year, rmc->date.month, rmc->date.day, year, month, day);
    }
    date = year * 10000 + month * 100 + day;
    if((date != logDate || logFd < 0) && !OpenLogFile(date))
        return;

    fixType = FixType(gps);
    len = snprintf(lastRow, sizeof(lastRow),
        "%04d-%02d-%02dT%02d:%02d:%02dZ,%.6f,%.6f,%.1f,%.1f,%.1f,%d,%.1f,%s\r\n",
        year, month, day,
        rmc->time.hours, rmc->time.minutes, rmc->time.seconds,
        NmeaToDegree(&rmc->latitude), NmeaToDegree(&rmc->longitude),
        FloatOf(&gps->gga.altitude), FloatOf(&rmc->speed) * 1.852, FloatOf(&rmc->course),
        gps->gga.satellites_tracked, FloatOf(&gps->gga.hdop),
        fixType == 3 ? "3D" : (fixType == 2 ? "2D" : "fix"));

    if(API_FS_Write(logFd, (uint8_t*)lastRow, len) != len)
    {
        Log("[TF] write %s failed", logPath);
        tfError = true;
        CloseLogFile();
        logDate = -1;
        return;
    }
    ++pointsInFile;
    ++pointsTotal;
    if(++pointsUnflushed >= FLUSH_EVERY_POINTS)
    {
        API_FS_Flush(logFd);
        pointsUnflushed = 0;
    }
    ToggleLed(&ledTf);
}

static void OnGpsData(uint8_t* data, uint32_t length)
{
    GPS_Update(data, length);
    LogFix(Gps_GetInfo());
}

// Append one NMEA sentence ("$<body>*<checksum>\r\n"), return its length
static int AppendNmea(char* out, int size, const char* fmt, ...)
{
    char body[100];
    uint8_t checksum = 0;
    va_list args;

    va_start(args, fmt);
    vsnprintf(body, sizeof(body), fmt, args);
    va_end(args);
    for(char* p = body; *p; ++p)
        checksum ^= (uint8_t)*p;
    return snprintf(out, size, "$%s*%02X\r\n", body, checksum);
}

// Fake a fixed position walking slowly north, dated 2007-01-26 (pre-rollover, like the real chip)
static void SimulateGps(uint32_t tick)
{
    char frame[400];
    int n = 0;
    int hh = (tick / 3600) % 24, mm = (tick / 60) % 60, ss = tick % 60;
    int latMin = 500000 + (tick * 3) % 90000;   // 50.0000' + 0.0003' per second

    n += AppendNmea(frame + n, sizeof(frame) - n, "GNRMC,%02d%02d%02d.000,A,31%02d.%04d,N,11716.0000,E,1.00,0.00,260107,,,A",
                    hh, mm, ss, latMin / 10000, latMin % 10000);
    n += AppendNmea(frame + n, sizeof(frame) - n, "GNGGA,%02d%02d%02d.000,31%02d.%04d,N,11716.0000,E,1,08,0.9,45.0,M,0.0,M,,",
                    hh, mm, ss, latMin / 10000, latMin % 10000);
    n += AppendNmea(frame + n, sizeof(frame) - n, "GNGSA,A,3,01,02,03,04,05,06,07,08,,,,,1.5,0.9,1.2");
    n += AppendNmea(frame + n, sizeof(frame) - n, "GNVTG,0.00,T,,M,1.00,N,1.85,K,A");
    OnGpsData((uint8_t*)frame, n);
}

static void PrintStatus(bool gpsAlive)
{
    const GPS_Info_t* gps = Gps_GetInfo();
    int fixType = FixType(gps);

    Log("[STAT] %sgps data:%s fix:%s in view:%d used:%d | tf:%s points:%u total:%u file:%s",
        simulate ? "SIMULATED " : "", gpsAlive ? "yes" : "NO",
        gps->rmc.valid ? (fixType == 3 ? "3D" : (fixType == 2 ? "2D" : "yes")) : "none",
        gps->gsv[0].total_sats, gps->gga.satellites_tracked,
        tfError ? "ERROR" : "ok", (unsigned)pointsInFile, (unsigned)pointsTotal,
        logFd >= 0 ? logPath : "-");
    if(pointsInFile > 0)
        Log("[STAT] last: %s", lastRow);
}

static void HandleCommand(const char* cmd)
{
    if(strcmp(cmd, "status") == 0)
        PrintStatus(true);
    else if(strcmp(cmd, "sim") == 0)
    {
        simulate = !simulate;
        Log("[CMD] simulation %s", simulate ? "ON" : "OFF");
    }
    else if(cmd[0])
        Log("[CMD] unknown command \"%s\", try: status, sim", cmd);
}

static void OnUart1Data(const uint8_t* data, uint32_t length)
{
    static char line[32];
    static uint32_t lineLen = 0;

    for(uint32_t i = 0; i < length; ++i)
    {
        char c = data[i];

        if(c == '\r' || c == '\n')
        {
            line[lineLen] = '\0';
            HandleCommand(line);
            lineLen = 0;
        }
        else if(lineLen < sizeof(line) - 1)
            line[lineLen++] = c;
    }
}

void StatusTask(void* pData)
{
    API_FS_INFO info;
    uint32_t lastBytes = 0;
    uint32_t tick = 0;
    uint32_t simTick = 0;

    // Let the system finish starting up
    OS_Sleep(3000);
    Log("===== GPS logger start, dir %s, every %ds =====", LOG_DIR, LOG_INTERVAL_S);

    if(API_FS_GetFSInfo(FS_DEVICE_NAME_T_FLASH, &info) < 0)
    {
        Log("[TF] no card, or card not mounted");
        tfError = true;
    }
    else
        Log("[TF] card mounted, used:%u KB", (unsigned)(info.usedSize / 1024));

    GPS_Init();
    if(!GPS_Open(NULL))
        Log("[GPS] open failed");

    while(1)
    {
        const GPS_Info_t* gps = Gps_GetInfo();
        bool gpsAlive = gpsBytes != lastBytes;

        lastBytes = gpsBytes;
        if(simulate)
        {
            SimulateGps(simTick++);
            gpsAlive = true;
        }

        if(gps->rmc.valid && gpsAlive)
            GPIO_SetLevel(ledGps, GPIO_LEVEL_HIGH);
        else if(gpsAlive)
            ToggleLed(&ledGps);
        else
            GPIO_SetLevel(ledGps, GPIO_LEVEL_LOW);

        if(tfError)
            ToggleLed(&ledTf);

        if(++tick % STATUS_INTERVAL_S == 0)
            PrintStatus(gpsAlive);
        OS_Sleep(1000);
    }
}

void EventDispatch(API_Event_t* pEvent)
{
    switch(pEvent->id)
    {
        case API_EVENT_ID_GPS_UART_RECEIVED:
            gpsBytes += pEvent->param1;
            if(!simulate)
                OnGpsData(pEvent->pParam1, pEvent->param1);
            break;
        case API_EVENT_ID_UART_RECEIVED:
            if(pEvent->param1 == UART1)
                OnUart1Data(pEvent->pParam1, pEvent->param2);
            break;
        default:
            break;
    }
}

void MainTask(void* pData)
{
    API_Event_t* event = NULL;
    UART_Config_t config = {
        .baudRate   = UART_BAUD_RATE_115200,
        .dataBits   = UART_DATA_BITS_8,
        .stopBits   = UART_STOP_BITS_1,
        .parity     = UART_PARITY_NONE,
        .rxCallback = NULL,
        .useEvent   = true
    };

    UART_Init(UART1, config);
    GPIO_Init(ledTf);
    GPIO_Init(ledGps);

    // GPS_Open waits for replies delivered through this task's events, so run it elsewhere
    OS_CreateTask(StatusTask,
        NULL, NULL, STATUS_TASK_STACK_SIZE, STATUS_TASK_PRIORITY, 0, 0, STATUS_TASK_NAME);

    while(1)
    {
        if(OS_WaitEvent(mainTaskHandle, (void**)&event, OS_TIME_OUT_WAIT_FOREVER))
        {
            EventDispatch(event);
            OS_Free(event->pParam1);
            OS_Free(event->pParam2);
            OS_Free(event);
        }
    }
}

void gpslogger_Main(void)
{
    mainTaskHandle = OS_CreateTask(MainTask,
        NULL, NULL, MAIN_TASK_STACK_SIZE, MAIN_TASK_PRIORITY, 0, 0, MAIN_TASK_NAME);
    OS_SetUserMainHandle(&mainTaskHandle);
}
