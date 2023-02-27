import pigpio
import time
import sys

pi = None
slave_addr = 0x12

def i2cInterrupt(event, tick):
   global pi
   global slave_addr
   status, bytes_read, data = pi.bsc_i2c(slave_addr)

   if bytes_read:
      print(data.decode("utf-8"))
#      print("***")
      sys.stdout.flush()

pi = pigpio.pi()
int_handler = pi.event_callback(pigpio.EVENT_BSC, i2cInterrupt)
pi.bsc_i2c(slave_addr)

while True:
   time.sleep(10)
