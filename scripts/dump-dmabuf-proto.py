import xml.etree.ElementTree as ET
p = "/usr/share/wayland-protocols/unstable/linux-dmabuf/linux-dmabuf-unstable-v1.xml"
root = ET.parse(p).getroot()
for iface in root.findall("interface"):
    name = iface.get("name")
    ver = iface.get("version")
    print(f"\n## {name} v{ver}")
    for i, req in enumerate(iface.findall("request")):
        args = ", ".join(
            f"{a.get('name')}:{a.get('type')}" for a in req.findall("arg")
        )
        print(f"  req {i} {req.get('name')}({args})")
    for i, ev in enumerate(iface.findall("event")):
        args = ", ".join(
            f"{a.get('name')}:{a.get('type')}" for a in ev.findall("arg")
        )
        print(f"  ev  {i} {ev.get('name')}({args})")
