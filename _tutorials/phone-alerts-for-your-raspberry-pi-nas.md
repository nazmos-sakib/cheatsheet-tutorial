---
title: "Get a phone alert when your Raspberry Pi NAS breaks"
description: Get a push notification on your phone when Syncthing, Nextcloud or OpenMediaVault stops, when a disk is failing or full, or when the whole Pi goes offline, using ntfy, Uptime Kuma, healthchecks.io and OMV's own email alerts.
tags: [raspberry-pi, nas, monitoring, docker, notifications, systemd]
related: [esp32-nas-status-display, raspberry-pi-nas-openmediavault, tailscale-remote-access-openmediavault, syncthing-sync-with-openmediavault, nextcloud-on-openmediavault, systemd-mount-ssd-at-boot]
tested_on: "Written for OpenMediaVault 8 with the compose plugin on a Raspberry Pi 4, Uptime Kuma 2 in Docker, the ntfy app for Android and iOS with the free ntfy.sh server, and the free healthchecks.io plan"
time: "About 45 minutes"
updated: 2026-10-24
---

With Tailscale you can SSH into your NAS from anywhere in seconds. The problem is knowing *when* to. Syncthing can stop after an update, the Nextcloud database can crash at night, the SSD can fill up or start failing, or a power cut can switch the whole Pi off, and you only find out days later when a file is missing. This tutorial makes the NAS tell you instead, with a push notification on your phone a few minutes after something goes wrong, wherever you are.

By the end you will have:

- the **ntfy** app on your phone, receiving alerts from the NAS (free, no account needed),
- **Uptime Kuma** on the NAS, checking OMV, Syncthing and every Nextcloud container once a minute, with a dashboard you can open over Tailscale,
- **healthchecks.io** watching from the outside, so you hear about it even when the whole Pi is off, frozen or offline,
- **OMV's own email alerts** for failing disks, full file systems and system services,
- optionally, an alert for any systemd service that fails, such as Tailscale itself,
- a list of what each alert means and the first commands to run when you SSH in.

This builds on [Build a NAS on a Raspberry Pi 4 with OpenMediaVault]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}), with the compose plugin set up as in [Sync your devices with Syncthing]({{ '/tutorials/syncthing-sync-with-openmediavault/' | relative_url }}) or [Run your own cloud with Nextcloud]({{ '/tutorials/nextcloud-on-openmediavault/' | relative_url }}). It works with either or both of them; skip the checks for whatever you don't run.

## How it fits together
{: .no-step}

No single tool can catch everything, because **a Pi can't report its own death**. If it loses power, nothing running on it can send anything. So the work is split between watchers on the Pi and one watcher outside it:

```text
                         ┌──────────────────────── your Pi ───────────────────────┐
                         │                                                        │
 ntfy app  ◄── ntfy.sh ◄─┤ Uptime Kuma: are OMV, Syncthing, Nextcloud answering?  │
 on phone                │ systemd: did a service give up? (optional)             │
    ▲                    │                                                        │
    │                    │ OMV: is a disk failing or full?  ──► email             │
    │                    │                                                        │
    │                    │ cron: "I'm alive" every 5 min ─────┐                   │
    │                    └────────────────────────────────────┼───────────────────┘
    │                                                         ▼
    └─────────────────────────────── healthchecks.io: no ping for 15 min? Alert!
```

| Watcher | Catches | Runs |
|---|---|---|
| **Uptime Kuma** | A service stopped or stopped answering: OMV's web page, Syncthing, Nextcloud, its database, cache or background jobs. | On the Pi, in Docker |
| **healthchecks.io** | The whole Pi is off, frozen, rebooting in a loop, or has lost its internet connection. Also a power cut at home. | Outside, on the internet |
| **OMV notifications** | Disk health (S.M.A.R.T.), a file system nearly full or not mounted, OMV's own services. | On the Pi, built into OMV |
| **systemd `OnFailure=`** (optional) | Any systemd service that crashes and can't be restarted, for example `tailscaled`. | On the Pi |

**ntfy** is the messenger. It's a free service that turns a simple web request into a push notification: the NAS sends a message to a *topic* on `ntfy.sh`, and every phone subscribed to that topic gets it. Uptime Kuma, healthchecks.io and a one-line `curl` command can all send to it.

{% include callout.html type="note" title="Already built the ESP32 status screen?" text="Keep it. The screen shows you problems at a glance when you're home; this tutorial covers you when you're not. Uptime Kuma can even read the screen's status page, so everything the screen knows also reaches your phone (see *Add the monitors*)." %}

## What you need
{: .no-step}

- Your OMV NAS with the compose plugin and Docker running (**Services → Compose** in the OMV dashboard).
- SSH access to the NAS.
- An Android phone or an iPhone.
- An email address for healthchecks.io, and optionally a Gmail account (or any mail account with SMTP) for OMV's emails.

## Install ntfy on your phone and pick a topic

A **topic** is like a private radio channel: whoever knows its name can send to it and listen to it. There are no passwords on the free `ntfy.sh` server, so the name itself is the secret. Make one that nobody can guess. On the NAS:

```bash
echo "nas-alerts-$(openssl rand -hex 6)"
```

```text
nas-alerts-3f9a1c07b2e4
```

Write yours down; you'll use it in several places. This tutorial uses `nas-alerts-3f9a1c07b2e4` in examples, so replace it with your own everywhere.

Now install the app and subscribe:

1. Install **ntfy** from the Google Play Store, F-Droid or the Apple App Store. It's free and has no ads.
2. Open it, tap **+**, enter your topic name, leave **Use another server** off, and tap **Subscribe**.
3. Allow notifications when the phone asks.

Send yourself a test from the NAS:

```bash
curl -d "Hello from the NAS 👋" ntfy.sh/nas-alerts-3f9a1c07b2e4
```

Your phone should buzz within a second or two. Messages can also carry a title, a priority and an emoji tag, which the alerts below use:

```bash
curl -H "Title: Test alert" -H "Priority: high" -H "Tags: warning" \
     -d "This is what a real alert will look like" \
     ntfy.sh/nas-alerts-3f9a1c07b2e4
```

{% include callout.html type="warning" title="Keep the topic name to yourself" text="Anyone who knows it can read your alerts and send fake ones. Alerts only say things like *Syncthing is down*, so that's a small risk, but don't post the name anywhere. If it leaks, make a new one and update the places you used it. For password-protected topics, create a free ntfy.sh account and reserve the topic name, or pay for ntfy Pro." %}

{% include callout.html type="tip" title="Android: make sure alerts get through" text="On Android, open the ntfy app's settings for your topic and keep **Instant delivery** off unless notifications arrive late; the Play Store version uses Google's push service and needs no battery exemptions. If you use the F-Droid version, turn **Instant delivery** on and allow the app to ignore battery optimisation, or the phone may put it to sleep." %}

## Create a shared folder for Uptime Kuma

Uptime Kuma keeps its settings and history in a small database. Put it on the SSD, next to your other containers' folders:

1. In the OMV dashboard, go to **Storage → Shared Folders** and click **+**.
2. **Name:** `uptime-kuma`. **File system:** your SSD. **Permissions:** Administrator: read/write, Users: no access, Others: no access.
3. Click **Save** and apply.

Look up its full path the same way as for Syncthing and Nextcloud: hover over or open the folder in **Storage → Shared Folders**, or run this over SSH:

```bash
ls -d /srv/dev-disk-by-uuid-*/uptime-kuma
```

```text
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/uptime-kuma
```

## Start Uptime Kuma from a compose file

1. Go to **Services → Compose → Files** and click **+** → **Add**.
2. **Name:** `uptime-kuma`.
3. **File:** paste the following, then change the path to your own from the previous step:

{% include file.html name="uptime-kuma.yml" %}
```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
    container_name: uptime-kuma
    network_mode: host
    volumes:
      # Uptime Kuma's settings, monitors and history
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/uptime-kuma:/app/data
      # Lets it ask Docker whether a container is running
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
```

4. Click **Save**, then apply.
5. Select the `uptime-kuma` row and click **Up**. When the output says the container is `Started`, click **Close**.

What the important lines do:

- **`louislam/uptime-kuma:2`** follows version 2 of Uptime Kuma: you get its fixes and small updates, but not a surprise jump to a version 3 with breaking changes.
- **`network_mode: host`** puts Uptime Kuma straight on the Pi's network, like Syncthing. This matters because Nextcloud only listens on `127.0.0.1:8080`, the Pi's private loopback address. From Docker's usual private network, `127.0.0.1` would mean the Uptime Kuma container itself, and it couldn't see Nextcloud at all. Uptime Kuma's dashboard is on port `3001`.
- **`/var/run/docker.sock`** is how programs talk to Docker. With it, Uptime Kuma can check containers that have no web page, like the Nextcloud database.

{% include callout.html type="warning" title="The Docker socket is powerful" text="A program with access to `docker.sock` can control every container on the NAS, which is the same as root access. Uptime Kuma only uses it to read container states, and it's a widely used, open-source project, but it's why the dashboard below gets a strong password. Adding `:ro` to the line does **not** make it read-only in any useful way; it only stops the socket file itself from being replaced." %}

## Open the dashboard and create your account

On a computer on your home network, open:

```text
http://nas.local:3001
```

From anywhere else, use the NAS's Tailscale name instead, for example `http://nas:3001` or `http://nas.tail1234.ts.net:3001` (see [Reach your NAS from anywhere with Tailscale]({{ '/tutorials/tailscale-remote-access-openmediavault/' | relative_url }})).

The first visit sets Uptime Kuma up:

1. **Which database would you like to use?** Choose **SQLite**. It's a single file in the `uptime-kuma` folder and the lightest choice for a Pi. The MariaDB options are for much larger setups.
2. **Create your admin account.** Pick a username and a strong, unique password, and save them in your password manager.

You land on an empty dashboard. Before adding anything to watch, tell Uptime Kuma how to reach you and how to reach Docker.

## Connect Uptime Kuma to ntfy and Docker

**Notifications.** Click your profile picture (top right) → **Settings** → **Notifications** → **Setup Notification**, and fill in:

| Field | Value |
|---|---|
| **Notification Type** | `ntfy` |
| **Friendly Name** | `Phone (ntfy)` |
| **Server URL** | `https://ntfy.sh` |
| **Topic** | your topic, e.g. `nas-alerts-3f9a1c07b2e4` |
| **Priority** | `5` (the highest: the phone makes a sound even for quiet notification settings) |
| **Default enabled** | ticked, so every new monitor uses it |
| **Apply on all existing monitors** | ticked |

Click **Test**. Your phone should get a test message from Uptime Kuma. Then click **Save**.

**Docker.** Still in **Settings**, go to **Docker Hosts** → **Setup Docker Host**:

| Field | Value |
|---|---|
| **Friendly Name** | `NAS` |
| **Connection Type** | `Socket` |
| **Docker Daemon** | `/var/run/docker.sock` |

Click **Test**, which should say it's connected, then **Save**.

## Add the monitors

A **monitor** is one thing Uptime Kuma checks over and over. Click **+ Add New Monitor** for each row below. The **Monitor Type** decides what the check is:

- **HTTP(s)** loads a web page and is happy with any normal answer.
- **HTTP(s) - Keyword** loads a page and also checks a word appears in it, which catches a service that answers but is broken.
- **Docker Container** asks Docker whether a container is running.

| Friendly Name | Monitor Type | URL / container | Keyword |
|---|---|---|---|
| `OMV dashboard` | HTTP(s) | `http://127.0.0.1/` | |
| `Syncthing` | HTTP(s) - Keyword | `http://127.0.0.1:8384/rest/noauth/health` | `OK` |
| `Nextcloud` | HTTP(s) - Keyword | `http://127.0.0.1:8080/status.php` | `"maintenance":false` |
| `Nextcloud database` | Docker Container | `nextcloud-db` | |
| `Nextcloud cache` | Docker Container | `nextcloud-redis` | |
| `Nextcloud background jobs` | Docker Container | `nextcloud-cron` | |

For the Docker Container ones, type the container name into **Container Name / ID** and pick the `NAS` Docker host. If you're not sure of a name, `sudo docker ps -a` lists them all.

For **every** monitor, also set these in the same form:

| Field | Value | Why |
|---|---|---|
| **Heartbeat Interval** | `60` | Check once a minute. |
| **Retries** | `2` | Only alert after three failed checks in a row. New monitors start at `0`, which alerts on the first hiccup, for example while a container restarts after an update. |
| **Heartbeat Retry Interval** | `60` | Wait a minute between those retries. |

So a real outage reaches your phone after about three minutes, and a container that restarts in ten seconds never bothers you. Check the **Notifications** section at the bottom shows **Phone (ntfy)** ticked, then click **Save**.

What the two keywords check:

- **`OK`**: Syncthing's health page answers just `OK` when everything inside it is working.
- **`"maintenance":false`**: Nextcloud's status page says whether Nextcloud is in maintenance mode, which it is during an upgrade, and which is also where a failed upgrade leaves it stuck. A plain HTTP check would miss that, because the page still loads.

{% include callout.html type="tip" title="Got the ESP32 status screen? Add one more monitor" text="The status script from the ESP32 tutorial already checks the systemd services (`smbd`, `nginx`, `tailscaled`...) and whether the data drive is mounted. Let Uptime Kuma read its verdict: **Monitor Type** `HTTP(s) - Json Query`, **URL** `http://127.0.0.1:8099/status`, **Json Query Expression** `level`, **Condition** `!=`, **Expected Value** `crit`. Name it `Status screen`. It turns red exactly when the screen does, and also when the status script itself stops." %}

After a minute, every monitor on the dashboard should be green with a row of green bars.

## Watch the whole Pi from outside with healthchecks.io

Uptime Kuma lives on the Pi, so if the Pi loses power, freezes or loses its internet connection, Uptime Kuma goes quiet with it. **healthchecks.io** turns this around: the Pi sends it an "I'm alive" ping every five minutes, and if the pings stop, *healthchecks.io* sends the alert. This is called a dead man's switch. The free plan allows 20 checks, and you need one.

**Create the check:**

1. Sign up at [healthchecks.io](https://healthchecks.io) with your email address.
2. Your new project has a check already. Click its name and rename it to `NAS online` (or click **Add Check** to make a new one).
3. Click **Change Schedule** and set **Period** to `5 minutes` and **Grace Time** to `10 minutes`. Click **Save**. healthchecks.io now expects a ping every 5 minutes, and alerts when one is more than 10 minutes late, so after about 15 minutes of silence.
4. Copy the check's **ping URL**. It looks like `https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890`. Treat it like a password: anyone with it can make the check look healthy.

**Send the alerts to ntfy too.** By default healthchecks.io emails you. To get a push notification as well:

1. Go to the **Integrations** tab and click **Add Integration** next to **ntfy**.
2. **Topic:** your topic. **Server:** `https://ntfy.sh`. Set the priority for "down" events to **Max**, and for "up" events to **Default**.
3. Click **Save Integration**, then **Test!** next to it. Your phone should buzz.

**Make the Pi ping every five minutes.** Create a cron file on the NAS:

```bash
sudo nano /etc/cron.d/healthchecks
```

{% include file.html name="/etc/cron.d/healthchecks" %}
```text
# Tell healthchecks.io every 5 minutes that the NAS is on and online
*/5 * * * * root curl -fsS -m 10 --retry 5 -o /dev/null https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Paste your own ping URL at the end, save with `Ctrl+O`, `Enter`, and exit with `Ctrl+X`.

- **`*/5 * * * *`** means every 5 minutes. The five fields are minute, hour, day, month and weekday.
- **`root`** is the user it runs as. Files in `/etc/cron.d/` need this extra field.
- **`-m 10 --retry 5`** gives up on one attempt after 10 seconds and tries up to five times, so a short internet blip doesn't cause a false alarm.
- **`-fsS -o /dev/null`** keeps it quiet unless something goes wrong.

{% include callout.html type="warning" title="Two rules for cron.d files" text="The file name must not contain a dot (`healthchecks` works, `healthchecks.cron` is silently ignored), and the last line must end with a newline. nano adds that for you." %}

Cron picks the file up on its own. Within five minutes, the check's dashboard on healthchecks.io turns green and shows the last ping. You can also ping once by hand to see it straight away:

```bash
curl -fsS -m 10 https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

```text
OK
```

{% include callout.html type="note" title="What a healthchecks.io alert means" text="Only that the pings stopped. The Pi may be off (a power cut, a tripped fuse), frozen, stuck rebooting, or fine but with no internet because the router is down. In all of these, Tailscale can't reach it either, so you can't SSH in to fix it. That's normal: the alert tells you to ask someone at home to check the router and the Pi's power, or to plan a visit." %}

## Let OMV email you about disks and the system

OMV already watches things the other tools can't see: the health of your disks, how full each file system is, whether it's mounted, and OMV's own services. It reports them by email. All it needs is a mail account to send from. These steps use Gmail; any provider with SMTP works the same way with its own server name.

**Make a Gmail app password.** Gmail won't accept your normal password from a program like OMV. It needs an *app password*, a separate password just for the NAS:

1. Make sure **2-Step Verification** is on for your Google account (Google Account → **Security**).
2. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), name it `NAS`, and click **Create**.
3. Copy the 16-letter password it shows. You won't see it again.

**Fill in OMV's mail settings.** In the OMV dashboard, go to **System → Notification → Settings**:

| Field | Value |
|---|---|
| **Enabled** | ticked |
| **SMTP server** | `smtp.gmail.com` |
| **SMTP port** | `587` |
| **Encryption mode** | `STARTTLS` |
| **Sender email** | your Gmail address |
| **Authentication required** | ticked |
| **Username** | your Gmail address |
| **Password** | the 16-letter app password, without spaces |
| **Primary email** | where alerts should go; your Gmail address is fine |

Click **Save** and apply, then click **Send a test email** (the envelope button at the top of the form). It should arrive within a minute; check the spam folder the first time.

**Choose what OMV tells you about.** Go to the **Notifications** tab next to **Settings**. It lists the kinds of events OMV can report. Keep at least the ones for **file systems**, **S.M.A.R.T.** and **monitoring** (OMV's service watchdog) switched on. The CPU, memory and load ones can be left on too; they only fire when the Pi is struggling for a while.

**Turn on disk health checks.** Drives report their own health through **S.M.A.R.T.**, and they often warn days or weeks before they fail:

1. Go to **Storage → S.M.A.R.T. → Settings**, tick **Enabled**, and save.
2. Go to **Storage → S.M.A.R.T. → Devices**, select your SSD, click the edit button, tick **Activate S.M.A.R.T. monitoring**, and save.
3. Optionally, under **Scheduled tests**, add a **Short self-test** once a week, for example on Sunday at 03:00.

{% include callout.html type="note" title="USB SSDs and S.M.A.R.T." text="Many USB-to-SATA adapters don't pass S.M.A.R.T. information through. If the **Devices** page shows no details for your SSD, or `sudo smartctl -a /dev/sda` says it can't read them, this part won't work for that drive. Nothing is broken; you just won't get early warnings for it. Adapters with the ASMedia or JMicron JMS583 chips usually work." %}

OMV also warns you when a file system gets too full (at 80% by default), so a filling SSD shows up in your inbox long before it stops Nextcloud from saving files.

{% include callout.html type="tip" title="Make these emails hard to miss" text="In Gmail, create a filter for emails from your NAS's sender address and tick **Always mark it as important**, so the Gmail app notifies you even if you only get notifications for important mail." %}

## Alert when a systemd service gives up (optional)

Uptime Kuma checks things that have a web page or a container. Some important parts of the NAS are plain systemd services instead, above all **`tailscaled`**: if it dies, you lose your way in. systemd can run a second unit whenever a unit fails, with `OnFailure=`. You'll write one small alert script and one unit that runs it, and then attach it to any service you like. (How units work is explained in [Writing systemd units]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}).)

**The alert script.** It sends the failed unit's name and its last log lines to ntfy:

```bash
sudo nano /usr/local/bin/ntfy-alert
```

{% include file.html name="/usr/local/bin/ntfy-alert" %}
```bash
#!/bin/sh
# Send a phone alert that a systemd unit failed, with its last log lines.
# Usage: ntfy-alert UNIT
TOPIC="nas-alerts-3f9a1c07b2e4"   # your ntfy topic

unit="$1"
curl -fsS -m 10 --retry 3 -o /dev/null \
  -H "Title: $unit failed on $(hostname)" \
  -H "Priority: high" \
  -H "Tags: rotating_light" \
  -d "$(journalctl -u "$unit" -n 8 --no-pager -o cat)" \
  "https://ntfy.sh/$TOPIC"
```

Put your topic in the `TOPIC` line, save, and make it executable:

```bash
sudo chmod +x /usr/local/bin/ntfy-alert
```

**The unit that runs it.** This is a *template* unit: the `@` in its name means it can be started for any other unit, and `%i` is replaced by whatever comes after the `@`.

```bash
sudo nano /etc/systemd/system/notify-failure@.service
```

{% include file.html name="/etc/systemd/system/notify-failure@.service" %}
```ini
[Unit]
Description=Send a phone alert that %i failed

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ntfy-alert %i
```

```bash
sudo systemctl daemon-reload
```

Try it without breaking anything. This sends an alert as if `tailscaled` had failed, with its real recent log lines:

```bash
sudo systemctl start notify-failure@tailscaled.service.service
```

The double `.service` looks odd but is correct: the first is part of the name being passed in (`tailscaled.service`), the second is the template's own ending.

**Attach it to a service.** Add a small override (a *drop-in*) to `tailscaled`, instead of editing its unit file, which an update would overwrite:

```bash
sudo systemctl edit tailscaled
```

An editor opens. Between the comment lines at the top, add:

```ini
[Unit]
OnFailure=notify-failure@%n.service
```

Save and close. `%n` is the full name of the unit it's in, here `tailscaled.service`, so the same two lines work unchanged for any service. Do the same for others worth watching, such as `nas-status` from the ESP32 tutorial or `smbd` for your SMB shares.

{% include callout.html type="note" title="When does it fire?" text="Only when systemd gives up. Services like `tailscaled` have `Restart=on-failure`, so after a crash systemd quietly restarts them, and you get no alert. If it keeps crashing and systemd stops trying (by default, after 5 failures within 10 seconds), the unit becomes *failed* and your phone buzzes. That's the moment you'd need to step in." %}

## Test every alert
{: .no-step}

Don't wait for a real problem to find out whether this works. Each test takes a few minutes.

**A container that stops.** Stop Syncthing:

```bash
sudo docker stop syncthing
```

After about three minutes, Uptime Kuma marks **Syncthing** red and your phone shows something like `[Syncthing] [🔴 Down] Keyword not found` or `connect ECONNREFUSED`. Start it again:

```bash
sudo docker start syncthing
```

Within a minute or two you get a second notification saying it's **Up** again. Repeat with `nextcloud-db` if you like; you should get two alerts, one for the database container and one for Nextcloud itself, which can't work without it.

**The whole Pi going silent.** Pretend the Pi is off by moving the cron file out of the way:

```bash
sudo mv /etc/cron.d/healthchecks /root/
```

After 15 to 20 minutes, healthchecks.io marks **NAS online** as down and you get an email and a push notification. Put the file back and the next ping, within five minutes, sends an "up" notification:

```bash
sudo mv /root/healthchecks /etc/cron.d/
```

**OMV's email.** The **Send a test email** button already proved it works. A real alert you can trigger safely is a service that OMV's watchdog restarts:

```bash
sudo systemctl stop smbd
```

Within a few minutes you get an email from the NAS about `smbd`, and OMV starts it again by itself. Check with `systemctl status smbd`.

## What each alert means and what to do
{: .no-step}

When your phone buzzes, open Uptime Kuma's dashboard over Tailscale to see what's red, then SSH in. These are the first things to try:

| Alert | What to run first |
|---|---|
| **Syncthing**, **Nextcloud** or a Nextcloud container is down | `sudo docker ps -a` shows which containers have stopped. `sudo docker logs --tail 50 NAME` shows why. Start it again with `sudo docker start NAME`, or bring the whole stack back with **Up** in **Services → Compose → Files**. |
| **Nextcloud** down, but its containers are running | Probably stuck in maintenance mode after an update. `sudo docker exec -u www-data nextcloud php occ status` says so; `sudo docker exec -u www-data nextcloud php occ upgrade` finishes the upgrade. |
| **OMV dashboard** down | `systemctl status nginx openmediavault-engined`, then `sudo systemctl restart nginx`. |
| **A systemd service failed** (`OnFailure` alert) | The message already contains its last log lines. `systemctl --failed` lists everything that failed; `sudo systemctl restart NAME` tries again. |
| **File system nearly full** (OMV email) | `df -h` shows which one. `sudo du -xh -d 2 --threshold=1G /srv/dev-disk-by-uuid-*/` lists every folder over 1 GB. Nextcloud's trash and old file versions are common culprits. |
| **File system not mounted** (OMV email) | The SSD disconnected, often from a weak power supply. `sudo journalctl -k -n 30` shows the latest kernel messages, including USB errors. A reboot usually brings it back: `sudo reboot`. Containers that use the SSD fail until it's back. |
| **S.M.A.R.T.** warning (OMV email) | The drive itself reports a problem. Check your backups are current **today**, then plan to replace it. `sudo smartctl -a /dev/sda` shows the details. |
| **NAS online** is down (healthchecks.io) | You can't reach the Pi. Ask someone at home to check the router has internet and the Pi's red power light is on, and to unplug the Pi for ten seconds if it's frozen. |

{% include callout.html type="tip" title="Restart the Pi from anywhere" text="If the Pi freezes while you're away, nobody can SSH in to reboot it. A cheap smart plug that you control from your phone over the internet lets you switch the Pi off and on yourself. Use it only when the Pi really is unreachable: pulling the power while it's writing can damage files." %}

## Telegram, email or Discord instead of ntfy?
{: .no-step}

Uptime Kuma and healthchecks.io both support dozens of ways to reach you. If you'd rather get alerts in Telegram, Discord, Signal, Pushover or plain email, add that as a second notification in **Settings → Notifications** in Uptime Kuma and as a second integration in healthchecks.io, test it, and remove ntfy if you don't need it anymore. ntfy is used here because it needs no account, no bot setup and no phone number, and the same topic works from a one-line `curl` for your own scripts.

## Keep it running and updated
{: .no-step}

- **Updates.** Select `uptime-kuma` in **Services → Compose → Files** and click **Pull**, then **Up**, the same way as your other containers. Your monitors and history are in the `uptime-kuma` folder and survive this.
- **Backups.** Include the `uptime-kuma` shared folder in whatever backs up your other container folders. It's small.
- **Noisy alerts.** If a monitor alerts too often for short blips, raise its **Retries** to `3` or `5`. If you're doing maintenance, click a monitor (or select several) and click **Pause** so it doesn't alert while you work, and remember to resume it afterwards.
- **A new service.** When you add another container later, add a monitor for it right away: HTTP(s) if it has a web page, Docker Container if it doesn't.

## Troubleshooting
{: .no-step}

- **The ntfy test with `curl` works, but nothing arrives on the phone.** Check the topic in the app is spelled exactly the same, including upper and lower case. On Android, check the phone's notification settings allow ntfy, and see the Android tip in the first step.
- **`http://nas.local:3001` doesn't open.** Check the container runs: `sudo docker ps` should list `uptime-kuma`. `sudo docker logs uptime-kuma` shows why it stopped. If another program already uses port 3001, the log says `EADDRINUSE`.
- **Nextcloud monitor fails with `connect ECONNREFUSED 127.0.0.1:8080` but Nextcloud works.** Check the `ports:` line in your Nextcloud compose file is `127.0.0.1:8080:80`. If you used a different port, use it in the monitor's URL too. Also check the Uptime Kuma compose file has `network_mode: host`.
- **Docker Container monitors say `connect EACCES /var/run/docker.sock` or the Docker host test fails.** The socket line is missing from the compose file, or has a typo. Fix it and click **Up** again.
- **Syncthing monitor says `Keyword not found` although Syncthing works.** Open `http://nas.local:8384/rest/noauth/health` in a browser: it should show `{"status": "OK"}`. Keywords are case-sensitive, so use `OK`, not `ok`.
- **healthchecks.io never turns green.** Run the `curl` line from the cron file by hand. If that prints `OK`, check the file name has no dot, the line has `root` in it, and the file ends with a newline; `grep CRON /var/log/syslog` or `journalctl -u cron` shows whether cron runs it. If `curl` fails, the Pi can't reach the internet.
- **OMV's test email fails with `Authentication failed`.** Use an app password, not your normal Gmail password, and paste it without spaces. With `Network is unreachable` or a timeout, check port `587` and **STARTTLS**; port 465 needs **SSL/TLS** instead.
- **The `OnFailure` test sends nothing.** Run the script by hand: `sudo /usr/local/bin/ntfy-alert tailscaled.service`. If that works but the unit doesn't, `journalctl -u 'notify-failure@*'` shows the error. A `status=203/EXEC` there means the script isn't executable; run the `chmod` again.
