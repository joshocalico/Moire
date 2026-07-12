#!/usr/bin/env bash
set -u
export HOME=/home/moire
export XDG_RUNTIME_DIR=/run/user/$(id -u)

echo "== GBM + eglGetPlatformDisplay =="
timeout 10 python3 - <<'PY'
import ctypes, ctypes.util, os

EGL_PLATFORM_GBM_KHR = 0x31D7
EGL_SUCCESS = 0x3000

egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
gbm = ctypes.CDLL("libgbm.so.1")
gbm.gbm_create_device.restype = ctypes.c_void_p
gbm.gbm_create_device.argtypes = [ctypes.c_int]
egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
egl.eglInitialize.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int32),
    ctypes.POINTER(ctypes.c_int32),
]
egl.eglGetError.restype = ctypes.c_int
egl.eglQueryString.restype = ctypes.c_char_p
egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]

fd = os.open("/dev/dri/renderD128", os.O_RDWR | os.O_CLOEXEC)
dev = gbm.gbm_create_device(fd)
print("gbm_create_device=", hex(dev or 0))
dpy = egl.eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, ctypes.c_void_p(dev), None)
err = egl.eglGetError()
print("eglGetPlatformDisplay=", hex(dpy or 0), "err", hex(err))
maj = ctypes.c_int32()
mn = ctypes.c_int32()
ok = egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
print("eglInitialize=", ok, "version", maj.value, mn.value, "err", hex(egl.eglGetError()))
if ok:
    for name, enum in [("VENDOR", 0x3053), ("VERSION", 0x3054), ("CLIENT_APIS", 0x308D), ("EXTENSIONS", 0x3055)]:
        s = egl.eglQueryString(dpy, enum)
        text = s.decode() if s else None
        if name == "EXTENSIONS" and text:
            text = text[:200] + "..."
        print(name, text)
PY

echo "== same with MESA_LOADER_DRIVER_OVERRIDE=virtio_gpu =="
timeout 10 env MESA_LOADER_DRIVER_OVERRIDE=virtio_gpu LIBGL_DEBUG=verbose python3 - <<'PY'
import ctypes, ctypes.util, os, sys
EGL_PLATFORM_GBM_KHR = 0x31D7
egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
gbm = ctypes.CDLL("libgbm.so.1")
gbm.gbm_create_device.restype = ctypes.c_void_p
gbm.gbm_create_device.argtypes = [ctypes.c_int]
egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32), ctypes.POINTER(ctypes.c_int32)]
egl.eglGetError.restype = ctypes.c_int
egl.eglQueryString.restype = ctypes.c_char_p
egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
fd = os.open("/dev/dri/renderD128", os.O_RDWR | os.O_CLOEXEC)
dev = gbm.gbm_create_device(fd)
dpy = egl.eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, ctypes.c_void_p(dev), None)
maj = ctypes.c_int32(); mn = ctypes.c_int32()
ok = egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
print("init", ok, maj.value, mn.value, "err", hex(egl.eglGetError()))
if ok:
    print("VENDOR", egl.eglQueryString(dpy, 0x3053))
    print("VERSION", egl.eglQueryString(dpy, 0x3054))
PY

echo "== GALLIUM_DRIVER=virgl =="
timeout 10 env GALLIUM_DRIVER=virgl LIBGL_DEBUG=verbose python3 - <<'PY'
import ctypes, ctypes.util, os
EGL_PLATFORM_GBM_KHR = 0x31D7
egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
gbm = ctypes.CDLL("libgbm.so.1")
gbm.gbm_create_device.restype = ctypes.c_void_p
gbm.gbm_create_device.argtypes = [ctypes.c_int]
egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32), ctypes.POINTER(ctypes.c_int32)]
egl.eglGetError.restype = ctypes.c_int
egl.eglQueryString.restype = ctypes.c_char_p
egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
fd = os.open("/dev/dri/renderD128", os.O_RDWR | os.O_CLOEXEC)
dev = gbm.gbm_create_device(fd)
dpy = egl.eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, ctypes.c_void_p(dev), None)
maj = ctypes.c_int32(); mn = ctypes.c_int32()
ok = egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
print("init", ok, maj.value, mn.value, "err", hex(egl.eglGetError()))
if ok:
    print("VENDOR", egl.eglQueryString(dpy, 0x3053))
    print("VERSION", egl.eglQueryString(dpy, 0x3054))
PY

echo "== LIBGL_ALWAYS_SOFTWARE =="
timeout 10 env LIBGL_ALWAYS_SOFTWARE=1 python3 - <<'PY'
import ctypes, ctypes.util, os
EGL_PLATFORM_GBM_KHR = 0x31D7
egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
gbm = ctypes.CDLL("libgbm.so.1")
gbm.gbm_create_device.restype = ctypes.c_void_p
gbm.gbm_create_device.argtypes = [ctypes.c_int]
egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32), ctypes.POINTER(ctypes.c_int32)]
egl.eglGetError.restype = ctypes.c_int
egl.eglQueryString.restype = ctypes.c_char_p
egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
fd = os.open("/dev/dri/renderD128", os.O_RDWR | os.O_CLOEXEC)
dev = gbm.gbm_create_device(fd)
dpy = egl.eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, ctypes.c_void_p(dev), None)
maj = ctypes.c_int32(); mn = ctypes.c_int32()
ok = egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
print("init", ok, maj.value, mn.value, "err", hex(egl.eglGetError()))
if ok:
    print("VENDOR", egl.eglQueryString(dpy, 0x3053))
    print("VERSION", egl.eglQueryString(dpy, 0x3054))
PY

echo "== kernel virtio features (sudo) =="
sudo dmesg | grep -i 'virtio_gpu\|features:' | tail -15
echo done
