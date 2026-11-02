"""Refresh the site with the latest build of each app.

    python sync.py                 # all apps
    python sync.py pigeon zochrim  # only these
    python sync.py --push pigeon   # and commit + push

Reads sync-sources.json, copies the newest build into downloads/, copies hosted
web apps into web/<id>/, and writes version / date / size into data/apps.json.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(ROOT, "sync-sources.json")
CATALOG = os.path.join(ROOT, "data", "apps.json")


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def github(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "havivons-apps-sync"}
    if os.environ.get("GITHUB_TOKEN"):  # optional: lifts the 60 requests/hour anonymous limit
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def find_aapt():
    sdk = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk", "build-tools")
    tools = sorted(glob.glob(os.path.join(sdk, "*", "aapt2.exe")) + glob.glob(os.path.join(sdk, "*", "aapt.exe")))
    return tools[-1] if tools else None


def apk_version(apk):
    aapt = find_aapt()
    if not aapt:
        return None
    try:
        out = subprocess.run([aapt, "dump", "badging", apk], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    except OSError:
        return None
    m = re.search(r"versionName='([^']*)'", out)
    return m.group(1) if m else None


def gradle_version(path):
    if not os.path.exists(path):
        return None
    m = re.search(r'versionName\s*=?\s*"([^"]+)"', open(path, encoding="utf-8").read())
    return m.group(1) if m else None


def newest_artifact(base, patterns):
    files = []
    for p in patterns:
        files += [f for f in glob.glob(os.path.join(base, p)) if "unsigned" not in os.path.basename(f)]
    return max(files, key=os.path.getmtime) if files else None


def day(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def sync_local(app_id, src, entry):
    base = src["path"]
    art = newest_artifact(base, src.get("artifact", []))
    if not art:
        entry["download"] = None
        if not src.get("host"):
            print(f"  {app_id}: no build found")
    else:
        os.makedirs(os.path.join(ROOT, "downloads"), exist_ok=True)
        ext = os.path.splitext(art)[1].lower()
        if src.get("zip"):
            name = f"{app_id}.zip"
            dest = os.path.join(ROOT, "downloads", name)
            with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
                z.write(art, os.path.basename(art))
        else:
            name = f"{app_id}{ext}"
            dest = os.path.join(ROOT, "downloads", name)
            shutil.copy2(art, dest)
        version = None
        if ext == ".apk":
            version = apk_version(art)
        if not version and src.get("version_file"):
            version = gradle_version(os.path.join(base, src["version_file"]))
        entry["version"] = version
        entry["updated"] = day(os.path.getmtime(art))
        entry["download"] = {"url": f"downloads/{name}", "size": os.path.getsize(dest), "type": ext.lstrip(".") if not src.get("zip") else "zip"}
        print(f"  {app_id}: {os.path.relpath(art, base)} -> downloads/{name} (v{version}, {entry['updated']})")

    host = src.get("host")
    if host and host.get("files"):
        # multi-file web app: copy the listed files/globs into a fresh web/<id>/
        dest_dir = os.path.join(ROOT, host["to"])
        shutil.rmtree(dest_dir, ignore_errors=True)
        newest = 0
        for pattern in host["files"]:
            for f in glob.glob(os.path.join(base, pattern), recursive=True):
                if os.path.isfile(f):
                    out = os.path.join(dest_dir, os.path.relpath(f, base))
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    shutil.copy2(f, out)
                    newest = max(newest, os.path.getmtime(f))
        entry["open"] = host["to"].replace("\\", "/").rstrip("/") + "/"
        if newest and not art:
            entry["updated"] = day(newest)
        print(f"  {app_id}: hosted at {entry['open']} ({entry.get('updated')})")
    elif host:
        dest = os.path.join(ROOT, host["to"])
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(os.path.join(base, host["from"]), dest)
        entry["open"] = os.path.dirname(host["to"]).replace("\\", "/") + "/"


def sync_remote(app_id, src, entry):
    r = src["remote"]
    api = f"https://api.github.com/repos/{r['repo']}"
    if r["kind"] == "release":
        # newest release in the list, not /releases/latest: that one skips pre-releases
        rel = github(api + "/releases?per_page=1")[0]
        asset = next(a for a in rel["assets"] if a["name"].endswith(r["asset"]))
        # tags like "latest" / "android-build-18" are not versions; the asset name often is
        m = re.match(r"v?(\d[\w.]*)$", rel["tag_name"]) or re.search(r"(\d+\.\d+(?:\.\d+)?)", asset["name"])
        entry["version"] = m.group(1) if m else None
        entry["updated"] = rel["published_at"][:10]
        entry["download"] = {"url": asset["browser_download_url"], "size": asset["size"], "type": "apk"}
    elif r["kind"] == "file":
        repo = github(api)
        info = github(f"{api}/contents/{r['file']}?ref={repo['default_branch']}")
        commit = github(f"{api}/commits?path={r['file']}&sha={repo['default_branch']}&per_page=1")[0]
        entry["updated"] = commit["commit"]["committer"]["date"][:10]
        entry["download"] = {"url": f"https://github.com/{r['repo']}/raw/{repo['default_branch']}/{r['file']}", "size": info["size"], "type": os.path.splitext(r["file"])[1].lstrip(".")}
    elif r["kind"] == "commit":
        repo = github(api)
        entry["updated"] = repo["pushed_at"][:10]
        entry.setdefault("download", None)
    print(f"  {app_id}: {r['repo']} (v{entry.get('version')}, {entry.get('updated')})")


def main(argv):
    push = "--push" in argv
    only = [a for a in argv if not a.startswith("--")]
    sources = load(SOURCES, {})["apps"]
    catalog = {a["id"]: a for a in load(CATALOG, {"apps": []})["apps"]}
    unknown = [a for a in only if a not in sources]
    if unknown:
        sys.exit(f"Unknown app id(s): {', '.join(unknown)}. Known: {', '.join(sources)}")

    hidden = [i for i, s in sources.items() if s.get("hidden")]
    for app_id in hidden:  # "hidden": "<reason>" keeps an app off the site
        catalog.pop(app_id, None)
        print(f"  {app_id}: hidden ({sources[app_id]['hidden']})")
    sources = {i: s for i, s in sources.items() if i not in hidden}

    for app_id, src in sources.items():
        entry = catalog.setdefault(app_id, {"id": app_id})
        entry["category"] = src["category"]
        entry["order"] = src["order"]
        if src.get("open"):
            entry["open"] = src["open"]
        if src.get("repo"):
            entry["repo"] = f"https://github.com/{src['repo']}"
        if only and app_id not in only:
            continue
        try:
            (sync_remote if "remote" in src else sync_local)(app_id, src, entry)
        except Exception as e:  # keep going; one broken source should not block the rest
            print(f"  {app_id}: FAILED ({e})")

    apps = sorted((catalog[i] for i in sources), key=lambda a: a["order"])
    os.makedirs(os.path.dirname(CATALOG), exist_ok=True)
    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "apps": apps}, f, ensure_ascii=False, indent=2)
        f.write("\n")

    if push:
        names = ", ".join(only) if only else "all apps"
        subprocess.run(["git", "-C", ROOT, "add", "-A"], check=True)
        if subprocess.run(["git", "-C", ROOT, "diff", "--cached", "--quiet"]).returncode == 0:
            print("Nothing changed.")
            return
        subprocess.run(["git", "-C", ROOT, "commit", "-m", f"Update {names}"], check=True)
        subprocess.run(["git", "-C", ROOT, "push"], check=True)


if __name__ == "__main__":
    main(sys.argv[1:])
