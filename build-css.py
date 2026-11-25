"""Rebuilds assets/tailwind.css from the classes used in index.html, app.html and assets/site.js.

    python build-css.py

Run it after using a Tailwind class that was not on the site before: the site loads this
ready-made file and does not run Tailwind in the browser. Needs Node (npx).
"""
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
VERSION = "3.4.16"
CONTENT = "./index.html,./app.html,./assets/site.js"

with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "in.css")
    with open(src, "w", encoding="utf-8") as f:
        f.write("@tailwind base;\n@tailwind components;\n@tailwind utilities;\n")
    subprocess.run(
        f'npx --yes tailwindcss@{VERSION} -i "{src}" -o assets/tailwind.css --content "{CONTENT}" --minify',
        cwd=ROOT, shell=True, check=True)
print("assets/tailwind.css", os.path.getsize(os.path.join(ROOT, "assets", "tailwind.css")), "bytes")
