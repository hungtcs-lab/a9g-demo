#------------------------------------------------------------------
# GPS logger: record GPS fixes to the TF card. Built via ../../build.sh gpslogger
#------------------------------------------------------------------

# Symlinked into the SDK as demo/gpslogger, so the name must match that path
LOCAL_NAME := demo/gpslogger

LOCAL_API_DEPENDS := libs/gps \
                     libs/utils \

LOCAL_ADD_INCLUDE := include \
                     include/std_inc \
                     include/api_inc \
                     libs/gps/minmea/src \

IS_ENTRY_POINT := no

MYCFLAGS +=

C_SRC := ${notdir ${wildcard src/*.c}}

include ${SOFT_WORKDIR}/platform/compilation/cust_rules.mk
