#!/usr/bin/env bash
set -u
export HOME=/home/moire
echo "== create GLES2 context on GBM =="
timeout 10 python3 - <<'PY'
import ctypes, ctypes.util, os

EGL_PLATFORM_GBM_KHR = 0x31D7
EGL_OPENGL_ES_API = 0x30A0
EGL_SURFACE_TYPE = 0x3033
EGL_WINDOW_BIT = 0x0004
EGL_RENDERABLE_TYPE = 0x3040
EGL_OPENGL_ES2_BIT = 0x0004
EGL_RED_SIZE = 0x3024
EGL_GREEN_SIZE = 0x3023
EGL_BLUE_SIZE = 0x3022
EGL_ALPHA_SIZE = 0x3021
EGL_NONE = 0x3038
EGL_CONTEXT_CLIENT_VERSION = 0x3098
GBM_FORMAT_XRGB8888 = 0x34325258
GBM_BO_USE_RENDERING = 4
GBM_BO_USE_SCANOUT = 1

egl = ctypes.CDLL(ctypes.util.find_library("EGL") or "libEGL.so.1")
gbm = ctypes.CDLL("libgbm.so.1")
gles = ctypes.CDLL(ctypes.util.find_library("GLESv2") or "libGLESv2.so.2")

gbm.gbm_create_device.restype = ctypes.c_void_p
gbm.gbm_create_device.argtypes = [ctypes.c_int]
gbm.gbm_surface_create.restype = ctypes.c_void_p
gbm.gbm_surface_create.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint]

egl.eglGetPlatformDisplay.restype = ctypes.c_void_p
egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32), ctypes.POINTER(ctypes.c_int32)]
egl.eglBindAPI.argtypes = [ctypes.c_uint]
egl.eglChooseConfig.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_void_p), ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
egl.eglCreateContext.restype = ctypes.c_void_p
egl.eglCreateContext.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
egl.eglCreatePlatformWindowSurface.restype = ctypes.c_void_p
egl.eglCreatePlatformWindowSurface.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
egl.eglMakeCurrent.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
egl.eglGetError.restype = ctypes.c_int
egl.eglQueryString.restype = ctypes.c_char_p
egl.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
gles.glGetString.restype = ctypes.c_char_p
gles.glGetString.argtypes = [ctypes.c_uint]

fd = os.open("/dev/dri/renderD128", os.O_RDWR | os.O_CLOEXEC)
dev = gbm.gbm_create_device(fd)
dpy = egl.eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, ctypes.c_void_p(dev), None)
maj = ctypes.c_int32(); mn = ctypes.c_int32()
assert egl.eglInitialize(dpy, ctypes.byref(maj), ctypes.byref(mn))
assert egl.eglBindAPI(EGL_OPENGL_ES_API)

attribs = (ctypes.c_int * 13)(
    EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
    EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
    EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 0,
    EGL_NONE,
)
cfg = ctypes.c_void_p()
n = ctypes.c_int()
ok = egl.eglChooseConfig(dpy, attribs, ctypes.byref(cfg), 1, ctypes.byref(n))
print("chooseConfig", ok, "n=", n.value, "err", hex(egl.eglGetError()))
ctx_attribs = (ctypes.c_int * 3)(EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE)
ctx = egl.eglCreateContext(dpy, cfg, None, ctx_attribs)
print("createContext", hex(ctx or 0), "err", hex(egl.eglGetError()))
surf_native = gbm.gbm_surface_create(dev, 64, 64, GBM_FORMAT_XRGB8888, GBM_BO_USE_RENDERING | GBM_BO_USE_SCANOUT)
print("gbm_surface", hex(surf_native or 0))
win = egl.eglCreatePlatformWindowSurface(dpy, cfg, ctypes.c_void_p(surf_native), None)
print("windowSurface", hex(win or 0), "err", hex(egl.eglGetError()))
ok = egl.eglMakeCurrent(dpy, win, win, ctx)
print("makeCurrent", ok, "err", hex(egl.eglGetError()))
if ok:
    GL_VERSION = 0x1F02
    GL_RENDERER = 0x1F01
    GL_VENDOR = 0x1F00
    print("GL_VENDOR", gles.glGetString(GL_VENDOR))
    print("GL_RENDERER", gles.glGetString(GL_RENDERER))
    print("GL_VERSION", gles.glGetString(GL_VERSION))
PY
echo done
