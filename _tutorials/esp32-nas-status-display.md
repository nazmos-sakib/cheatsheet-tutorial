---
title: "A NAS status screen with the ESP32-S3-LCD-1.69"
description: Turn a Waveshare ESP32-S3-LCD-1.69 into a small desk screen that shows your Raspberry Pi NAS's CPU, RAM, temperature and disk space, and warns you with a beep when OpenMediaVault, Syncthing, Nextcloud or Tailscale stops or crashes.
tags: [raspberry-pi, nas, esp32, arduino, monitoring, systemd]
related: [raspberry-pi-nas-openmediavault, syncthing-sync-with-openmediavault, nextcloud-on-openmediavault, tailscale-remote-access-openmediavault, systemd-mount-ssd-at-boot]
tested_on: "Written for the Waveshare ESP32-S3-LCD-1.69 (ST7789V2, 240 x 280) with Arduino IDE 2, the esp32 board package 3.x, GFX Library for Arduino 1.6 and ArduinoJson 7, and a Raspberry Pi 4 running OpenMediaVault 8 with Syncthing and Nextcloud in Docker"
time: "About 45 minutes"
updated: 2026-10-24
---

Your NAS runs quietly in a cupboard, which is exactly what you want until something breaks. Syncthing stops after an update, the Nextcloud database container crashes at 3 a.m., or the SSD fills up, and you only notice days later when a file is missing. This tutorial turns a **Waveshare ESP32-S3-LCD-1.69**, a thumb-sized board with a 1.69-inch colour screen, into a little status screen for your desk. It shows how hard the Pi is working, and turns red and beeps the moment one of your services goes down.

By the end you will have:

- a small program on the Pi that checks the NAS every 10 seconds and starts by itself at boot,
- the ESP32 showing CPU, RAM, temperature and disk use as coloured bars,
- a green or red tile each for OMV, Syncthing, Nextcloud and Tailscale,
- a clear message with a beep when a service stops, crashes or the Pi itself stops answering,
- a list of what happened recently, so a crash at night is still on the screen in the morning.

This builds on [Build a NAS on a Raspberry Pi 4 with OpenMediaVault]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}), [Syncthing]({{ '/tutorials/syncthing-sync-with-openmediavault/' | relative_url }}) and [Nextcloud]({{ '/tutorials/nextcloud-on-openmediavault/' | relative_url }}). If you only run some of them, that's fine: step 2 shows how to leave the others out.

![Three screens of the status display: all good, a problem with Nextcloud, and the NAS not answering]({{ '/assets/img/esp32-nas-display-screens.png' | relative_url }})

## How it fits together
{: .no-step}

The ESP32 can't look inside the Pi by itself. It doesn't know what Docker is and can't run `systemctl`. So the work is split in two:

```text
  Raspberry Pi (NAS)                                  ESP32-S3-LCD-1.69
 ┌─────────────────────────────────┐                 ┌──────────────────┐
 │ nas-status.py (every 10 s)      │                 │                  │
 │  • CPU, RAM, temperature, disk  │   Wi-Fi, every  │  asks for the    │
 │  • systemctl: OMV, Tailscale    │◄────────────────┤  status, draws   │
 │  • docker: Syncthing, Nextcloud │    5 seconds    │  it, beeps on    │
 │  • remembers crashes            ├────────────────►│  problems        │
 │                                 │   JSON answer   │                  │
 │ http://nas.local:8099/status    │                 │                  │
 └─────────────────────────────────┘                 └──────────────────┘
```

- **On the Pi**, a Python script does all the checking and keeps the result ready as a small web page in **JSON**, a plain text format both programs can read. It only uses what comes with Python, so there's nothing to install, and **systemd** starts it at boot and restarts it if it ever stops.
- **The ESP32** joins your Wi-Fi, fetches that page every 5 seconds and draws it. It only needs to know the Pi's address.

This is the simplest way to do it. The ESP32 code stays short because it only draws, and all the "is it healthy?" logic lives on the Pi, where you can change it with a text editor without plugging in the board. It also means you can open the same page in a browser to see exactly what the screen sees.

It also catches the worst case: if the Pi itself hangs or loses power, nobody answers the ESP32, and after three missed answers the screen turns red with **NO ANSWER**.

**What counts as "down" and what counts as a "crash"?** The script checks each service in up to three ways:

| Check | Used for | What it notices |
|---|---|---|
| **systemd service is active** | OMV (`openmediavault-engined`, `nginx`, `smbd`), Tailscale (`tailscaled`) | The service stopped or failed. systemd also counts how often it restarted a crashed service. |
| **Docker container is running** | Syncthing (`syncthing`), Nextcloud (`nextcloud`, `nextcloud-db`, `nextcloud-redis`, `nextcloud-cron`) | The container exited, is stuck restarting, ran out of memory or is unhealthy. Docker counts how often it restarted a crashed container. |
| **Web page answers** | OMV's dashboard, Syncthing's health page, Nextcloud's `status.php` | The program runs but is stuck, or Nextcloud is in maintenance mode. |

A service that is **down** right now makes the screen red. A service that **crashed** and was restarted by Docker or systemd is working again, but the screen stays amber with "Syncthing crashed at 03:12" for an hour, so you still find out.

## What you need
{: .no-step}

| Thing | Notes |
|---|---|
| **Waveshare ESP32-S3-LCD-1.69** | The version without touch. The touch version (ESP32-S3-Touch-LCD-1.69) uses the same screen pins and works too. |
| **A USB-C data cable** | Some cables only charge. If your computer doesn't see the board, try another cable. |
| **A USB power supply** | Any phone charger, or a free USB port on the Pi, to power the board on your desk afterwards. |
| **A computer** with Arduino IDE 2 | Windows, macOS or Linux, to put the program on the board. |
| **Your NAS** | OpenMediaVault on a Raspberry Pi, set up as in the earlier tutorials, with SSH access. |
| **2.4 GHz Wi-Fi** | The ESP32 can't use 5 GHz networks. Most routers offer both under the same name, which works. |

## Check what runs on your NAS

The script needs three things from your NAS: the names of your Docker containers, the services OMV uses, and the path of your data drive. Log in over SSH (as `pi`, or whichever user you use for `sudo`):

```bash
ssh pi@nas.local
```

**Containers.** List all of them, running or not:

{% raw %}
```bash
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}'
```
{% endraw %}

```text
NAMES             STATUS
nextcloud-cron    Up 3 days
nextcloud         Up 3 days
nextcloud-redis   Up 3 days
nextcloud-db      Up 3 days (healthy)
syncthing         Up 3 days (healthy)
```

If you followed the Syncthing and Nextcloud tutorials, the names match these exactly, because their compose files set `container_name`. If yours differ, note them down for the next step.

**Services.** Check the ones the script will watch:

```bash
systemctl is-active openmediavault-engined nginx smbd tailscaled
```

You should see `active` four times. `openmediavault-engined` is OMV's engine that applies your settings, `nginx` serves the OMV dashboard, `smbd` serves your SMB shares and `tailscaled` is Tailscale. If one says `inactive` because you don't use it (for example, no SMB shares, or no Tailscale), you'll take it out in the next step.

**Data drive.** In the OMV dashboard, go to **Storage → File Systems** and look at the **Mount point** column, or list them over SSH:

```bash
ls -d /srv/dev-disk-by-*
```

```text
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc
```

That's the path the disk bar will watch. It's the same path that starts every **Absolute Path** in **Storage → Shared Folders**.

## Install the status script on the Pi

Create the script file:

```bash
sudo nano /usr/local/bin/nas-status.py
```

Paste the whole script below. Then, in the **Settings** part at the top, change `DATA_DRIVE` to your path from step 1, and if any of your container or service names are different, change them in `SERVICES`.

{% include file.html name="/usr/local/bin/nas-status.py" %}
```python
#!/usr/bin/env python3
"""nas-status: tells the ESP32 display how the NAS is doing.

Every few seconds it measures CPU, RAM, temperature and disk space, checks
that OMV, Syncthing, Nextcloud and Tailscale are running, and notices when
one of them crashes. The result is served as JSON on
http://<this-pi>:8099/status for the display to fetch.

It only uses Python's standard library, so there is nothing to install.
"""

import json
import os
import shutil
import socket
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------- Settings: change these to match your NAS ----------

PORT = 8099
CHECK_EVERY = 10  # seconds between checks

# Your data drive: the path from Storage -> File Systems in OMV.
# Use "/" to watch the microSD card instead.
DATA_DRIVE = "/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc"

# At or above these, the display turns amber.
LIMITS = {"cpu": 85, "ram": 90, "temp": 75, "disk": 90}

# How long a crash stays on the display after the service came back (seconds).
CRASH_MEMORY = 60 * 60

# What to check for each service:
#   units:      systemd services that must be "active"
#   containers: Docker containers that must be "running"
#   url:        a web address on the Pi that must answer
SERVICES = [
    {
        "name": "OMV",
        "units": ["openmediavault-engined", "nginx", "smbd"],
        "url": "http://127.0.0.1/",
    },
    {
        "name": "Syncthing",
        "containers": ["syncthing"],
        "url": "http://127.0.0.1:8384/rest/noauth/health",
    },
    {
        "name": "Nextcloud",
        "containers": ["nextcloud", "nextcloud-db", "nextcloud-redis", "nextcloud-cron"],
        "url": "http://127.0.0.1:8080/status.php",
    },
    {
        "name": "Tailscale",
        "units": ["tailscaled"],
    },
]

# ---------- End of settings ----------

lock = threading.Lock()
report = {"level": "ok", "alerts": [], "services": []}  # what /status returns
events = deque(maxlen=10)  # recent things that happened, newest first
crashes = {}  # service -> (when, text) of its latest crash
last_seen = {}  # restart counters from the previous check
was_down = {}  # service name -> problem, while it is down
cpu_samples = deque(maxlen=max(1, 60 // CHECK_EVERY))  # about one minute
last_cpu = None


def now():
    return time.strftime("%H:%M")


def add_event(text, level="info"):
    events.appendleft({"time": now(), "text": text, "level": level})


def crashed(service, detail):
    add_event(detail, "warn")
    crashes[service] = (time.time(), f"{service} crashed at {now()}")


def run(cmd):
    """Run a command and return what it printed, or None if it failed."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


# ---------- The Pi itself ----------

def cpu_percent():
    """CPU use since the previous call, from the counters in /proc/stat."""
    global last_cpu
    with open("/proc/stat") as f:
        values = [int(v) for v in f.readline().split()[1:9]]
    idle, total = values[3] + values[4], sum(values)
    previous, last_cpu = last_cpu, (idle, total)
    if previous is None or total == previous[1]:
        return 0
    return 100 * (1 - (idle - previous[0]) / (total - previous[1]))


def ram_percent():
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, value = line.split(":", 1)
            info[key] = int(value.split()[0])
    return 100 * (1 - info["MemAvailable"] / info["MemTotal"])


def temperature():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read()) / 1000
    except (OSError, ValueError):
        return 0


def disk_percent():
    try:
        usage = shutil.disk_usage(DATA_DRIVE)
    except OSError:
        return 0
    return 100 * usage.used / usage.total


def uptime():
    with open("/proc/uptime") as f:
        seconds = int(float(f.read().split()[0]))
    days, hours, minutes = seconds // 86400, seconds // 3600 % 24, seconds // 60 % 60
    return f"{days}d {hours}h" if days else f"{hours}h {minutes}m"


def power_problem():
    """Ask the Pi's firmware whether the power supply is struggling."""
    out = run(["vcgencmd", "get_throttled"])  # prints e.g. throttled=0x50005
    if not out or "=" not in out:
        return None
    flags = int(out.strip().split("=")[1], 16)
    if flags & 0x1:
        return "Power supply too weak"
    if flags & 0x4:
        return "CPU slowed down (heat/power)"
    return None


# ---------- Services ----------

def check_unit(service, unit, problems):
    out = run(["systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState",
               "-p", "Result", "-p", "NRestarts"])
    if out is None:
        problems.append(f"can't ask systemd about {unit}")
        return
    status = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if status.get("LoadState") == "not-found":
        problems.append(f"{unit} not installed")
        return

    # systemd counts the times it restarted a crashed service
    restarts = int(status.get("NRestarts") or 0)
    key = "unit:" + unit
    if key in last_seen and restarts > last_seen[key]:
        crashed(service, f"{unit} crashed, systemd restarted it")
    last_seen[key] = restarts

    state = status.get("ActiveState", "unknown")
    if state == "failed":
        problems.append(f"{unit} failed ({status.get('Result', '?')})")
    elif state not in ("active", "reloading"):
        problems.append(f"{unit} {state}")


def check_container(service, name, problems):
    out = run(["docker", "inspect", name])
    if out is None:
        problems.append(f"{name} container missing")
        return
    info = json.loads(out)[0]
    state, restarts = info["State"], info.get("RestartCount", 0)

    # Docker counts the times it restarted a crashed container. A new start
    # time without a crash means someone restarted or updated it.
    key = "container:" + name
    if key in last_seen:
        old_restarts, old_started = last_seen[key]
        if restarts > old_restarts:
            crashed(service, f"{name} crashed, Docker restarted it")
        elif state["StartedAt"] != old_started and state["Running"]:
            add_event(f"{name} was restarted")
    last_seen[key] = (restarts, state["StartedAt"])

    if state["Status"] != "running":
        why = f"{name} {state['Status']}"
        if state.get("OOMKilled"):
            why += ", out of memory"
        elif state.get("ExitCode"):
            why += f", code {state['ExitCode']}"
        problems.append(why)
    elif (state.get("Health") or {}).get("Status") == "unhealthy":
        problems.append(f"{name} unhealthy")


def check_url(url):
    """Return a problem, or None if the page answered properly."""
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = response.read(4000)
    except urllib.error.HTTPError as e:
        # 4xx (like "login required") still means the server is alive
        return f"web page error {e.code}" if e.code >= 500 else None
    except Exception:
        return "web page not answering"
    try:
        data = json.loads(body)
    except ValueError:
        return None  # an ordinary web page: answering is enough
    if not isinstance(data, dict):
        return None
    if data.get("maintenance"):
        return "in maintenance mode"
    if data.get("installed") is False:
        return "not installed yet"
    if data.get("status", "OK") != "OK":
        return f"says {data['status']}"
    return None


def check_service(service):
    name = service["name"]
    problems = []
    for unit in service.get("units", []):
        check_unit(name, unit, problems)
    for container in service.get("containers", []):
        check_container(name, container, problems)
    if not problems and service.get("url"):
        problem = check_url(service["url"])
        if problem:
            problems.append(problem)

    problem = ""
    if problems:
        problem = problems[0] + (f" (+{len(problems) - 1} more)" if len(problems) > 1 else "")

    # Remember when it goes down and comes back
    if problem and name not in was_down:
        add_event(f"{name} DOWN: {problem}", "crit")
    elif not problem and name in was_down:
        add_event(f"{name} is back up")
    if problem:
        was_down[name] = problem
    else:
        was_down.pop(name, None)
    return {"name": name, "ok": not problem, "problem": problem}


# ---------- Putting it together ----------

def check_everything():
    cpu_samples.append(cpu_percent())
    stats = {
        "cpu": sum(cpu_samples) / len(cpu_samples),  # average over a minute
        "ram": ram_percent(),
        "temp": temperature(),
        "disk": disk_percent(),
    }
    services = [check_service(s) for s in SERVICES]

    alerts = []
    for s in services:
        if not s["ok"]:
            alerts.append({"level": "crit", "text": f"{s['name']} DOWN: {s['problem']}"})
    if not os.path.ismount(DATA_DRIVE):
        alerts.append({"level": "crit", "text": "Data drive is not mounted"})

    labels = {"cpu": ("CPU", "%"), "ram": ("RAM", "%"), "temp": ("Temperature", "C"),
              "disk": ("Disk", "%")}
    for key, limit in LIMITS.items():
        if stats[key] >= limit:
            label, unit = labels[key]
            alerts.append({"level": "warn", "text": f"{label} high: {stats[key]:.0f}{unit}"})
    power = power_problem()
    if power:
        alerts.append({"level": "warn", "text": power})

    cutoff = time.time() - CRASH_MEMORY
    for service, (when, text) in list(crashes.items()):
        if when < cutoff:
            del crashes[service]
        else:
            alerts.append({"level": "warn", "text": text})

    if any(a["level"] == "crit" for a in alerts):
        level = "crit"
    elif alerts:
        level = "warn"
    else:
        level = "ok"

    return {
        "host": socket.gethostname(),
        "time": now(),
        "uptime": uptime(),
        "level": level,
        **{key: round(value) for key, value in stats.items()},
        "limits": LIMITS,
        "services": services,
        "alerts": alerts,
        "events": list(events)[:5],
    }


def checker():
    global report
    cpu_percent()  # the first reading only sets the starting point
    time.sleep(1)
    while True:
        try:
            fresh = check_everything()
        except Exception as e:
            traceback.print_exc()
            fresh = {"level": "warn", "time": now(), "services": [],
                     "alerts": [{"level": "warn", "text": f"nas-status error: {e}"}]}
        with lock:
            report = fresh
        time.sleep(CHECK_EVERY)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") not in ("", "/status"):
            self.send_error(404)
            return
        with lock:
            body = json.dumps(report, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # don't fill the log with a line every 5 seconds


if __name__ == "__main__":
    threading.Thread(target=checker, daemon=True).start()
    print(f"nas-status is listening on port {PORT}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
```

Save with `Ctrl+O`, `Enter`, and leave with `Ctrl+X`.

What the settings mean:

- **`PORT`** is where the status page lives: `http://nas.local:8099/status`. Any free port works; 8099 isn't used by OMV, Syncthing or Nextcloud.
- **`CHECK_EVERY`** is how often the script checks, in seconds. 10 is light on a Pi; each round takes a fraction of a second.
- **`DATA_DRIVE`** is the drive the DISK bar shows. If it's ever not mounted (the drive was unplugged or failed), the screen turns red with "Data drive is not mounted", because your shares and containers are then writing to the microSD card instead.
- **`LIMITS`** are the percentages (and the temperature in °C) at which a bar turns red and the screen turns amber. The CPU uses the average over the last minute, so a short burst while Nextcloud makes thumbnails doesn't set it off.
- **`CRASH_MEMORY`** is how long a crash stays on the screen after the service is back: one hour.
- **`SERVICES`** is the list of tiles on the screen, in order, at most four. Each one has a `name` (up to 9 letters fit on a tile) and any of `units`, `containers` and `url`. To leave a service out, delete its whole `{ ... },` block. To leave out one part, delete just that name, for example `"smbd"` if you have no SMB shares.

**Try it by hand** before making it permanent:

```bash
sudo python3 /usr/local/bin/nas-status.py
```

```text
nas-status is listening on port 8099
```

Leave it running and open a second SSH window (or use your browser, see the next step). Ask it for the status:

```bash
curl http://127.0.0.1:8099/status
```

You get a block of JSON. Look for `"level": "ok"` and an empty `"alerts": []`. If `level` says `crit`, read the `alerts`: they say exactly what the script thinks is wrong, for example `"Syncthing DOWN: syncthing container missing"` when the container name doesn't match. Fix the name in the script, stop it with `Ctrl+C` in the first window and run it again.

{% include callout.html type="note" title="Why does it need sudo?" text="Asking Docker about containers needs root, or membership of the `docker` group, which is the same thing in practice. The script only *reads*: it runs `docker inspect`, `systemctl show` and reads files in `/proc`, and the web page has no way to send it commands. The page only shows numbers and service names, but it is reachable by anyone on your home network and tailnet, which is also why it never includes passwords or file names." %}

## Start it at boot with systemd

Running it by hand stops when you log out. A **service unit** lets systemd start it at every boot and restart it if it ever crashes itself. (How unit files work is explained in [Writing systemd units]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}).) Stop the test with `Ctrl+C` first, then create the unit:

```bash
sudo nano /etc/systemd/system/nas-status.service
```

{% include file.html name="/etc/systemd/system/nas-status.service" %}
```ini
[Unit]
Description=NAS status page for the ESP32 display
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /usr/local/bin/nas-status.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- **`After=... docker.service`** starts it once Docker is up, so the first check doesn't report every container as missing.
- **`Restart=always`** brings it back 5 seconds after it stops for any reason.
- **`WantedBy=multi-user.target`** is what `enable` hooks into: start this at every normal boot.

Load the new file, then enable and start the service in one go:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nas-status
systemctl status nas-status
```

```text
● nas-status.service - NAS status page for the ESP32 display
     Loaded: loaded (/etc/systemd/system/nas-status.service; enabled; preset: enabled)
     Active: active (running) since Thu 2026-10-22 14:02:11 CEST; 5s ago
```

**After you change the script** later (new limits, another service), restart it to load the changes:

```bash
sudo systemctl restart nas-status
```

## Look at the status page in a browser

On any computer on your home network, open:

```text
http://nas.local:8099/status
```

Firefox shows the JSON neatly with a **Raw Data** tab; Chrome and Safari show it as plain text. This is exactly what the ESP32 will see, so it's the first place to look whenever the screen shows something odd:

```json
{
  "host": "nas",
  "time": "14:32",
  "uptime": "12d 4h",
  "level": "ok",
  "cpu": 7,
  "ram": 43,
  "temp": 52,
  "disk": 61,
  "services": [
    { "name": "OMV", "ok": true, "problem": "" },
    { "name": "Syncthing", "ok": true, "problem": "" },
    ...
  ],
  "alerts": [],
  "events": [
    { "time": "09:14", "text": "syncthing was restarted", "level": "info" }
  ]
}
```

- **`level`** is the overall state: `ok` (green), `warn` (amber: something is high, or crashed recently) or `crit` (red: a service is down).
- **`alerts`** is the list of things wrong right now. The screen shows them one at a time.
- **`events`** is what happened recently, newest first: services going down and coming back, crashes, restarts. The screen shows the latest one when there are no alerts.

The ESP32 will use the Pi's **IP address** rather than `nas.local`, because the ESP32 can't look up `.local` names reliably. Find it with:

```bash
hostname -I
```

The first address, like `192.168.1.50`, is the one. Thanks to the DHCP reservation from the NAS tutorial, it never changes. Check the page opens as `http://192.168.1.50:8099/status` too.

## Set up the Arduino IDE for the ESP32-S3

Now the board. You'll program it with the **Arduino IDE**, which turns the code into something the ESP32 runs and copies it over USB.

1. Download and install **Arduino IDE 2** from [arduino.cc/en/software](https://www.arduino.cc/en/software).
2. Open it, go to **File → Preferences** (on macOS **Arduino IDE → Settings**) and paste this into **Additional boards manager URLs**:

   ```text
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```

3. Click **OK**. Open the **Boards Manager** (the second icon in the left bar), search for `esp32` and install **esp32 by Espressif Systems**, version 3.0 or newer. It's a big download, a few hundred MB.
4. Open the **Library Manager** (the icon below it) and install two libraries:
   - **GFX Library for Arduino** by Moon On Our Nation. It draws on the screen. If it asks to install dependencies too, click **Install all**.
   - **ArduinoJson** by Benoit Blanchon, version 7. It reads the Pi's answer.
5. Plug the board into your computer with the USB-C cable. Under **Tools**, set:

| Setting | Value |
|---|---|
| **Board** | **esp32 → ESP32S3 Dev Module** |
| **Port** | The new port that appeared when you plugged the board in (`COM3` on Windows, `/dev/cu.usbmodem…` on macOS, `/dev/ttyACM0` on Linux) |
| **USB CDC On Boot** | **Enabled**, so you can see messages in the Serial Monitor |
| **Flash Size** | **16MB (128Mb)** |
| **PSRAM** | **OPI PSRAM** |

Leave everything else as it is.

{% include callout.html type="tip" title="No port shows up?" text="Try a different cable first: many USB-C cables only carry power. If it still doesn't appear, put the board in download mode: hold the **BOOT** button, press and release **RESET**, then let go of BOOT. On Linux, also add yourself to the `dialout` group with `sudo usermod -aG dialout $USER` and log out and back in." %}

## Put the display program on the board

1. In the Arduino IDE, choose **File → New Sketch**, delete what's in it and paste the program below.
2. Change the three lines under **Change these**: your Wi-Fi name and password, and the Pi's IP address from step 4 in `STATUS_URL`.
3. Save it as `nas-display` (**File → Save**).
4. Click **Upload** (the arrow button). The first build takes a minute or two; later ones are faster. When the bottom panel says `Hard resetting via RTS pin...`, it's done.

{% include file.html name="nas-display.ino" %}
```cpp
/*
  nas-display: shows how the NAS is doing on a Waveshare ESP32-S3-LCD-1.69.

  Every few seconds it fetches http://<nas>:8099/status (served by
  nas-status.py on the Pi) and draws CPU, RAM, temperature, disk space,
  the services and any alerts. It beeps when something goes wrong.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>

// ---------- Change these ----------
const char *WIFI_SSID = "your-wifi-name";
const char *WIFI_PASS = "your-wifi-password";
const char *STATUS_URL = "http://192.168.1.50:8099/status";
const uint32_t POLL_MS = 5000;   // how often to ask the NAS
const bool BEEP = true;          // beep when something goes wrong
const uint8_t BRIGHTNESS = 200;  // 0 (off) to 255 (full)
const uint32_t WIFI_RETRY_MS = 30000;          // without Wi-Fi: try again this often
const uint32_t WIFI_REBOOT_MS = 30UL * 60000;  // and restart the board after this long

// ---------- Board pins (Waveshare ESP32-S3-LCD-1.69) ----------
#define LCD_DC 4
#define LCD_CS 5
#define LCD_SCK 6
#define LCD_MOSI 7
#define LCD_RST 8
#define LCD_BL 15
#define BUZZER 42

#define W 240
#define H 280

Arduino_DataBus *bus = new Arduino_ESP32SPI(LCD_DC, LCD_CS, LCD_SCK, LCD_MOSI);
Arduino_GFX *panel = new Arduino_ST7789(bus, LCD_RST, 0 /* rotation */, true /* IPS */,
                                        W, H, 0, 20, 0, 20);
// Draw into memory first, then send the finished picture: no flicker
Arduino_Canvas *gfx = new Arduino_Canvas(W, H, panel);

// Colours in RGB565, the format the screen uses
const uint16_t C_BLACK = 0x0000;
const uint16_t C_WHITE = 0xFFFF;
const uint16_t C_GREY = 0x8410;
const uint16_t C_DARK = 0x2124;
const uint16_t C_GREEN = 0x07E0;
const uint16_t C_AMBER = 0xFD20;
const uint16_t C_RED = 0xF800;

JsonDocument nas;         // the last good answer from the NAS
bool haveData = false;    // have we had one yet?
int failures = 0;         // failed requests in a row
uint32_t lastGood = 0;    // millis() of the last good answer
uint32_t lastPoll = 0;    // millis() of the last request
int lastLevel = 0;        // 0 all good, 1 warning, 2 problem
unsigned alertIndex = 0;  // which alert to show when there are several
uint32_t wifiLostAt = 0;  // millis() when Wi-Fi went away, 0 while connected
uint32_t lastWifiTry = 0; // millis() of the last attempt to join

// ---------- Small drawing helpers ----------

// The built-in font is 6 x 8 pixels, times the text size
void printCenter(int y, const String &s, int size) {
  gfx->setTextSize(size);
  gfx->setCursor((W - (int)s.length() * 6 * size) / 2, y);
  gfx->print(s);
}

void printRight(int right, int y, const String &s, int size) {
  gfx->setTextSize(size);
  gfx->setCursor(right - (int)s.length() * 6 * size, y);
  gfx->print(s);
}

// Split text into lines of at most n characters, breaking at spaces
int wrap(String text, int n, String lines[], int maxLines) {
  int count = 0;
  text.trim();
  while (text.length() > 0 && count < maxLines) {
    if ((int)text.length() <= n) {
      lines[count++] = text;
      return count;
    }
    int cut = text.lastIndexOf(' ', n);
    if (cut <= 0) cut = n;
    lines[count++] = text.substring(0, cut);
    text = text.substring(cut);
    text.trim();
  }
  // Didn't fit: end the last line with ".."
  if (text.length() > 0 && count > 0) {
    String &last = lines[count - 1];
    if ((int)last.length() > n - 2) last = last.substring(0, n - 2);
    last += "..";
  }
  return count;
}

int levelNumber(const char *level) {
  if (strcmp(level, "crit") == 0) return 2;
  if (strcmp(level, "warn") == 0) return 1;
  return 0;
}

// Green when fine, amber when getting close to the limit, red over it
uint16_t colourFor(int value, int limit) {
  if (value >= limit) return C_RED;
  if (value >= limit - 15) return C_AMBER;
  return C_GREEN;
}

// One row: label, bar and value. "full" is the value that fills the bar.
void drawMetric(int y, const char *label, int value, const char *unit, int limit, int full) {
  uint16_t colour = colourFor(value, limit);
  gfx->setTextColor(C_WHITE);
  gfx->setTextSize(2);
  gfx->setCursor(12, y);
  gfx->print(label);

  const int barX = 64, barW = 112, barH = 14;
  gfx->fillRoundRect(barX, y + 1, barW, barH, 4, C_DARK);
  int filled = constrain(value, 0, full) * barW / full;
  if (filled >= 8) gfx->fillRoundRect(barX, y + 1, filled, barH, 4, colour);
  else if (filled > 0) gfx->fillRect(barX, y + 1, filled, barH, colour);

  gfx->setTextColor(colour);
  printRight(230, y, String(value) + unit, 2);
}

// One service as a green or red tile
void drawService(int x, int y, JsonObject service) {
  bool ok = service["ok"] | false;
  gfx->fillRoundRect(x, y, 112, 28, 6, ok ? C_GREEN : C_RED);
  gfx->setTextColor(ok ? C_BLACK : C_WHITE);
  String name = service["name"] | "?";
  if (name.length() > 9) name = name.substring(0, 9);
  gfx->setTextSize(2);
  gfx->setCursor(x + (112 - (int)name.length() * 12) / 2, y + 7);
  gfx->print(name);
}

// ---------- Screens ----------

// The normal screen, drawn from the NAS's answer
int drawStatus() {
  int level = levelNumber(nas["level"] | "ok");
  uint16_t levelColour = level == 2 ? C_RED : level == 1 ? C_AMBER : C_GREEN;
  JsonArray alerts = nas["alerts"];
  gfx->fillScreen(C_BLACK);

  // Header: the overall state
  gfx->fillRect(0, 0, W, 34, levelColour);
  gfx->setTextColor(level == 2 ? C_WHITE : C_BLACK);
  printCenter(10, level == 2 ? "PROBLEM" : level == 1 ? "WARNING" : "ALL GOOD", 2);
  if (alerts.size() > 1) {
    alertIndex %= alerts.size();
    printRight(226, 10, String(alertIndex + 1) + "/" + String(alerts.size()), 2);
  }

  // The Pi itself
  JsonObject limits = nas["limits"];
  drawMetric(44, "CPU", nas["cpu"] | 0, "%", limits["cpu"] | 85, 100);
  drawMetric(68, "RAM", nas["ram"] | 0, "%", limits["ram"] | 90, 100);
  drawMetric(92, "TEMP", nas["temp"] | 0, "C", limits["temp"] | 75, 90);
  drawMetric(116, "DISK", nas["disk"] | 0, "%", limits["disk"] | 90, 100);

  // Services, two per row
  JsonArray services = nas["services"];
  for (int i = 0; i < (int)services.size() && i < 4; i++) {
    drawService(i % 2 == 0 ? 6 : 122, 146 + (i / 2) * 32, services[i]);
  }

  // Bottom: the alerts one at a time, or uptime and the latest event
  String lines[3];
  if (alerts.size() > 0) {
    alertIndex %= alerts.size();
    JsonObject alert = alerts[alertIndex];
    uint16_t colour = levelNumber(alert["level"] | "warn") == 2 ? C_RED : C_AMBER;
    gfx->drawRoundRect(8, 212, 224, 62, 8, colour);
    gfx->drawRoundRect(9, 213, 222, 60, 7, colour);
    gfx->setTextColor(colour);
    int count = wrap(alert["text"] | "", 17, lines, 3);
    for (int i = 0; i < count; i++) {
      gfx->setTextSize(2);
      gfx->setCursor(18, 218 + i * 18);
      gfx->print(lines[i]);
    }
    alertIndex++;  // show the next one next time
  } else {
    gfx->setTextColor(C_GREY);
    String up = String("Up ") + (nas["uptime"] | "?") + "  " + (nas["time"] | "");
    printCenter(218, up, 2);
    JsonObject event = nas["events"][0];
    String latest = event.isNull() ? String("No events yet")
                                   : String(event["time"] | "") + " " + (event["text"] | "");
    int count = wrap(latest, 17, lines, 2);
    for (int i = 0; i < count; i++) printCenter(240 + i * 18, lines[i], 2);
  }

  gfx->flush();
  return level;
}

// A full-screen message, for when there is nothing else to show
void drawMessage(uint16_t bg, uint16_t fg, const String &big, const String &line1,
                 const String &line2) {
  gfx->fillScreen(bg);
  gfx->setTextColor(fg);
  printCenter(96, big, 3);
  printCenter(136, line1, 2);
  printCenter(160, line2, 2);
  gfx->flush();
}

// ---------- Talking to the NAS ----------

bool askNas() {
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(3000);
  if (!http.begin(STATUS_URL)) return false;
  int code = http.GET();
  bool ok = false;
  if (code == 200) {
    JsonDocument fresh;
    DeserializationError error = deserializeJson(fresh, http.getString());
    if (!error) {
      nas = fresh;
      ok = true;
    } else {
      Serial.printf("Bad answer from the NAS: %s\n", error.c_str());
    }
  } else {
    Serial.printf("NAS request failed: %d %s\n", code, http.errorToString(code).c_str());
  }
  http.end();
  return ok;
}

void beep(int times) {
  if (!BEEP) return;
  for (int i = 0; i < times; i++) {
    tone(BUZZER, 2700, 120);
    delay(220);
  }
}

String ago(uint32_t ms) {
  uint32_t s = ms / 1000;
  return s < 120 ? "for " + String(s) + " sec" : "for " + String(s / 60) + " min";
}

// Returns true when Wi-Fi is up. While it's down, keeps trying to join
// again, and restarts the board if that hasn't worked for a long time.
bool keepWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiLostAt = 0;
    return true;
  }
  uint32_t now = millis();
  if (wifiLostAt == 0) {
    wifiLostAt = now;
    lastWifiTry = now;
  }
  if (now - lastWifiTry >= WIFI_RETRY_MS) {
    Serial.println("No Wi-Fi, trying to join again");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    lastWifiTry = now;
  }
  if (now - wifiLostAt >= WIFI_REBOOT_MS) {
    Serial.println("No Wi-Fi for a long time, restarting");
    delay(100);
    ESP.restart();
  }
  return false;
}

// ---------- Arduino's setup() and loop() ----------

void setup() {
  Serial.begin(115200);
  if (!gfx->begin()) Serial.println("The display did not start");
  pinMode(LCD_BL, OUTPUT);
  analogWrite(LCD_BL, BRIGHTNESS);

  drawMessage(C_BLACK, C_WHITE, "HELLO", "joining WiFi", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  Serial.print("WiFi status: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "not connected");
}

void loop() {
  if (lastPoll != 0 && millis() - lastPoll < POLL_MS) {
    delay(20);
    return;
  }
  lastPoll = millis();

  int level;
  if (!keepWifi()) {
    drawMessage(C_AMBER, C_BLACK, "NO WIFI", WIFI_SSID, ago(millis() - wifiLostAt));
    level = 1;
  } else {
    if (askNas()) {
      failures = 0;
      lastGood = millis();
      haveData = true;
    } else {
      failures++;
    }

    if (failures >= 3) {
      // Three misses in a row: the Pi, its network or nas-status is down
      drawMessage(C_RED, C_WHITE, "NO ANSWER", "from the NAS",
                  haveData ? ago(millis() - lastGood) : "since start");
      level = 2;
    } else if (!haveData) {
      drawMessage(C_BLACK, C_WHITE, "HELLO", "asking the NAS", "...");
      level = 0;
    } else {
      level = drawStatus();
    }
  }

  // Beep once for a new warning, twice for a new problem
  if (level > lastLevel) beep(level);
  lastLevel = level;
}
```

The screen says **HELLO / joining WiFi**, then **asking the NAS**, and within a few seconds shows the status. If it doesn't, open **Tools → Serial Monitor**, set it to **115200 baud**, and press RESET on the board: it prints the IP address it got from your router, and why a request to the NAS failed.

What the important parts do:

- **The pins under "Board pins"** are where the screen and buzzer are wired on this board: the screen talks over SPI on GPIO 4 to 8, its backlight is on GPIO 15 and the buzzer on GPIO 42. You don't need to change them.
- **`Arduino_ST7789(... 240, 280, 0, 20, 0, 20)`** describes the screen: an ST7789 chip with 240 by 280 pixels. The chip itself has room for 320 rows; the `20`s tell it which part of that the glass actually shows, so nothing is cut off at the top or bottom.
- **`Arduino_Canvas`** draws each new picture in the ESP32's memory first and sends it to the screen in one go. Without it, you'd see the screen flicker black every 5 seconds.
- **`askNas()`** fetches the page, and only replaces the last good answer if the new one could be read. **`drawStatus()`** draws it.
- **`keepWifi()`** looks after the Wi-Fi. The ESP32's own automatic reconnect doesn't always kick in, for example when the network wasn't there at all when the board started, so whenever Wi-Fi is down the sketch tries to join again every 30 seconds (`WIFI_RETRY_MS`), as long as it takes. If that still hasn't worked after 30 minutes (`WIFI_REBOOT_MS`), it restarts the board as a last resort, which clears up a Wi-Fi chip that got stuck. Nothing is lost by that, because everything worth keeping lives on the Pi.
- **`failures >= 3`** is the "NAS isn't answering" rule. One missed answer can be a Wi-Fi hiccup; three in a row (15 seconds) means the Pi, its network or the script is down.
- **`beep(level)`** beeps once when things get worse to amber, and twice when they get worse to red. It doesn't beep again while the problem lasts, only when the next new thing happens.

## Read the screen

Look again at the picture at the top of this page. From top to bottom:

1. **The header** shows the overall state: green **ALL GOOD**, amber **WARNING** or red **PROBLEM**. With several alerts, `1/3` on the right says which one you're looking at; they take turns every 5 seconds.
2. **Four bars**: CPU (average over the last minute), RAM in use, the CPU temperature, and how full the data drive is. Each turns amber 15 points before its limit and red at it.
3. **Four tiles**, one per service: green when every check passes, red when one fails.
4. **The bottom box**: the current alert, word-wrapped, in red or amber. When there are no alerts, it shows the NAS's uptime, its clock, and the latest event, such as `09:14 syncthing was restarted`.

The full-screen messages:

| Screen | Meaning |
|---|---|
| **HELLO / joining WiFi** | Just switched on, connecting. |
| **HELLO / asking the NAS** | Connected, waiting for the first answer. |
| Amber **NO WIFI** | No Wi-Fi, with the network name and for how long. It tries to join again every 30 seconds and restarts itself after 30 minutes, so it comes back on its own once the router is back, even after hours. |
| Red **NO ANSWER / from the NAS** | Three requests in a row failed. The Pi is off, hung or unreachable, or `nas-status` isn't running. It says for how long. |

## Test the alerts

Don't wait for a real problem to find out whether this works. Try each kind on purpose; each one takes under a minute.

**A service that stops.** Stop Syncthing:

```bash
sudo docker stop syncthing
```

Within about 15 seconds the screen turns red and beeps twice, the Syncthing tile turns red and the box says `Syncthing DOWN: syncthing exited`. Start it again:

```bash
sudo docker start syncthing
```

The tile turns green, the screen goes back to **ALL GOOD**, and the bottom shows `Syncthing is back up`.

**A crash.** A real crash is the program dying without being asked to, and Docker restarting it. Simulate that by killing Syncthing's process from outside the container:

{% raw %}
```bash
sudo kill -9 $(sudo docker inspect -f '{{.State.Pid}}' syncthing)
```
{% endraw %}

Docker notices, restarts it within a second or two, and counts the restart. The screen turns amber with one beep and shows `Syncthing crashed at 14:38`, even though Syncthing is already running again. That stays for an hour (`CRASH_MEMORY`), and the full story is in the page's `events`.

**A system service.** Stop SMB, check the OMV tile turns red, and start it again:

```bash
sudo systemctl stop smbd
sudo systemctl start smbd
```

**The whole NAS.** Stop the status script itself:

```bash
sudo systemctl stop nas-status
```

After about 15 seconds: red **NO ANSWER**. This is what you'd see if the Pi froze or lost power. Start it again with `sudo systemctl start nas-status`.

## Change what it watches (optional)

Everything about *what* is checked lives in the script on the Pi, so you never have to re-flash the ESP32 for it. Edit the file, then restart the service:

```bash
sudo nano /usr/local/bin/nas-status.py
sudo systemctl restart nas-status
```

**Watch a different container.** Say you replace Tailscale's tile with a Jellyfin container called `jellyfin` that serves its web page on port 8096. Replace the Tailscale block in `SERVICES` with:

```python
    {
        "name": "Jellyfin",
        "containers": ["jellyfin"],
        "url": "http://127.0.0.1:8096/health",
    },
```

The screen has room for four tiles. If you list more services, the extra ones are still checked and still raise alerts, they just don't get a tile.

**Make it more or less sensitive.** Raise or lower the numbers in `LIMITS`. For a Pi 4 in a case without a fan, `"temp": 80` avoids amber on warm summer days; the Pi only slows itself down at 80 to 85 °C.

**Silence the beep or dim the screen.** These two live on the ESP32, in the **Change these** part of the sketch: set `BEEP = false` or lower `BRIGHTNESS` (for example `60` for a bedroom), and upload again.

**Under-voltage warnings for free.** If the Pi's power supply is too weak, which is common with an SSD on USB, the screen shows `Power supply too weak` in amber. The script asks the Pi's firmware with `vcgencmd get_throttled`. If you see this, use the official 5.1 V, 3 A power supply or give the SSD a powered USB hub.

## Troubleshooting
{: .no-step}

- **The screen stays black.** Check the backlight works: it should glow even before anything is drawn. If the Serial Monitor shows `The display did not start`, check **PSRAM** is set to **OPI PSRAM** and **Flash Size** to **16MB** in the Tools menu, and upload again.
- **The picture is shifted, with a stripe of noise at the top or bottom.** The row offsets in `Arduino_ST7789(...)` don't match the screen. They must be `0, 20, 0, 20` for this board.
- **Colours are inverted (black is white).** The `true /* IPS */` in the same line is missing or `false`.
- **Upload fails with `No serial data received` or `Failed to connect`.** Put the board into download mode (hold **BOOT**, press **RESET**, let go of BOOT) and click **Upload** again. Afterwards press **RESET** once to start the new program.
- **It stays on HELLO / joining WiFi, then shows NO WIFI.** The Wi-Fi name or password is wrong (both are case-sensitive), or the network is 5 GHz only. Check your router has 2.4 GHz turned on.
- **It shows NO ANSWER, but the NAS is fine.** Open `http://<the IP in STATUS_URL>:8099/status` in a browser on the same network. If that fails too, check `systemctl status nas-status` on the Pi. If the browser works, the IP in `STATUS_URL` has a typo, or the board is on a separate guest Wi-Fi that can't reach your other devices; the Serial Monitor prints the exact error.
- **A tile is red but the service works fine.** Read the alert or open the status page: the `problem` says which check failed. `container missing` means the container name in `SERVICES` doesn't match `sudo docker ps -a`. `not installed` means that systemd service doesn't exist on your NAS (for example `smbd` with SMB never enabled); delete it from the list.
- **Nextcloud is red with "web page not answering" or "web page error 503".** Check the `ports:` line in your Nextcloud compose file: the script expects `127.0.0.1:8080:80`. If you use a different port, change it in the `url` too. A Nextcloud that's still upgrading after an update also answers 503 for a few minutes.
- **Nextcloud shows "in maintenance mode".** Nextcloud really is in maintenance mode, usually left over from an interrupted update. Turn it off with `occ maintenance:mode --off` (see the Nextcloud tutorial for the `occ` shortcut).
- **Every time I update a container, the screen shows "was restarted".** That's expected and harmless: it's an event, not an alert, and doesn't change the colour. Only restarts that Docker did by itself after a crash count as crashes.
- **The times on the screen are wrong.** They come from the Pi's clock. Set your time zone in OMV under **System → Date & Time** and turn on **Use NTP server**, then `sudo systemctl restart nas-status`.
- **`curl` says `Connection refused` on the Pi itself.** The script isn't running. `journalctl -u nas-status -n 30` shows why, usually a typo made while editing the settings (Python is strict about commas and quotes).
