#------------------------------------------------------------------
# Hardware self-test: TF card + GPS. Built via ../../build.sh hwtest
#------------------------------------------------------------------

# Symlinked into the SDK as demo/hwtest, so the name must match that path
LOCAL_NAME := demo/hwtest

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
