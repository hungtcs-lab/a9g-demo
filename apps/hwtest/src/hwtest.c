/*
 * Hardware self-test for the A9G Pudding board: TF card and GPS.
 *
 * Results are printed to Trace (coolwatcher) and UART1 (TX1, 115200 8N1).
 * LEDs:
 *   IO27  solid = TF card OK,         blinking = TF card failed
 *   IO28  solid = GPS fixed,          blinking = NMEA data but no fix, off = no GPS data
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


#define MAIN_TASK_STACK_SIZE    (2048 * 2)
#define MAIN_TASK_PRIORITY      0
#define MAIN_TASK_NAME         "Main Task"

#define TEST_TASK_STACK_SIZE    (2048 * 4)
#define TEST_TASK_PRIORITY      1
#define TEST_TASK_NAME         "HW Test Task"

#define LED_SD                  GPIO_PIN27
#define LED_GPS                 GPIO_PIN28

#define TF_TEST_FILE            "/t/a9g_test.txt"
#define TF_TEST_TEXT            "hello from A9G, TF card read/write test\r\n"

#define REPORT_INTERVAL_MS      2000

static HANDLE mainTaskHandle = NULL;
static volatile uint32_t gpsBytes = 0;

static GPIO_config_t ledSd = {
    .mode         = GPIO_MODE_OUTPUT,
    .pin          = LED_SD,
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

static bool TestTfCard(void)
{
    API_FS_INFO info;
    char readBack[64];
    int32_t fd;
    int32_t len;
    const int32_t textLen = strlen(TF_TEST_TEXT);

    if(API_FS_GetFSInfo(FS_DEVICE_NAME_T_FLASH, &info) < 0)
    {
        Log("[TF] get info failed: no card, or card not mounted");
        return false;
    }
    Log("[TF] mounted, total:%u KB, used:%u KB",
        (unsigned)(info.totalSize / 1024), (unsigned)(info.usedSize / 1024));

    fd = API_FS_Open(TF_TEST_FILE, FS_O_RDWR | FS_O_CREAT, 0);
    if(fd < 0)
    {
        Log("[TF] open %s for write failed: %d", TF_TEST_FILE, (int)fd);
        return false;
    }
    len = API_FS_Write(fd, (uint8_t*)TF_TEST_TEXT, textLen);
    API_FS_Close(fd);
    if(len != textLen)
    {
        Log("[TF] write failed: %d/%d", (int)len, (int)textLen);
        return false;
    }

    memset(readBack, 0, sizeof(readBack));
    fd = API_FS_Open(TF_TEST_FILE, FS_O_RDONLY, 0);
    if(fd < 0)
    {
        Log("[TF] open %s for read failed: %d", TF_TEST_FILE, (int)fd);
        return false;
    }
    len = API_FS_Read(fd, (uint8_t*)readBack, sizeof(readBack) - 1);
    API_FS_Close(fd);
    if(len != textLen || memcmp(readBack, TF_TEST_TEXT, textLen) != 0)
    {
        Log("[TF] read back mismatch: %d bytes, \"%s\"", (int)len, readBack);
        return false;
    }

    Log("[TF] write + read back %s OK", TF_TEST_FILE);
    return true;
}

// ddmm.mmmm -> degree
static double NmeaToDegree(struct minmea_float* f)
{
    int deg;

    if(f->scale == 0)
        return 0;
    deg = (int)(f->value / f->scale / 100);
    return deg + (double)(f->value - deg * f->scale * 100) / f->scale / 60.0;
}

static void ReportGps(GPS_Info_t* gps, bool dataAlive)
{
    int fixType = gps->gsa[0].fix_type > gps->gsa[1].fix_type ? gps->gsa[0].fix_type : gps->gsa[1].fix_type;
    const char* fixStr = fixType == 3 ? "3D" : (fixType == 2 ? "2D" : "none");

    Log("[GPS] data:%s total:%u bytes, in view:%d, used:%d, fix:%s",
        dataAlive ? "yes" : "NO", (unsigned)gpsBytes,
        gps->gsv[0].total_sats, gps->gga.satellites_tracked, fixStr);

    if(fixType >= 2)
    {
        double altitude = gps->gga.altitude.scale ? (double)gps->gga.altitude.value / gps->gga.altitude.scale : 0;

        Log("[GPS] WGS84 lat:%f lon:%f alt:%f",
            NmeaToDegree(&gps->rmc.latitude), NmeaToDegree(&gps->rmc.longitude), altitude);
    }

    if(fixType >= 2)
        GPIO_SetLevel(ledGps, GPIO_LEVEL_HIGH);
    else if(dataAlive)
    {
        static GPIO_LEVEL level = GPIO_LEVEL_LOW;
        level = (level == GPIO_LEVEL_HIGH) ? GPIO_LEVEL_LOW : GPIO_LEVEL_HIGH;
        GPIO_SetLevel(ledGps, level);
    }
    else
        GPIO_SetLevel(ledGps, GPIO_LEVEL_LOW);
}

void TestTask(void* pData)
{
    GPS_Info_t* gps = Gps_GetInfo();
    GPIO_LEVEL sdLevel = GPIO_LEVEL_LOW;
    bool tfOk;
    bool versionShown = false;
    uint32_t lastBytes = 0;

    // Let the system finish starting up
    OS_Sleep(5000);
    Log("===== A9G hardware test start =====");

    tfOk = TestTfCard();
    Log("[TF] result: %s", tfOk ? "PASS" : "FAIL");
    GPIO_SetLevel(ledSd, tfOk ? GPIO_LEVEL_HIGH : GPIO_LEVEL_LOW);

    GPS_Init();
    if(!GPS_Open(NULL))
        Log("[GPS] open failed");
    else
        Log("[GPS] opened, waiting for NMEA data...");

    while(1)
    {
        bool dataAlive = gpsBytes != lastBytes;

        lastBytes = gpsBytes;
        if(dataAlive && !versionShown)
        {
            char version[100];

            memset(version, 0, sizeof(version));
            if(GPS_GetVersion(version, sizeof(version)))
                Log("[GPS] firmware: %s", version);
            else
                Log("[GPS] get firmware version failed");
            versionShown = true;
        }
        ReportGps(gps, dataAlive);

        if(!tfOk)
        {
            sdLevel = (sdLevel == GPIO_LEVEL_HIGH) ? GPIO_LEVEL_LOW : GPIO_LEVEL_HIGH;
            GPIO_SetLevel(ledSd, sdLevel);
        }
        OS_Sleep(REPORT_INTERVAL_MS);
    }
}

void EventDispatch(API_Event_t* pEvent)
{
    switch(pEvent->id)
    {
        case API_EVENT_ID_SYSTEM_READY:
            Log("[SYS] system ready");
            break;
        case API_EVENT_ID_NO_SIMCARD:
            Log("[SYS] no SIM card (expected for this test)");
            break;
        case API_EVENT_ID_GPS_UART_RECEIVED:
            gpsBytes += pEvent->param1;
            GPS_Update(pEvent->pParam1, pEvent->param1);
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
        .useEvent   = false
    };

    UART_Init(UART1, config);
    GPIO_Init(ledSd);
    GPIO_Init(ledGps);

    OS_CreateTask(TestTask,
        NULL, NULL, TEST_TASK_STACK_SIZE, TEST_TASK_PRIORITY, 0, 0, TEST_TASK_NAME);

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

void hwtest_Main(void)
{
    mainTaskHandle = OS_CreateTask(MainTask,
        NULL, NULL, MAIN_TASK_STACK_SIZE, MAIN_TASK_PRIORITY, 0, 0, MAIN_TASK_NAME);
    OS_SetUserMainHandle(&mainTaskHandle);
}
