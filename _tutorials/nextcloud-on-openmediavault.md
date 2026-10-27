---
title: "Run your own cloud with Nextcloud on your Raspberry Pi NAS"
description: Run Nextcloud in Docker on OpenMediaVault, reach it securely over Tailscale with real HTTPS, and use it for files, photos, calendars, contacts, notes and more from your Windows, Mac, Linux, Android and iPhone devices.
tags: [raspberry-pi, nas, nextcloud, docker, cloud, storage]
related: [raspberry-pi-nas-openmediavault, tailscale-remote-access-openmediavault, syncthing-sync-with-openmediavault, docker-basics-explained-simply]
tested_on: "Written for the official nextcloud Docker image (stable tag) with MariaDB LTS and Redis, on OpenMediaVault 8 with the compose plugin on a Raspberry Pi 4, reached over Tailscale HTTPS, with the Nextcloud desktop client and the Nextcloud Files apps for Android and iOS"
time: "About 1 to 2 hours, plus a few minutes per device"
updated: 2026-10-21
---

Your NAS already stores files and shares them at home. **Nextcloud** turns it into something closer to Google Drive, iCloud or Dropbox, except the cloud is the Pi in your cupboard. You get a web page where you can browse, share and preview files, desktop and phone apps that keep files in sync, automatic photo upload from your phone, and a long list of extra apps: calendars, contacts, tasks, notes, a photo timeline, to-do boards and more. Everything stays on your own drive.

By the end you will have:

- Nextcloud running in Docker on your OpenMediaVault NAS, with a proper database, a cache and all its data on the SSD,
- a real HTTPS address for it, `https://nas.tail1234.ts.net:8443`, that works from anywhere through Tailscale and is invisible to the internet,
- accounts for you and your family,
- the desktop app on Windows, macOS and Linux, and the phone apps on Android and iPhone with photo backup,
- your calendars, contacts and tasks syncing to every device,
- a set of hand-picked Nextcloud apps that run well on a Pi,
- nightly backups and a safe way to update.

This builds on [Build a NAS on a Raspberry Pi 4 with OpenMediaVault]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}) and [Reach your Raspberry Pi NAS from anywhere with Tailscale]({{ '/tutorials/tailscale-remote-access-openmediavault/' | relative_url }}). You need a working OMV NAS with a data drive, SSH access, and Tailscale on the NAS and on the devices you want to use Nextcloud from.

## How it fits together
{: .no-step}

```text
 Phone / laptop (home or away)
 Tailscale on
        │  https://nas.tail1234.ts.net:8443   (encrypted, tailnet only)
        ▼
 ┌─────────────────────── Raspberry Pi NAS ───────────────────────┐
 │  tailscale serve  ──►  127.0.0.1:8080                          │
 │                           │                                    │
 │   Docker (OMV compose plugin)                                  │
 │   ┌────────────┐  ┌───────────┐  ┌────────┐  ┌──────────────┐  │
 │   │ nextcloud  │─►│ MariaDB   │  │ Redis  │  │ cron         │  │
 │   │ (web app)  │─►│ database  │  │ cache  │  │ background   │  │
 │   └────────────┘  └───────────┘  └────────┘  │ jobs         │  │
 │         │                                    └──────────────┘  │
 │         ▼                                                      │
 │   SSD: shared folders nextcloud, nextcloud-data,               │
 │        nextcloud-db and nextcloud-backup                       │
 └────────────────────────────────────────────────────────────────┘
```

Four containers work together. **nextcloud** is the web app itself. **MariaDB** is the database that remembers every file, share, calendar entry and setting. **Redis** is a small in-memory cache that makes the web pages faster and stops two devices from changing the same file at once. **cron** runs Nextcloud's background jobs (cleaning up, sending notifications, generating thumbnails) every five minutes.

Nextcloud only listens on the Pi itself (`127.0.0.1`), never on your home network. The one way in is **`tailscale serve`**, which gives it a real HTTPS certificate and only lets in devices in your tailnet. That keeps things simple: one address for every device, at home and away, and the phone apps are happy because the certificate is genuine.

{% include callout.html type="warning" title="Do not put Nextcloud on the open internet" text="Many guides open ports 80 and 443 on the router or use `tailscale funnel` so Nextcloud is public. Don't. A public Nextcloud on a Pi needs constant updates, brute-force protection and monitoring to be safe. Keeping it inside your tailnet gives you the same convenience with none of that risk." %}

## Nextcloud or Syncthing?
{: .no-step}

If you followed the [Syncthing tutorial]({{ '/tutorials/syncthing-sync-with-openmediavault/' | relative_url }}), you may wonder why you'd want both. They solve different problems, and they work well side by side:

| | Syncthing | Nextcloud |
|---|---|---|
| **What it is** | Keeps the same folder on several devices | A private cloud with a web interface and apps |
| **Files on your devices** | A full copy everywhere | Full copy, or just placeholders that download when opened |
| **Share a file with someone** | No | Yes, with a link, a password and an expiry date |
| **Web access from any browser** | No | Yes |
| **Calendars, contacts, notes, photos** | No | Yes, through Nextcloud apps |
| **Load on the Pi** | Light | Heavier, wants 4 GB of RAM |

A good split: keep using Syncthing for folders you want identical on your computers, and use Nextcloud for photo backup from phones, sharing, calendars and contacts, and opening files from a browser. Keep the two in **separate folders**. Don't point Syncthing at Nextcloud's data folder or the other way round; each would fight over the other's files.

## What you need
{: .no-step}

| Thing | Notes |
|---|---|
| **An OpenMediaVault NAS with the compose plugin** | Set up as in the [NAS tutorial]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}). If **Services → Compose** isn't in your dashboard yet, set it up first as described in the next section. |
| **A Raspberry Pi 4 with 4 GB of RAM or more** | Nextcloud, MariaDB and Redis use 600 to 900 MB between them. A 2 GB Pi runs it for one or two people if you skip the heavier apps, but it will feel slow alongside Syncthing. |
| **An SSD** | Nextcloud reads and writes lots of small files and database rows. It works on a hard disk, but an SSD makes the web interface and thumbnails noticeably snappier. |
| **Tailscale on the NAS and your devices** | As in the [Tailscale tutorial]({{ '/tutorials/tailscale-remote-access-openmediavault/' | relative_url }}), with **MagicDNS** and **HTTPS Certificates** enabled in the admin console's DNS page. |
| **Your tailnet DNS name** | Something like `tail1234.ts.net`. This tutorial uses `nas.tail1234.ts.net`; replace `tail1234` with yours everywhere. *Find your tailnet name*, below, shows where to look. |

## Before you start: set up the compose plugin
{: .no-step}

Skip this if **Services → Compose** already appears in your OMV dashboard and Docker shows **Installed and running** there, for example because you set up Syncthing.

**Services → Compose is missing?** The compose plugin isn't installed yet. It's an add-on from omv-extras, not part of OMV itself.

1. Go to **System → Plugins**, search for `compose`, select **openmediavault-compose** and click **Install** (the down-arrow icon). Reload the page when it asks.
2. If `openmediavault-compose` isn't in the list at all, the omv-extras package sources are missing. Add them over SSH, then reload the Plugins page and search again:

   ```bash
   wget -O - https://github.com/OpenMediaVault-Plugin-Developers/packages/raw/master/install | sudo bash
   ```

**Create two shared folders for it.** In **Storage → Shared Folders**, create these on the SSD (not on the microSD card):

| Name | What goes in it | Permissions |
|---|---|---|
| `compose` | The compose files the plugin manages, and their `.env` files with passwords. | Administrator: read/write, Users: read/write (or no access), Others: no access |
| `docker` | Docker's images and containers. Don't share it over SMB. | Administrator: read/write, Users: no access, Others: no access |

When you pick one of these folders later, OMV shows it as something like `compose [no rootfs, compose/]`. **no rootfs** means the folder is *not* on the root file system, the microSD card OMV runs from, so it's on your SSD as it should be. **compose/** is its path on that drive. If the folder's owner and group show as `root`, that's fine too: the plugin and Docker run as root.

**Fill in the compose settings.** Go to **Services → Compose → Settings**. The page has several sections; here's what each one needs:

| Setting | What to put there |
|---|---|
| **Compose Files → Shared folder** | `compose`. Required: this is where the plugin saves every compose file. |
| **Data → Shared folder** | Leave empty. It's only used by the plugin's ready-made example files; the compose file in this tutorial uses full paths to its own folders. |
| **Backup → Shared folder** | Leave empty. It's for the plugin's own container backup feature; step 13 backs up Nextcloud its own way. |
| **Use podman** | Leave **unticked**. Podman is an alternative to Docker, and everything here assumes Docker. |
| **Use shared folder** and **Docker storage** | Tick **Use shared folder** and choose `docker`. The default, `/var/lib/docker`, is on the microSD card, and Docker writes so much that it wears the card out. |
| **Log file max size** | Keep `50`. Each container's log is capped at 50 MB, so logs can't fill the drive. |
| **Live restore** | Tick it. Containers keep running while Docker itself restarts or updates. |

Click **Save** and apply. If the status at the top says Docker isn't installed or isn't running, click **Reinstall Docker** and wait until it shows **Installed and running**.

{% include callout.html type="note" title="Already running Syncthing or other containers?" text="After changing Docker storage, select each of them in **Services → Compose → Files** and click **Up** once. Their settings and files are safe on their own shared folders; this just recreates the containers in the new storage location." %}

## Find your tailnet name
{: .no-step}

Your tailnet name goes into the compose file in step 3. The easiest place to find it is the NAS itself. Over SSH:

```bash
tailscale status --json | grep -m1 DNSName
```

```text
    "DNSName": "nas.tail1234.ts.net.",
```

That's the NAS's full name on your tailnet. Use it without the dot at the end, so here `nas.tail1234.ts.net`. You can also find it in a browser: open the [admin console's DNS page](https://login.tailscale.com/admin/dns) and look for **Tailnet name**, which looks like `tail1234.ts.net`. The NAS's full name is then `nas.` followed by that.

While you're on that DNS page, check that **MagicDNS** and **HTTPS Certificates** are both enabled. Step 5 needs them.

## Create the shared folders

Nextcloud keeps four kinds of things on the drive. Giving each its own shared folder keeps permissions clean and makes backups easy.

Open the OMV dashboard, go to **Storage → Shared Folders** and create these with **+** → **Create**, picking your SSD as the **File system** each time:

| Name | What goes in it | Permissions |
|---|---|---|
| `nextcloud` | Nextcloud's program files, its settings (`config.php`) and installed apps. | Administrator: read/write, Users: no access, Others: no access |
| `nextcloud-data` | Everyone's files, photos and versions. This is the big one. | Administrator: read/write, Users: no access, Others: no access |
| `nextcloud-db` | The MariaDB database. | Administrator: read/write, Users: no access, Others: no access |
| `nextcloud-backup` | A nightly copy of the database, made in step 13. | Administrator: read/write, Users: no access, Others: no access |

Click **Save** after each one, then the check mark on the yellow banner to apply.

{% include callout.html type="warning" title="Don't share nextcloud-data over SMB" text="Nextcloud keeps track of every file in its database. Files you add or change directly on the drive, behind its back, don't show up in Nextcloud and can confuse it. Always add files through Nextcloud: the web page, the apps or WebDAV. To see your existing SMB shares inside Nextcloud, use step 12 instead." %}

## Look up the paths and set permissions

SSH into the NAS:

```bash
ssh naz@nas.local
```

List the absolute paths of the four new folders:

```bash
ls -d /srv/dev-disk-by-uuid-*/nextcloud*
```

```text
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-backup
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-data
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-db
```

Keep these handy; they go into the compose file in step 3. To save typing, store the drive's path in a variable for this SSH session (use your own path):

```bash
DISK=/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc
```

Inside the container, Nextcloud runs as the web server user `www-data`, which has the user and group ID **33**. It must own its program folder and its data folder, and Nextcloud insists that nobody else can read the data:

```bash
sudo chown -R 33:33 "$DISK/nextcloud" "$DISK/nextcloud-data"
sudo chmod 770 "$DISK/nextcloud-data"
```

The database container sets up the ownership of `nextcloud-db` by itself on its first start, so leave that one alone.

{% include callout.html type="note" title="Why not my own user, like Syncthing?" text="Syncthing runs as your NAS user so you can open its files over SMB. Nextcloud is different: its files are only meant to be reached through Nextcloud, and the official image expects `www-data`. Changing that causes more trouble than it solves." %}

## Add the Nextcloud compose file

You'll write one compose file for all four containers, and keep the passwords in a separate environment box so they're not mixed in with the rest.

First, make up two long random passwords, one for the database user and one for the database's root user. On the NAS:

```bash
openssl rand -base64 24
openssl rand -base64 24
```

Copy both somewhere safe, such as your password manager. You also need a password for your Nextcloud admin account; make that one up yourself or generate a third.

Now in the OMV dashboard:

1. Go to **Services → Compose → Files** and click **+** → **Add**.
2. **Name:** `nextcloud`.
3. **File:** paste the following, then change the four paths to your own from step 2 and `tail1234` to your tailnet name:

{% include file.html name="nextcloud.yml" %}
```yaml
services:
  db:
    image: mariadb:lts
    container_name: nextcloud-db
    command: --transaction-isolation=READ-COMMITTED
    environment:
      - MARIADB_DATABASE=nextcloud
      - MARIADB_USER=nextcloud
      - MARIADB_PASSWORD=${DB_PASSWORD}
      - MARIADB_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
      - MARIADB_AUTO_UPGRADE=1
    volumes:
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 1m
    restart: unless-stopped

  redis:
    image: redis:alpine
    container_name: nextcloud-redis
    restart: unless-stopped

  app:
    image: nextcloud:stable
    container_name: nextcloud
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    ports:
      # Only reachable from the Pi itself; tailscale serve passes requests in
      - 127.0.0.1:8080:80
    environment:
      # Database and cache
      - MYSQL_HOST=db
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
      - MYSQL_PASSWORD=${DB_PASSWORD}
      - REDIS_HOST=redis
      # First admin account, created on the very first start
      - NEXTCLOUD_ADMIN_USER=${NC_ADMIN_USER}
      - NEXTCLOUD_ADMIN_PASSWORD=${NC_ADMIN_PASSWORD}
      # The address you'll use, and that it arrives through a proxy over HTTPS
      - NEXTCLOUD_TRUSTED_DOMAINS=nas.tail1234.ts.net
      - OVERWRITEHOST=nas.tail1234.ts.net:8443
      - OVERWRITEPROTOCOL=https
      - OVERWRITECLIURL=https://nas.tail1234.ts.net:8443
      - TRUSTED_PROXIES=172.16.0.0/12
      # A little more room for PHP, sensible for a Pi
      - PHP_MEMORY_LIMIT=512M
      - PHP_UPLOAD_LIMIT=10G
    volumes:
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud:/var/www/html
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-data:/var/www/html/data
    restart: unless-stopped

  cron:
    image: nextcloud:stable
    container_name: nextcloud-cron
    entrypoint: /cron.sh
    depends_on:
      - app
    volumes:
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud:/var/www/html
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-data:/var/www/html/data
    restart: unless-stopped
```

{% include callout.html type="tip" title="Where your tailnet name goes" text="Only three lines contain it: `NEXTCLOUD_TRUSTED_DOMAINS`, `OVERWRITEHOST` and `OVERWRITECLIURL`. Replace just the `tail1234` part with your own (see *Find your tailnet name* above). If yours is `nas.tailf00d42.ts.net`, the `OVERWRITEHOST` line becomes `OVERWRITEHOST=nas.tailf00d42.ts.net:8443`. Keep `https://` and `:8443` exactly as they are." %}

4. **Environment:** in the box below the file, enter your passwords and the admin name you want:

{% include file.html name="Environment" %}
```text
DB_PASSWORD=paste-the-first-random-password-here
DB_ROOT_PASSWORD=paste-the-second-random-password-here
NC_ADMIN_USER=admin
NC_ADMIN_PASSWORD=a-strong-password-for-the-nextcloud-admin
```

The plugin saves this as a `.env` file next to the compose file, and Docker fills each `${...}` in the compose file from it.

{% include callout.html type="warning" title="No $ in these passwords" text="Docker treats a `$` in this box as the start of a variable and quietly drops part of the password, so you can't log in later. Use passwords without `$`; the `openssl` ones above never contain it. If it already happened, reset the admin password with `occ user:resetpassword admin` (see the troubleshooting section)." %}

5. Click **Save**, then apply.

What the important lines do:

- **`127.0.0.1:8080:80`** publishes Nextcloud's web server on port 8080 of the Pi, but only on the Pi's own loopback address. Nothing on your home network or the internet can reach it directly.
- **`OVERWRITEHOST`, `OVERWRITEPROTOCOL` and `OVERWRITECLIURL`** tell Nextcloud that people reach it as `https://nas.tail1234.ts.net:8443`, even though the requests it actually receives from Tailscale are plain HTTP on port 80. Without them, Nextcloud would build links and redirects to the wrong address.
- **`TRUSTED_PROXIES`** covers the private addresses Docker uses for its networks. It tells Nextcloud to trust the forwarding information that arrives through them.
- **`NEXTCLOUD_ADMIN_USER` and `NEXTCLOUD_ADMIN_PASSWORD`** make the container install Nextcloud and create this admin account on the first start, so you don't have to fill in the database details in an install wizard. They're ignored after that, so changing them later does nothing; change the admin password inside Nextcloud instead.
- **`--transaction-isolation=READ-COMMITTED`** is the database setting Nextcloud's developers recommend.
- **`MARIADB_AUTO_UPGRADE=1`** lets MariaDB update its own data files when a newer image arrives in step 13.
- **The `cron` container** uses the same image and folders as Nextcloud, but instead of serving web pages it runs the background jobs every five minutes.

## Start Nextcloud

Select the `nextcloud` row in **Services → Compose → Files** and click **Up**. OMV downloads four images (about 600 MB in total) and starts them. That takes a few minutes on a Pi; wait until the output says all four containers are `Started`, then click **Close**.

The first start then **installs** Nextcloud, which takes another two to five minutes. Watch it happen over SSH:

```bash
sudo docker logs -f nextcloud
```

```text
Initializing nextcloud 32.0.1.2 ...
New nextcloud instance
Installing with MySQL database
Starting nextcloud installation
Nextcloud was successfully installed
Setting trusted domains…
System config value trusted_domains => 1 set to string nas.tail1234.ts.net
...
AH00094: Command line: 'apache2 -D FOREGROUND'
```

The version number will be newer than this example. When you see the `apache2 -D FOREGROUND` line, the install is done; press `Ctrl+C` to stop watching (Nextcloud keeps running). Check the web server answers on the Pi:

```bash
curl -sI http://127.0.0.1:8080/status.php | head -1
```

```text
HTTP/1.1 200 OK
```

Under **Services → Compose → Containers**, all four containers (`nextcloud`, `nextcloud-db`, `nextcloud-redis`, `nextcloud-cron`) should show as **running**.

Nextcloud has an admin command line tool called **occ**, and later steps use it. Inside Docker it's a long command, so give it a short name in your SSH login:

```bash
echo "alias occ='sudo docker exec -u www-data nextcloud php occ'" >> ~/.bashrc
source ~/.bashrc
occ status
```

`occ status` shows the installed version, and `occ list` shows every command.

## Give Nextcloud an HTTPS address on your tailnet

Now let Tailscale pass HTTPS requests on port 8443 to Nextcloud. On the NAS:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8080
```

`--bg` keeps it running in the background and after reboots.

The command uses two different ports, and it's easy to mix them up:

```text
your phone/laptop                    the Pi                      the container
https://nas…ts.net:8443  ──►  tailscale serve  ──►  127.0.0.1:8080  ──►  port 80 inside Nextcloud
```

- **8443** is the port Tailscale listens on for HTTPS, the one you type in the browser and the apps. Docker doesn't listen on it. In the compose file it only appears in `OVERWRITEHOST` and `OVERWRITECLIURL`, which tell Nextcloud its own address so it builds links with the right port.
- **8080** is the port Docker opens on the Pi, from the `ports:` line `127.0.0.1:8080:80`: port 8080 on the Pi goes to port 80 inside the container.

If you ever change one, change it everywhere it appears: `8443` in this command and both `OVERWRITE…` lines, `8080` in this command and the `ports:` line.

Check it's running:

```bash
tailscale serve status
```

```text
https://nas.tail1234.ts.net:8443 (tailnet only)
|-- / proxy http://127.0.0.1:8080
```

If you also set up HTTPS for the OMV dashboard in the Tailscale tutorial, you'll see that entry on port 443 as well; the two don't get in each other's way.

On any device with Tailscale switched on, open:

```text
https://nas.tail1234.ts.net:8443
```

The very first visit takes a few seconds while Tailscale fetches the certificate. Then the Nextcloud login page appears, with a padlock in the address bar. Log in with the admin name and password from your environment box.

{% include callout.html type="warning" title="Wrong user name or password?" text="Even when you copy the password straight from the Environment box, the login can fail: what's in the box isn't always what Nextcloud received. See *I can't log in as admin* in the troubleshooting section for how to check and fix it." %}

{% include callout.html type="note" title="Only devices in your tailnet can open it" text="The `(tailnet only)` in the status output is the important part. A device needs Tailscale switched on and signed in to your account to reach Nextcloud, both at home and away. On your phone, leave Tailscale connected all the time so photo upload and calendar sync keep working." %}

## Log in and finish the admin setup

Right after logging in, Nextcloud may show a short welcome tour and offer to install recommended apps; close it for now, you'll choose apps in step 11.

**Clean up the setup warnings.** Click your avatar (top-right) → **Administration settings** → **Overview**. Nextcloud runs a set of checks and lists anything it doesn't like. Most fresh installs show a few of these; fix them over SSH with `occ`:

```bash
# Run heavy maintenance jobs at night (01:00 to 05:00 UTC), not during the day
occ config:system:set maintenance_window_start --type=integer --value=1

# Your country, so phone numbers without a +code are understood (GB, US, DE, BD...)
occ config:system:set default_phone_region --value="GB"

# Add database indexes and finish one-off migrations
occ db:add-missing-indices
occ maintenance:repair --include-expensive
```

Reload the Overview page. Some warnings are fine to ignore on a tailnet-only Nextcloud:

- **"You have not set or verified your email server configuration."** Only matters if you want password-reset and share emails. Set it under **Administration settings → Basic settings → Email server** with your email provider's SMTP details, or a Gmail address and an app password.
- **"The Strict-Transport-Security HTTP header is not set."** This protects public sites from being downgraded to HTTP. Your Nextcloud isn't reachable over plain HTTP from anywhere, so it doesn't apply.
- **Anything about the server being unable to reach the internet** for app store or update checks usually clears by itself after a few minutes.

**Switch background jobs to cron.** Go to **Administration settings → Basic settings** and under **Background jobs** choose **Cron (Recommended)**. The `cron` container is already running them; this just tells Nextcloud not to also try running them during page loads. After ten minutes, the same section should say the last job ran a few minutes ago.

**Turn on two-factor login for the admin.** Under **Apps**, search for **Two-Factor TOTP Provider** and click **Download and enable**. Then go to your avatar → **Personal settings → Security**, tick **Enable TOTP** and scan the QR code with an authenticator app (such as Aegis on Android, 2FAS, or the one built into your password manager). Save the backup codes Nextcloud gives you.

## Add accounts for everyone

Don't use the admin account for your own everyday files. Make a normal account for yourself and one for each family member:

1. Click your avatar → **Accounts** (called **Users** in older versions).
2. Click **+ New account**.
3. Fill in an **Account name** (the login name, for example `naz`), a **Display name**, a **Password** and, if you set up email, an **Email**.
4. Optionally add the person to a **group** such as `family`, which makes sharing with everyone at once easy.
5. Set a **Quota** if you want to limit how much space they can use, for example `200 GB`. Leave it as **Unlimited** otherwise.
6. Click **Add new account**.

Log out and log back in as your own account for the rest of this tutorial. Ask everyone to turn on two-factor login for themselves too (**Personal settings → Security**), once you've installed the TOTP app in step 6.

{% include callout.html type="tip" title="App passwords" text="Every app or device that logs in should get its own **app password** instead of your real one. The Nextcloud apps in the next two steps do this automatically. For anything you set up by hand (calendars on an iPhone, Thunderbird), create one under **Personal settings → Security → Devices & sessions**: type a name such as `iPhone calendar` and click **Create new app password**. If a device is lost, revoke just that password." %}

## Install the desktop app (Windows, macOS, Linux)

The Nextcloud desktop client keeps a folder on your computer in sync with your Nextcloud files, like the Dropbox or OneDrive app.

### Windows

1. Download the **Desktop app for Windows** from [nextcloud.com/install](https://nextcloud.com/install/#install-clients) and run the installer.
2. Make sure Tailscale is connected, then click **Log in** and enter `https://nas.tail1234.ts.net:8443` as the server address.
3. Your browser opens; log in and click **Grant access**. That creates an app password for this computer.
4. Back in the client, choose a local folder (the default `C:\Users\<you>\Nextcloud` is fine) and click **Connect**.

Windows supports **virtual files**: your whole Nextcloud appears in Explorer, but files only download when you open them, so a 500 GB Nextcloud doesn't fill a 256 GB laptop. Turn it on in the client's settings → your account → **⋯** → **Enable virtual file support**. Right-click a folder in Explorer → **Always keep on this device** for folders you want offline.

### macOS

1. Download the **Desktop app for macOS** from [nextcloud.com/install](https://nextcloud.com/install/#install-clients), or install it with Homebrew: `brew install --cask nextcloud`.
2. Open **Nextcloud** from Applications, click **Log in**, enter `https://nas.tail1234.ts.net:8443` and grant access in the browser.
3. Choose a local folder and click **Connect**.

The client sits in the menu bar. If macOS asks whether Nextcloud may access files in a folder, click **Allow**. For files that only download on demand, Nextcloud also offers a separate **macOS virtual files** build on the same download page, which shows Nextcloud in Finder's sidebar like iCloud Drive.

### Linux

On Debian, Ubuntu and Raspberry Pi OS desktop:

```bash
sudo apt install nextcloud-desktop
```

Or on any distribution with Flatpak:

```bash
flatpak install flathub com.nextcloud.desktopclient.nextcloud
```

Start **Nextcloud Desktop** from your app menu, log in with `https://nas.tail1234.ts.net:8443` and choose a folder. To start it automatically, tick **Launch on system startup** in its **General** settings.

On GNOME you can also add Nextcloud under **Settings → Online Accounts → Nextcloud**. That doesn't sync files like the desktop app, but it puts your Nextcloud calendars and contacts straight into GNOME Calendar and Contacts and shows your files in the Files app.

{% include callout.html type="note" title="Choose what to sync" text="You don't have to sync everything to every computer. In the client's settings, under your account, untick folders you don't need on that machine. They stay on the NAS and in the web interface." %}

## Set up the phone apps (iPhone, Android)

The **Nextcloud Files** app lets you browse your files, keep chosen ones offline, share links, and upload new photos and videos automatically.

### Android

1. Install **Nextcloud** from Google Play or F-Droid.
2. Make sure Tailscale is connected, tap **Log in** and enter `https://nas.tail1234.ts.net:8443`.
3. Log in in the page that opens and tap **Grant access**.
4. Turn on photo backup: open the menu (☰) → **Settings → Auto upload**. Next to **Camera**, tap the three dots → **Configure**, and set:
   - **Enable:** on
   - **Remote folder:** `/Photos` (or `/Photos/Phone - Naz`, to keep each phone apart)
   - **Only upload on unmetered Wi-Fi:** your choice; leave it off to upload over mobile data too
   - **Original file will be...:** **kept in original folder**
5. Allow the app to run in the background without battery restrictions: Android **Settings → Apps → Nextcloud → Battery → Unrestricted**.

### iPhone and iPad

1. Install **Nextcloud** from the App Store.
2. With Tailscale connected, tap **Log in**, enter `https://nas.tail1234.ts.net:8443`, log in and tap **Grant access**.
3. Turn on photo backup: **More → Settings → Auto upload**. Turn on **Auto upload photos** and **Auto upload videos**, choose the folder (for example `/Photos`) and allow access to all photos when iOS asks.
4. Turn on **Back up new photos only** if you've already got your old photos elsewhere; otherwise it uploads your whole library, which can take a night or two the first time.

iOS only lets apps run in the background for short bursts, so auto upload catches up whenever you open the app, and in between when iOS allows. Opening the Nextcloud app now and then keeps it current.

The **Files** integration is a nice extra on iPhone: in the iOS **Files** app, tap **⋯** → **Edit** under **Locations** and turn on **Nextcloud**. Your Nextcloud then appears in every app's file picker.

{% include callout.html type="tip" title="Keep Tailscale on" text="All of this only works while Tailscale is connected. In the Tailscale app on iPhone, you can turn on **VPN On Demand** so it reconnects by itself. On Android, set Tailscale as an **Always-on VPN** in **Settings → Network → VPN → ⚙ next to Tailscale**." %}

## Sync calendars, contacts and tasks

Nextcloud speaks **CalDAV** and **CardDAV**, the open standards for calendars and contacts, so it works with the calendar and contacts apps already on your devices. First, install the apps in Nextcloud itself: go to **Apps**, and **Download and enable** **Calendar**, **Contacts** and **Tasks**. They appear as icons in the top bar. Create a calendar there, and import your old ones (`.ics` from Google Calendar's export, `.vcf` from Google Contacts or iCloud) with **Calendar settings → Import** and **Contacts settings → Import**.

Then add the account to each device. Use an **app password** (step 7) wherever one is asked for.

| Device | How to add it |
|---|---|
| **iPhone / iPad** | **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add CalDAV Account**. **Server:** `nas.tail1234.ts.net:8443/remote.php/dav/principals/users/naz/` (your account name at the end), plus your user name and app password. Then do the same under **Contacts → Contacts Accounts → Add CardDAV Account**. Tasks appear in **Reminders**. |
| **Android** | Install **DAVx⁵** (free on F-Droid, paid on Google Play). In the Nextcloud app, open the menu → **Settings → Sync calendars & contacts** and it hands the login to DAVx⁵ for you. Pick which calendars and address books to sync. For tasks, install **jtx Board** or **Tasks.org** and enable tasks in DAVx⁵. |
| **macOS** | **System Settings → Internet Accounts → Add Other Account… → CalDAV account**. Choose **Account Type: Manual**, enter your user name and app password, and **Server Address** `https://nas.tail1234.ts.net:8443/remote.php/dav/principals/users/naz/`. Repeat with **CardDAV account** for contacts. |
| **Windows** | Windows' own Calendar app doesn't support CalDAV. Use **Thunderbird**: **New Calendar → On the Network**, enter your user name and the location `https://nas.tail1234.ts.net:8443/remote.php/dav`, and it finds all your calendars. Contacts work the same way under **Address Book → New Address Book → Add CardDAV Address Book**. |
| **Linux** | GNOME: **Settings → Online Accounts → Nextcloud** (see step 8). KDE: **System Settings → Online Accounts**, or add a **DAV groupware** resource in KOrganizer. Or use Thunderbird as on Windows. |

{% include callout.html type="note" title="Moving from Google or iCloud" text="Once everything shows up on your devices, turn off calendar and contact sync for the old Google or iCloud account on each device, so new appointments don't land in the old place by habit." %}

## Add useful Nextcloud apps

Nextcloud's app store has hundreds of apps. Install them from your avatar → **Apps** (as the admin): find the app, click **Download and enable**, and it appears in the top bar or in settings. Here are the ones that are genuinely useful and run well on a Pi:

| App | What it does | Phone / desktop companion |
|---|---|---|
| **Calendar, Contacts, Tasks** | Your own Google Calendar and Contacts (step 10). | Built-in apps via CalDAV/CardDAV, DAVx⁵ |
| **Memories** | A fast photo timeline with albums, a map of where photos were taken, and "on this day". Much nicer than the default Photos app. | Works in the phone browser; Android app **Memories** on F-Droid / Play |
| **Notes** | Simple Markdown notes, stored as plain files in a `Notes` folder. | **Nextcloud Notes** (Android, iOS) |
| **Deck** | Trello-style boards with cards, labels and due dates. Great for household to-do lists. | **Nextcloud Deck** (Android), Deck in the browser on iOS |
| **Bookmarks** | Saves and tags bookmarks, and syncs them between browsers. | **floccus** extension for Firefox and Chrome, **Bookmarks** apps for phones |
| **News** | An RSS reader. Subscribe to sites and read their new posts in one place. | **Nextcloud News** (Android), **CloudNews** (iOS) |
| **Collectives** | A small wiki for the household: recipes, manuals, Wi-Fi passwords for guests, how the NAS is set up. | Browser |
| **Forms** and **Polls** | Quick surveys and "which date works for everyone?" polls you can send to family. | Browser |
| **Cospend** | Splits shared costs for a trip or a shared house, and works out who owes whom. | **MoneyBuster** (Android) |
| **Talk** | Chat, and voice and video calls, between your Nextcloud accounts. Fine for one-to-one and small family calls. | **Nextcloud Talk** (Android, iOS, desktop) |
| **Group folders** (called **Team folders** in newer versions) | Folders that belong to a group, such as `family`, instead of one person, with their own quota. | Shows up in every member's desktop and phone app |
| **Preview Generator** | Makes photo thumbnails ahead of time, at night, so browsing photos isn't slow. Recommended with Memories. | None, runs on the NAS |
| **Two-Factor TOTP Provider** | Login codes from an authenticator app (step 6). | Any authenticator app |

### Setting up Memories and Preview Generator

After enabling **Memories**, open it once from the top bar and follow its short setup: point it at your photos folder (for example `/Photos`). Then build its index over SSH; the first run reads every photo and can take an hour or more for a large library:

```bash
occ memories:index
```

New photos are indexed automatically by the background jobs after that. Memories shows photo thumbnails out of the box; video thumbnails need a tool (ffmpeg) that isn't in the official image, so videos show a generic icon but still play.

After enabling **Preview Generator**, make the thumbnails for everything already there once, then let a scheduled task keep up:

```bash
occ preview:generate-all
```

In the OMV dashboard, go to **System → Scheduled Tasks**, click **+**, and add a task that runs every 15 minutes (**Minute:** `*/15`, the rest `*`), as user `root`, with this command:

```text
docker exec -u www-data nextcloud php occ preview:pre-generate
```

### Apps to skip on a Pi

Some popular apps are too heavy for a Raspberry Pi 4. They install, but make everything else crawl:

- **Recognize** (face and object recognition in photos). It works, but indexing a photo library can keep the Pi busy for days.
- **Nextcloud Office** (Collabora), for editing Word and Excel files in the browser. It needs its own large server; only try it on an 8 GB Pi, and expect it to be slow.
- **Full text search** with Elasticsearch, and the **Assistant** and other AI apps. They need far more memory and processing power than a Pi has.

Also turn off default apps you don't use, which saves memory and makes pages load faster: **Apps → Your apps**, then **Disable** next to things like **Weather status**, **Recommendations**, or **Photos** once you're happy with Memories.

## Show your existing NAS shares in Nextcloud

You probably have folders on the NAS already, such as a `media` share with music and films. Nextcloud's **External storage** app can show them inside Nextcloud without moving anything, so you can open them from the phone app or share a film with a link.

The safe way is **read-only**: Nextcloud can show and share the files, but not change or delete them. That avoids permission tangles between `www-data` and your own NAS user.

**1. Pass the folder into the container.** Edit the `nextcloud` compose file in **Services → Compose → Files** and add one line under `volumes:` of the **`app`** service (use your own path and share name):

```yaml
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/media:/mnt/media:ro
```

The `:ro` at the end makes it read-only inside the container. Save, then select the row and click **Up** to recreate the container with the new folder.

**2. Add it in Nextcloud.** As the admin, go to **Apps** and enable **External storage support**. Then **Administration settings → External storage**:

1. **Folder name:** `Media`
2. **External storage:** **Local**
3. **Configuration:** `/mnt/media`
4. **Available for:** your own account, or the `family` group
5. Click the check mark.

A green dot means it worked. The `Media` folder now appears in everyone's Nextcloud it's available to. Nextcloud notices new files you add to the share over SMB when someone opens the folder.

{% include callout.html type="note" title="A red dot instead?" text="Nextcloud can't read the folder. For read-only access, `www-data` needs read permission, which shares created with **Others: read-only** in OMV already allow. If your share is **Others: no access**, change it to read-only under **Storage → Shared Folders → Permissions**, or leave that folder out of Nextcloud." %}

## Keep Nextcloud updated and backed up

**Updating Nextcloud.** Don't use the updater inside Nextcloud's settings; with Docker, the image *is* the update. About once a month, in **Services → Compose → Files**, select `nextcloud` and click **Pull** (download the newest images), then **Up**. On the next start, the container upgrades your installation by itself; watch it with `sudo docker logs -f nextcloud` and wait for `apache2 -D FOREGROUND` again. Afterwards, check **Administration settings → Overview** for new warnings, and run `occ db:add-missing-indices` if it asks.

{% include callout.html type="warning" title="Never skip a major version" text="Nextcloud can only upgrade one major version at a time, for example 31 to 32, not 31 to 33. The `stable` tag moves forward one version at a time, so updating every month or two keeps you safe. If you've left it for half a year or more, check `occ status` first. If you're more than one version behind, temporarily change the image line of both `app` and `cron` to the next number, for example `nextcloud:32`, update, then the one after, and only then go back to `stable`." %}

Update apps under **Apps → Updates** whenever a number appears there.

**Backing up.** A complete Nextcloud backup is three things: the database, the `nextcloud` folder (settings and apps), and the `nextcloud-data` folder (everyone's files). The database can't be copied safely as files while it's running, so make a proper copy (a "dump") of it every night first.

In **System → Scheduled Tasks**, click **+** and add a task that runs **Daily** at 03:00, as user `root`, with this command (use your own path):

```text
docker exec nextcloud-db sh -c 'mariadb-dump --single-transaction -u root -p"$MARIADB_ROOT_PASSWORD" nextcloud' > /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/nextcloud-backup/nextcloud-db.sql
```

`--single-transaction` takes a consistent snapshot without stopping anyone from using Nextcloud. The password comes from inside the database container, so it isn't written into the task. Click **Run** on the new task once and check that `nextcloud-db.sql` appears in `nextcloud-backup` and isn't empty:

```bash
ls -lh /srv/dev-disk-by-uuid-*/nextcloud-backup/
```

Then add `nextcloud`, `nextcloud-data` and `nextcloud-backup` to the nightly rsync job to your second drive, as in *Keep the NAS healthy* in the [NAS tutorial]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}), and set it to run after 03:00, for example at 04:00. Keep a copy of the compose file and the environment box's passwords in your password manager too.

**Restoring, in short.** Put the three folders back, start only the `db` container (**Services → Compose → Containers**, or `sudo docker start nextcloud-db`), and load the dump:

```bash
sudo docker exec -i nextcloud-db sh -c 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD" nextcloud' < nextcloud-db.sql
```

Then bring everything **Up** and run `occ maintenance:data-fingerprint`, so the desktop and phone apps know to check their files against the server.

**Keep an eye on space.** Nextcloud keeps old versions of changed files and a trash bin for deleted ones, and both use space on the SSD. By default it clears them automatically when space runs low. Each user can empty their own **Deleted files** in the Files app.

## Troubleshooting
{: .no-step}

- **Nextcloud was working, but now the page won't load at all.** Find which part of the chain has stopped, in this order, and stop at the first check that fails:

  1. **Tailscale on your device.** The Tailscale app must say **Connected**. If `http://nas` (the OMV dashboard) doesn't open either, the problem is Tailscale, not Nextcloud.
  2. **The containers.** Over SSH:

     ```bash
     sudo docker ps -a --filter name=nextcloud
     ```

     All four (`nextcloud`, `nextcloud-db`, `nextcloud-redis`, `nextcloud-cron`) should say `Up`. If any say `Exited`, or the list is empty, select `nextcloud` in **Services → Compose → Files** and click **Up**. An empty list usually means Docker's storage setting was changed after Nextcloud was set up; **Up** recreates the containers, and your data is safe on its shared folders.
  3. **Nextcloud itself, on the Pi.**

     ```bash
     curl -sI http://127.0.0.1:8080/status.php | head -1
     ```

     `HTTP/1.1 200 OK` means Nextcloud is fine. No output at all means it isn't answering; look at its log with `sudo docker logs --tail 50 nextcloud`. If the log is full of `Segmentation fault`, see the next item.
  4. **Tailscale on the NAS.** `tailscale serve status` should show `https://nas.tail1234.ts.net:8443` with `proxy http://127.0.0.1:8080`. If it's empty, run the `tailscale serve` command from step 5 again.

- **The log is full of `child pid ... exit signal Segmentation fault (11)` and `curl` prints nothing.** Apache is running, but the PHP part of Nextcloud crashes on every page request, so no page ever comes back. Your files and database aren't affected. The usual causes are a bad cache left over after a change, or an app that was just installed. Try, in order:

  1. **Restart Nextcloud**, which clears PHP's caches. This fixes it most of the time:

     ```bash
     sudo docker restart nextcloud nextcloud-cron
     curl -sI http://127.0.0.1:8080/status.php | head -1
     ```

  2. If `curl` still prints nothing, check whether PHP also crashes on the command line, and list the apps that are switched on:

     ```bash
     sudo docker exec -u www-data nextcloud php occ status
     sudo docker exec -u www-data nextcloud php occ app:list --enabled
     ```

  3. Switch off the app you installed most recently, test again, and repeat with the next one until `curl` shows `HTTP/1.1 200 OK`. For example:

     ```bash
     sudo docker exec -u www-data nextcloud php occ app:disable memories
     curl -sI http://127.0.0.1:8080/status.php | head -1
     ```

     Once you've found the app that causes it, leave it off, or try it again after the next update.
  4. Nextcloud's own log often names the culprit: `sudo docker exec nextcloud tail -n 20 /var/www/html/data/nextcloud.log`.

- **I can't log in as admin: "Wrong login or password", even with the password copied from the Environment box.** The box shows what you typed, but Nextcloud may have received something different, and it only reads these values once. First list the accounts that exist, to get the exact admin name:

  ```bash
  sudo docker exec -u www-data nextcloud php occ user:list
  ```

  ```text
    - admin: admin
  ```

  Then check what the container actually received:

  ```bash
  sudo docker exec nextcloud printenv NEXTCLOUD_ADMIN_USER NEXTCLOUD_ADMIN_PASSWORD
  ```

  - **It looks different from the box** (part of the password missing, or empty): Docker changed it on the way in, almost always because of a `$`, which it reads as the start of a variable. Log in with what the command shows, or reset the password below.
  - **It matches the box exactly:** Nextcloud was installed on an earlier start, before these values were in the box. It reads `NEXTCLOUD_ADMIN_USER` and `NEXTCLOUD_ADMIN_PASSWORD` only during that very first install and ignores them afterwards, so changing the box later does nothing.
  - **A space or quote mark copied along** with the password also breaks it.

  In every case, the sure fix is to set a new password directly (use the name from `user:list`):

  ```bash
  sudo docker exec -it -u www-data nextcloud php occ user:resetpassword admin
  ```

  It asks for the new password twice. Type it rather than pasting it; nothing appears while you type, which is normal. Then log in with that name and the new password. If the login page asks you to wait, that's Nextcloud slowing down repeated wrong attempts; it clears after a few minutes.
- **The container keeps restarting and the logs say the data directory is "readable by other users" or "not writable".** The permissions from step 2 aren't right. Run `sudo chown -R 33:33` on the `nextcloud` and `nextcloud-data` folders and `sudo chmod 770` on `nextcloud-data`, then **Down** and **Up** the compose file.
- **The logs repeat "retrying install" or can't connect to the database.** MariaDB wasn't ready or the passwords don't match. Check `DB_PASSWORD` is the same for both services (it is if you used the environment box) and look at `sudo docker logs nextcloud-db`. If the very first install failed half-way, the easiest fix is a clean start: **Down**, empty the `nextcloud`, `nextcloud-data` and `nextcloud-db` folders, redo the permissions in step 2 and **Up** again.
- **The browser says "Access through untrusted domain".** The address you opened isn't in `NEXTCLOUD_TRUSTED_DOMAINS`. Use exactly `https://nas.tail1234.ts.net:8443`. To add another name later: `occ config:system:set trusted_domains 2 --value=other.name`.
- **`https://nas.tail1234.ts.net:8443` doesn't load at all.** Is Tailscale connected on this device? Does `tailscale serve status` on the NAS still show the 8443 entry? Does `curl -sI http://127.0.0.1:8080/status.php` on the NAS answer? Each of these tells you which part is down.
- **Login works, but then the page redirects to `localhost` or `http://`.** The `OVERWRITE...` lines in the compose file are missing or have a typo. Fix them and click **Up** to recreate the container.
- **The desktop or phone app is stuck on "Waiting for authorization" after granting access in the browser.** Check `OVERWRITECLIURL` and `OVERWRITEHOST` include `:8443`. The app then gets the right address back from Nextcloud.
- **Background jobs say "Last job execution ran" hours ago.** Check that `nextcloud-cron` is running under **Services → Compose → Containers** and that **Basic settings → Background jobs** is set to **Cron**.
- **Uploading large files fails part-way.** The apps upload big files in chunks, so this is rare. In the browser, try again over a steady connection; uploading tens of gigabytes is better done with the desktop app.
- **Everything is slow.** Check memory with `free -h` on the NAS. If it shows little `available`, disable apps you don't use (step 11), avoid the heavy ones, and consider a Pi with more RAM. The very first browse through a big photo folder is always slow until Preview Generator has made the thumbnails.
- **Files I copied into `nextcloud-data` over SSH don't show up.** Nextcloud only knows about files that come in through Nextcloud. Tell it to look: `occ files:scan --all`. Better, upload through the desktop app or the web interface, or use step 12 for existing folders.
- **I'm locked out of the admin account later on.** Reset its password over SSH: `occ user:resetpassword admin`, as in the first item of this list.
