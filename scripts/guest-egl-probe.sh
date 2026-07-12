#!/usr/bin/env bash
set -u
export HOME=/home/moire
echo "== dri =="
ls /usr/lib/aarch64-linux-gnu/dri/ | grep -iE 'virt|virgl|kms_swrast|swrast|zink|virtio' || true
echo "== open =="
python3 - <<'PY'
import os
for p in ["/dev/dri/card1", "/dev/dri/renderD128"]:
    try:
        fd = os.open(p, os.O_RDWR | os.O_CLOEXEC)
        print(p, "OK")
        os.close(fd)
    except OSError as e:
        print(p, "FAIL", e)
PY
echo "== vulkan virtio only =="
timeout 8 env VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/virtio_icd.json vulkaninfo --summary 2>&1 | head -50 || true
echo "== vulkan all =="
timeout 8 vulkaninfo --summary 2>&1 | head -50 || true
echo "== egl default display =="
timeout 8 python3 - <<'PY'
import ctypes, ctypes.util, os
egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
egl.eglGetDisplay.restype = ctypes.c_void_p
egl.eglGetDisplay.argtypes = [ctypes.c_void_p]
egl.eglInitialize.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int32),
    ctypes.POINTER(ctypes.c_int32),
]
egl.eglGetError.restype = ctypes.c_int
dpy = egl.eglGetDisplay(ctypes.c_void_p(0))
print("eglGetDisplay(DEFAULT)=", hex(dpy or 0), "err", hex(egl.eglGetError()))
maj = ctypes.c_int32()
mn = ctypes.c_int32()
ok = egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
print("eglInitialize=", ok, "version", maj.value, mn.value, "err", hex(egl.eglGetError()))
PY
echo "== egl GBM platform on renderD128 =="
timeout 10 python3 - <<'PY'
import ctypes, ctypes.util, os
EGL_PLATFORM_GBM_KHR = 0x31D7
egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
gbm = ctypes.CDLL("libgbm.so.1")
gbm.gbm_create_device.restype = ctypes.c_void_p
gbm.gbm_create_device.argtypes = [ctypes.c_int]
egl.eglGetPlatformDisplayEXT.restype = ctypes.c_void_p
egl.eglGetPlatformDisplayEXT.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
# fall back to eglGetPlatformDisplay
try:
    egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
    egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    get_plat = egl.eglGetPlatformDisplay
except Exception:
    get_plat = egl.eglGetPlatformDisplayEXT
egl.eglInitialize.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int32),
    ctypes.POINTER(ctypes.c_int32),
]
egl.eglGetError.restype = ctypes.c_int
fd = os.open("/dev/dri/renderD128", os.O_RDWR | os.O_CLOEXEC)
dev = gbm.gbm_create_device(fd)
print("gbm_create_device=", hex(dev or 0))
dpy = get_plat(EGL_PLATFORM_GBM_KHR, ctypes.c_void_p(dev), None)
print("eglGetPlatformDisplay(GBM)=", hex(dpy or 0), "err", hex(egl.eglGetError()))
maj = ctypes.c_int32()
mn = ctypes.c_int32()
ok = egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
print("eglInitialize=", ok, "version", maj.value, mn.value, "err", hex(egl.eglGetError()))
# Query client APIs / vendor if init ok
if ok:
    egl.eglQueryString.restype = ctypes.c_char_p
    egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
    for name, enum in [("VENDOR", 0x3053), ("VERSION", 0x3054), ("CLIENT_APIS", 0x308D)]:
        s = egl.eglQueryString(dpy, enum)
        print(name, s)
PY
echo "== dmesg virtio features =="
dmesg | grep -i 'virtio_gpu\|features:' | tail -10
echo done
