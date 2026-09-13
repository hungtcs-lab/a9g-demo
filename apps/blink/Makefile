#------------------------------------------------------------------
# Blink the two on-board LEDs. Built via ../../build.sh blink
#------------------------------------------------------------------

# Symlinked into the SDK as demo/blink, so the name must match that path
LOCAL_NAME := demo/blink

LOCAL_API_DEPENDS :=

LOCAL_ADD_INCLUDE := include \
                     include/std_inc \
                     include/api_inc \

IS_ENTRY_POINT := no

MYCFLAGS +=

C_SRC := ${notdir ${wildcard src/*.c}}

include ${SOFT_WORKDIR}/platform/compilation/cust_rules.mk
