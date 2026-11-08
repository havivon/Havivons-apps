"""Refresh the site with the latest build of each app.

    python sync.py                 # all apps
    python sync.py pigeon zochrim  # only these
    python sync.py --push pigeon   # and commit + push

Reads sync-sources.json, copies the newest build into downloads/, copies hosted
web apps into web/<id>/, and writes version / date / size into data/apps.json.
"""
import glob
import io
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
    if r.get("host"):
        host_repo(app_id, r, entry)
    else:
        entry.pop("site_download", None)
    print(f"  {app_id}: {r['repo']} (v{entry.get('version')}, {entry.get('updated')})")


TRACKING = [  # Google Analytics + AdSense snippets; they have no use on a copy outside the original domain
    r'<script[^>]*googletagmanager\.com[^>]*>\s*</script>\s*',
    r'<script>\s*window\.dataLayer[\s\S]*?</script>\s*',
    r'<script[^>]*adsbygoogle[^>]*>\s*</script>\s*',
    r'<ins class="adsbygoogle"[\s\S]*?</ins>\s*',
    r'<script>\s*\(adsbygoogle[\s\S]*?</script>\s*',
]


def host_repo(app_id, r, entry):
    """Copy a site repo's default branch into web/<id>/ and zip that copy for download."""
    host = r["host"]
    branch = github(f"https://api.github.com/repos/{r['repo']}")["default_branch"]
    req = urllib.request.Request(f"https://github.com/{r['repo']}/archive/refs/heads/{branch}.zip", headers={"User-Agent": "havivons-apps-sync"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        archive = zipfile.ZipFile(io.BytesIO(resp.read()))
    dest_dir = os.path.join(ROOT, host["to"])
    shutil.rmtree(dest_dir, ignore_errors=True)
    for info in archive.infolist():
        rel = info.filename.split("/", 1)[1] if "/" in info.filename else ""
        if info.is_dir() or not rel or rel in host.get("drop", []):
            continue
        data = archive.read(info)
        if os.path.splitext(rel)[1] in (".html", ".xml", ".txt", ".js", ".css"):
            text = data.decode("utf-8")
            for old, new in host.get("rewrite", {}).items():
                text = text.replace(old, new)
            if host.get("strip_tracking"):
                for pattern in TRACKING:
                    text = re.sub(pattern, "", text)
            if host.get("relative_links") and rel.endswith(".html"):
                # "/blog.html" only works at a domain root; make it relative to this file
                prefix = "../" * rel.count("/") or "./"
                text = re.sub(r"""((?:href|src|action)=["'])/(?=["'])""", lambda m: m.group(1) + prefix + "index.html", text)  # opened from disk, "./" is a folder listing
                text = re.sub(r"""((?:href|src|action)=["'])/(?!/)""", lambda m: m.group(1) + prefix, text)
            data = text.encode("utf-8")
        out = os.path.join(dest_dir, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as f:
            f.write(data)
    entry["open"] = host["to"].rstrip("/") + "/"
    if host.get("zip"):
        # fixed timestamps, so an unchanged site gives a byte-identical zip and no commit
        zip_path = os.path.join(ROOT, "downloads", host["zip"])
        os.makedirs(os.path.dirname(zip_path), exist_ok=True)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for base, _, files in sorted(os.walk(dest_dir)):
                for name in sorted(files):
                    path = os.path.join(base, name)
                    z.writestr(zipfile.ZipInfo(os.path.relpath(path, dest_dir).replace(os.sep, "/"), (2000, 1, 1, 0, 0, 0)),
                               open(path, "rb").read(), zipfile.ZIP_DEFLATED)
        entry["site_download"] = {"url": f"downloads/{host['zip']}", "size": os.path.getsize(zip_path), "type": "zip"}


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
    previous = load(CATALOG, {})
    # keep the old date when nothing changed, so a scheduled run makes no empty commit
    generated = previous.get("generated") if previous.get("apps") == apps else datetime.now(timezone.utc).strftime("%Y-%m-%d")
    os.makedirs(os.path.dirname(CATALOG), exist_ok=True)
    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump({"generated": generated, "apps": apps}, f, ensure_ascii=False, indent=2)
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
