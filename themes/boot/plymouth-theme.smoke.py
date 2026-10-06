#!/usr/bin/env python3
"""Check theme contracts; optionally use the actual Plymouth script/PNG engine.

The native check replaces display and sprite publication with recorded geometry.
It opens no DRM device, daemon, terminal, input device or session bus.
"""

import argparse
import configparser
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
import time
import zlib


THEME_DIR = Path(__file__).resolve().parent


def check_contract():
    descriptor = configparser.ConfigParser(interpolation=None)
    descriptor.read(THEME_DIR / "moire-silk.plymouth")
    assert descriptor["Plymouth Theme"]["ModuleName"] == "script"
    assert descriptor["script"]["ImageDir"] == "@THEME_DIR@"
    assert descriptor["script"]["ScriptFile"] == "@THEME_DIR@/moire-silk.script"
    source = (THEME_DIR / "moire-silk.script").read_text()
    calls = re.findall(r"Plymouth\.(\w+)\s*\(", re.sub(r"#.*", "", source))
    assert calls == ["SetDisplayHotplugFunction"], calls
    assert 'Image("silk-fold.png")' in source
    package = (THEME_DIR.parents[1] / "nix/plymouth-theme.nix").read_text()
    assert "--subst-var-by THEME_DIR" in package
    assert "share/plymouth/themes/moire-silk" in package
    assert not re.search(r"\b(users|security|boot|services)\s*\.", package)
    print("[plymouth/theme] descriptor, static callback and asset-only package contracts passed")
    return source


def write_fixture_png(file):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    width, height = 1280, 800
    pixels = (b"\0" + bytes([8, 10, 16, 255]) * width) * height
    file.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


def png_size(file):
    header = file.read_bytes()[:24]
    assert header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR"
    width, height = struct.unpack(">II", header[16:24])
    assert width > 0 and height > 0
    return width, height


class ScriptReturn(ctypes.Structure):
    # Exact script_return_t ABI from pinned Plymouth 26.134.222 script.h.
    _fields_ = [("type", ctypes.c_int), ("object", ctypes.c_void_p)]


def native_checks(plugin_path, source, artwork):
    library = ctypes.CDLL(str(plugin_path))
    signatures = {
        "script_parse_string": ([ctypes.c_char_p, ctypes.c_char_p], ctypes.c_void_p),
        "script_parse_file": ([ctypes.c_char_p], ctypes.c_void_p),
        "script_parse_op_free": ([ctypes.c_void_p], None),
        "script_state_new": ([ctypes.c_void_p], ctypes.c_void_p),
        "script_state_destroy": ([ctypes.c_void_p], None),
        "script_execute": ([ctypes.c_void_p, ctypes.c_void_p], ScriptReturn),
        "script_obj_as_number": ([ctypes.c_void_p], ctypes.c_double),
        "script_obj_unref": ([ctypes.c_void_p], None),
        "script_lib_image_setup": ([ctypes.c_void_p, ctypes.c_char_p], ctypes.c_void_p),
        "script_lib_image_destroy": ([ctypes.c_void_p], None),
        "script_lib_math_setup": ([ctypes.c_void_p], ctypes.c_void_p),
        "script_lib_math_destroy": ([ctypes.c_void_p], None),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(library, name)
        function.argtypes = arguments
        function.restype = result

    parsed = library.script_parse_file(os.fsencode(THEME_DIR / "moire-silk.script"))
    assert parsed, "the actual Plymouth parser rejected the theme"
    library.script_parse_op_free(parsed)
    assert not library.script_parse_string(b")", b"invalid-control"), "parser negative control"

    with tempfile.TemporaryDirectory(prefix="moire-plymouth-contract-") as directory:
        root = Path(directory)
        image = root / "silk-fold.png"
        if artwork.is_file():
            shutil.copyfile(artwork, image)
            print(f"[plymouth/theme] checking real artwork {artwork}")
        else:
            write_fixture_png(image)
            print("[plymouth/theme] product artwork absent; decoding a disposable geometry fixture")
        image_width, image_height = png_size(image)
        keys = ("HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME")
        previous = {key: os.environ.get(key) for key in keys}
        for key in keys:
            os.environ[key] = str(root / key.lower())
        try:
            decode_wall_ms = []
            decode_cpu_ms = []
            decode_operation = library.script_parse_string(
                b'loaded = Image("silk-fold.png"); return loaded.GetWidth() * loaded.GetHeight() * 4;',
                b"native-png-load-cost",
            )
            assert decode_operation
            try:
                for _ in range(5):
                    state = library.script_state_new(None)
                    image_library = library.script_lib_image_setup(state, os.fsencode(root))
                    try:
                        start_wall = time.perf_counter_ns()
                        start_cpu = time.process_time_ns()
                        result = library.script_execute(state, decode_operation)
                        decode_wall_ms.append((time.perf_counter_ns() - start_wall) / 1_000_000)
                        decode_cpu_ms.append((time.process_time_ns() - start_cpu) / 1_000_000)
                        assert result.object
                        decoded_bytes = library.script_obj_as_number(result.object)
                        library.script_obj_unref(result.object)
                        assert decoded_bytes == image_width * image_height * 4
                    finally:
                        library.script_state_destroy(state)
                        library.script_lib_image_destroy(image_library)
            finally:
                library.script_parse_op_free(decode_operation)
            print(json.dumps({
                "measurement": "native_png_load_and_dimension_query",
                "plugin": str(plugin_path),
                "artwork_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                "compressed_bytes": image.stat().st_size,
                "decoded_bytes": image_width * image_height * 4,
                "wall_ms": decode_wall_ms,
                "cpu_ms": decode_cpu_ms,
                "scope": "headless temporary file; page cache uncontrolled; no boot, scaling or display time",
            }))
            scenarios = [
                [],
                [(1280, 800, 0, 0)],
                [(640, 480, 0, 0)],
                [(1920, 1080, 0, 0)],
                [(480, 800, 0, 0)],
                [(32, 32, 0, 0)],
                [(640, 480, -640, 0), (1280, 800, 0, 120)],
            ]
            for windows in scenarios:
                state = library.script_state_new(None)
                assert state
                image_library = library.script_lib_image_setup(state, os.fsencode(root))
                math_library = library.script_lib_math_setup(state)
                operations = []

                def execute(program):
                    operation = library.script_parse_string(program.encode(), b"geometry-contract")
                    assert operation, "native parser rejected the geometry fixture"
                    operations.append(operation)
                    result = library.script_execute(state, operation)
                    value = None
                    if result.object:
                        value = library.script_obj_as_number(result.object)
                        library.script_obj_unref(result.object)
                    assert result.type != 2, "native script execution failed"
                    return value

                try:
                    execute("""
fixture.widths = []; fixture.heights = []; fixture.xs = []; fixture.ys = [];
fixture.results = []; fixture.count = 0; fixture.hidden = 0;
Window.GetWidth = fun(index) { return fixture.widths[index]; };
Window.GetHeight = fun(index) { return fixture.heights[index]; };
Window.GetX = fun(index) { return fixture.xs[index]; };
Window.GetY = fun(index) { return fixture.ys[index]; };
Window.SetBackgroundTopColor = fun(red, green, blue) {};
Window.SetBackgroundBottomColor = fun(red, green, blue) {};
Plymouth.SetDisplayHotplugFunction = fun(callback) { global.fixture.hotplug = callback; };
Sprite = fun(image) {
  local.sprite;
  sprite.image = image;
  sprite.SetOpacity = fun(opacity) { global.fixture.hidden += 1; };
  sprite.SetPosition = fun(x, y, z) {
    local.record;
    record.x = x; record.y = y;
    record.width = this.image.GetWidth(); record.height = this.image.GetHeight();
    global.fixture.results[fixture.count] = record;
    global.fixture.count += 1;
  };
  return sprite;
};
""")

                    def assign_windows(outputs):
                        execute("fixture.widths = []; fixture.heights = []; fixture.xs = []; fixture.ys = [];")
                        for index, (width, height, x, y) in enumerate(outputs):
                            execute(
                                f"fixture.widths[{index}]={width}; fixture.heights[{index}]={height};"
                                f"fixture.xs[{index}]={x}; fixture.ys[{index}]={y};"
                            )

                    def check_geometry(outputs):
                        assert execute("return fixture.count;") == len(outputs)
                        for index, (width, height, x, y) in enumerate(outputs):
                            actual = {
                                key: execute(f"return fixture.results[{index}].{key};")
                                for key in ("x", "y", "width", "height")
                            }
                            assert all(value is not None and math.isfinite(value) for value in actual.values()), actual
                            draw_width, draw_height = actual["width"], actual["height"]
                            assert 0 < draw_width <= width and 0 < draw_height <= height, actual
                            assert abs(actual["x"] + draw_width / 2 - (x + width / 2)) <= 0.5, actual
                            assert abs(actual["y"] + draw_height / 2 - (y + height / 2)) <= 0.5, actual
                            assert min(width - draw_width, height - draw_height) < 2, actual
                            assert abs(draw_width * image_height - draw_height * image_width) <= max(image_width, image_height), actual

                    assign_windows(windows)
                    execute(source)
                    check_geometry(windows)
                    execute("fixture.results = []; fixture.count = 0;")
                    assign_windows([(800, 600, 20, -10)])
                    execute("fixture.hotplug();")
                    check_geometry([(800, 600, 20, -10)])
                    assert execute("return fixture.hidden;") == len(windows), "stale sprites were not hidden"
                    execute("fixture.results = []; fixture.count = 0;")
                    assign_windows([])
                    execute("fixture.hotplug();")
                    check_geometry([])
                    assert execute("return fixture.hidden;") == len(windows) + 1, "last removed display retained a sprite"
                finally:
                    library.script_state_destroy(state)
                    library.script_lib_image_destroy(image_library)
                    library.script_lib_math_destroy(math_library)
                    for operation in operations:
                        library.script_parse_op_free(operation)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
    print("[plymouth/theme] actual parser/PNG/scale engine: fit, centering, aspect, display offsets and hotplug cleanup passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin", type=Path, help="pinned Plymouth lib/plymouth/script.so")
    parser.add_argument("--artwork", type=Path, default=THEME_DIR / "silk-fold.png")
    args = parser.parse_args()
    source = check_contract()
    if args.plugin:
        native_checks(args.plugin, source, args.artwork)
    else:
        print("[plymouth/theme] native parser/PNG checks not run; supply --plugin on Linux")


if __name__ == "__main__":
    main()
