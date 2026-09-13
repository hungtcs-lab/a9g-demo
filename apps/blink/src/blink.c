#include "stdint.h"
#include "stdbool.h"
#include "api_os.h"
#include "api_debug.h"
#include "api_event.h"
#include "api_hal_gpio.h"


#define MAIN_TASK_STACK_SIZE    (1024 * 2)
#define MAIN_TASK_PRIORITY      0
#define MAIN_TASK_NAME         "Main Task"

#define BLINK_TASK_STACK_SIZE   (1024 * 2)
#define BLINK_TASK_PRIORITY     1
#define BLINK_TASK_NAME        "Blink Task"

#define BLINK_INTERVAL_MS       500

#define GPIO_PIN_LED_BLUE       GPIO_PIN27
#define GPIO_PIN_LED_GREEN      GPIO_PIN28

static HANDLE mainTaskHandle = NULL;
static HANDLE blinkTaskHandle = NULL;


// Alternately blink the two on-board LEDs (IO27 / IO28), only these two pins are touched
void BlinkTask(void *pData)
{
    GPIO_LEVEL level = GPIO_LEVEL_LOW;
    uint32_t count = 0;

    GPIO_config_t ledBlue = {
        .mode         = GPIO_MODE_OUTPUT,
        .pin          = GPIO_PIN_LED_BLUE,
        .defaultLevel = GPIO_LEVEL_LOW
    };
    GPIO_config_t ledGreen = {
        .mode         = GPIO_MODE_OUTPUT,
        .pin          = GPIO_PIN_LED_GREEN,
        .defaultLevel = GPIO_LEVEL_HIGH
    };

    GPIO_Init(ledBlue);
    GPIO_Init(ledGreen);
    Trace(1, "blink start");

    while(1)
    {
        level = (level == GPIO_LEVEL_HIGH) ? GPIO_LEVEL_LOW : GPIO_LEVEL_HIGH;
        GPIO_SetLevel(ledBlue, level);
        GPIO_SetLevel(ledGreen, (level == GPIO_LEVEL_HIGH) ? GPIO_LEVEL_LOW : GPIO_LEVEL_HIGH);
        Trace(1, "blink %d, level:%d", ++count, level);
        OS_Sleep(BLINK_INTERVAL_MS);
    }
}

void EventDispatch(API_Event_t* pEvent)
{
    switch(pEvent->id)
    {
        default:
            break;
    }
}

void MainTask(void *pData)
{
    API_Event_t* event = NULL;

    blinkTaskHandle = OS_CreateTask(BlinkTask,
        NULL, NULL, BLINK_TASK_STACK_SIZE, BLINK_TASK_PRIORITY, 0, 0, BLINK_TASK_NAME);

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

void blink_Main(void)
{
    mainTaskHandle = OS_CreateTask(MainTask,
        NULL, NULL, MAIN_TASK_STACK_SIZE, MAIN_TASK_PRIORITY, 0, 0, MAIN_TASK_NAME);
    OS_SetUserMainHandle(&mainTaskHandle);
}
