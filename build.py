import re, pathlib
r = pathlib.Path(__file__).parent
t = (r / "demo/template.html").read_text()
full = t.replace("/*CORE*/", (r / "src/core.js").read_text()).replace("/*ENGINE*/", (r / "src/engine.js").read_text())
(r / "index.html").write_text(full)
a = re.sub(r"<!--DL-->.*?<!--/DL-->", "", full, flags=re.S)
a = re.sub(r"/\*DL\*/.*?/\*/DL\*/", "", a, flags=re.S)
(r / "artifact.html").write_text(a)
print(len(full), len(a), "a.download" in a)

# the standalone page needs a charset when opened from disk (the artifact wrapper adds its own)
_i = pathlib.Path(__file__).parent / "index.html"
_s = _i.read_text()
if not _s.lstrip().lower().startswith("<!doctype"):
    _i.write_text('<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + _s)
