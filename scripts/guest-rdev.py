#!/usr/bin/env python3
import os, ctypes
s = os.stat("/dev/dri/renderD128")
print("rdev", s.st_rdev, hex(s.st_rdev))
print("dev_t_size", ctypes.sizeof(ctypes.c_ulong))
# Also card1
s2 = os.stat("/dev/dri/card1")
print("card1_rdev", s2.st_rdev, hex(s2.st_rdev))
