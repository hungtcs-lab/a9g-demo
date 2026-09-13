#!/usr/bin/env python3
"""Print lines from the A9G UART1 (TX1/RX1) with timestamps.

    python3 tools/uart_log.py [seconds] [port] [baud]

Default port is the CP2102 adapter wired to TX1/RX1; seconds=0 runs until Ctrl+C.
"""
import sys
import time

import serial

DEFAULT_PORT = "/dev/serial/by-id/usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0"


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 0
    port = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PORT
    baud = int(sys.argv[3]) if len(sys.argv) > 3 else 115200

    start = time.time()
    buf = b""
    # exclusive: fail fast instead of two readers silently splitting the data
    with serial.Serial(port, baud, timeout=0.2, exclusive=True) as s:
        print(f"# listening on {port} @ {baud}" + (f" for {seconds:g}s" if seconds else ""), flush=True)
        try:
            while not seconds or time.time() - start < seconds:
                buf += s.read(1024)
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = line.decode(errors="replace").rstrip("\r")
                    if text:
                        print(f"[{time.time() - start:6.1f}s] {text}", flush=True)
        except KeyboardInterrupt:
            pass
    if buf.strip():
        print(f"[{time.time() - start:6.1f}s] {buf.decode(errors='replace').strip()}", flush=True)


if __name__ == "__main__":
    main()
