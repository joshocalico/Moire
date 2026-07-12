#!/usr/bin/env python3
from pathlib import Path
t = Path("/usr/include/gbm.h").read_text()
i = t.find("struct gbm_import_fd")
print(t[i : i + 1500])
