---
title: Host this site on your OpenMediaVault NAS with the compose plugin
description: Run this Jekyll site in Docker on the same machine as OpenMediaVault, managed from Services → Compose, on its own port so it doesn't fight with the OMV dashboard, and keep it public through your Cloudflare Tunnel.
tags: [docker, openmediavault, nas, cloudflare, self-hosting, jekyll]
related: [host-this-site-with-docker-and-cloudflare-tunnel, raspberry-pi-nas-openmediavault, nextcloud-on-openmediavault, docker-basics-explained-simply, linux-users-groups-and-permissions]
tested_on: "Written for OpenMediaVault 8 with the openmediavault-compose plugin on a Raspberry Pi 4 (Debian 13), with the ruby:3.3, nginx:stable-alpine and cloudflare/cloudflared images"
time: "About 1 hour, most of it waiting for the first build"
updated: 2026-11-14
---

[Host this site with Docker and Cloudflare Tunnel]({{ '/tutorials/host-this-site-with-docker-and-cloudflare-tunnel/' | relative_url }}) runs the site on a separate Debian PC with plain `docker compose`. If you already have an OpenMediaVault NAS that's on all the time, it can do the same job, and you can manage the site from the OMV dashboard next to your other containers.

The Dockerfile, the nginx settings and the tunnel are exactly the same as in that tutorial. Only three things change on OMV:

1. **Where the files live.** The compose plugin's editor only holds the compose file itself. The Dockerfile and the rest of the site need to sit in a normal folder on the NAS, and the compose file points to it with a full path.
2. **The port.** OMV's own dashboard already uses port 80, so the site gets a different one: **8081**.
3. **How you rebuild.** You use the plugin's **Up** button, or its command-line helper `omv-compose-run`, instead of typing `docker compose` in the repository folder.

## The whole picture
{: .no-step}

```text
   Your Mac               GitHub                 OMV NAS (Raspberry Pi)
   ────────               ──────                 ──────────────────────
   edit, git push ──────► repository ─ git pull ─► /srv/dev-disk-by-uuid-…/website   (the site, a Git clone)
                                                           │  build: context points here
                                                           ▼
                                        Services → Compose → Files → "website"
                                           ├─ web     nginx with the built site   port 8081 → 80
                                           └─ tunnel  cloudflared ──► Cloudflare ──► https://notes.example.com

   Port 80 on the NAS stays with the OMV dashboard. Port 8080 stays with Nextcloud.
```

## What you need
{: .no-step}

| You need | Notes |
|---|---|
| **An OpenMediaVault NAS with the compose plugin** | Set up as in the [NAS tutorial]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}). If **Services → Compose** isn't there yet, follow *Before you start: set up the compose plugin* in the [Nextcloud tutorial]({{ '/tutorials/nextcloud-on-openmediavault/' | relative_url }}). Make sure Docker's storage is on the SSD, not the microSD card: the first build writes a lot. |
| **SSH access to the NAS** | As the user you log in with, called `pi` here. |
| **This site's repository on GitHub** | The `docker/` folder, `.dockerignore` and `compose.yaml` from the Docker tutorial are already in it. |
| **A Cloudflare Tunnel token** (optional) | Only for the public address. If you made one in the Docker tutorial, you'll reuse it. |

{% include callout.html type="note" title="Coming from the Debian PC?" text="If the site already runs on a Debian PC from the other tutorial, leave it running until step 5 works. Step 6 explains how to move the tunnel over without the site going offline." %}

## Why the site can't use port 80
{: .no-step}

A *port* is like a door number on the NAS. Only one program can listen behind each door. OMV's web dashboard is served by nginx on **port 80** (and 443 if you turned on HTTPS for it), so if a container tries to publish on port 80 too, Docker stops with an error like `address already in use`, and the container never starts.

So the site keeps port 80 **inside its container**, where nothing else lives, and Docker maps a free NAS port to it. In a compose file that's written `NAS-port:container-port`:

```yaml
    ports:
      - "8081:80"
```

Why 8081 and not the usual 8080? If you followed the [Nextcloud tutorial]({{ '/tutorials/nextcloud-on-openmediavault/' | relative_url }}), Nextcloud already has 8080. Any free port works; check before you pick one:

```bash
sudo ss -tlnp | grep -E ':(80|443|8080|8081)\b'
```

```text
LISTEN 0  511      0.0.0.0:80        0.0.0.0:*  users:(("nginx",pid=812,fd=6))
LISTEN 0  4096   127.0.0.1:8080      0.0.0.0:*  users:(("docker-proxy",pid=1450,fd=7))
```

Port 80 is OMV's nginx, 8080 is Nextcloud, and nothing is on 8081, so 8081 is free. If a line shows `:8081`, pick another number such as 8082, and use it everywhere this page says 8081.

{% include callout.html type="tip" title="Couldn't I just move OMV off port 80?" text="You could, under **System → Workbench → Port**, and then give the site port 80. It's not worth it: every bookmark to the dashboard breaks, and visitors never see the port anyway, because the Cloudflare Tunnel talks to the container directly (step 6)." %}

## Part 1: Run the site on your home network
{: .no-step}

## Create a shared folder for the site

The site's files need a home on the SSD. In the OMV dashboard go to **Storage → Shared Folders**, click **+** → **Create**, and fill in:

| Field | Value |
|---|---|
| **Name** | `website` |
| **File system** | your SSD (not the microSD card) |
| **Permissions** | Administrator: read/write, Users: read-only, Others: read-only |

Click **Save** and apply.

Now find the folder's full path over SSH. You'll need it in the compose file:

```bash
ls -d /srv/dev-disk-by-uuid-*/website
```

```text
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/website
```

That long `dev-disk-by-uuid-…` part is your SSD's ID, so yours is different. Save it in a variable for this SSH session to save typing (use your own path):

```bash
SITE=/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/website
```

The folder belongs to `root` at first. Make your own user its owner, so you can run `git` there without `sudo`:

```bash
sudo chown pi:users "$SITE"
```

{% include callout.html type="note" text="If your SSH user isn't `pi`, use its name here and in the rest of this page. `whoami` prints it. [Linux users, groups and permissions]({{ '/tutorials/linux-users-groups-and-permissions/' | relative_url }}) explains what `chown` and `users` mean." %}

## Put the site's files in it

The easiest way is to clone the repository straight into the shared folder. Then updating later is just `git pull`. Git isn't installed on OMV by default:

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/YOUR-USERNAME/cheatsheet-tutorial.git "$SITE"
```

The folder must be empty for `git clone` to work. A brand-new shared folder is.

Check that the important files arrived:

```bash
ls "$SITE"/docker "$SITE"/Gemfile "$SITE"/.dockerignore
```

```text
/srv/dev-disk-by-uuid-…/website/.dockerignore
/srv/dev-disk-by-uuid-…/website/Gemfile

/srv/dev-disk-by-uuid-…/website/docker:
Dockerfile  nginx.conf  update.sh
```

{% include callout.html type="tip" text="If the repository is **private**, `git clone` over HTTPS asks for your GitHub username and a *personal access token* (not your password). Or add an SSH key to GitHub and clone `git@github.com:YOUR-USERNAME/cheatsheet-tutorial.git` instead; see [SSH key configuration on a Pi]({{ '/tutorials/ssh-key-configuration-on-pi/' | relative_url }})." %}

**No Git?** You can also copy the site folder from your Mac, for example with `rsync -av --exclude _site --exclude .git ./ pi@192.168.1.50:/srv/dev-disk-by-uuid-…/website/` (your path) from inside the site folder, or by dragging it onto the `website` share over SMB. It works, but then every update is a copy by hand, and steps 7 and 8 assume a Git clone.

A quick reminder of what's in `docker/` (the [Docker tutorial]({{ '/tutorials/host-this-site-with-docker-and-cloudflare-tunnel/' | relative_url }}) explains every line):

- **`docker/Dockerfile`** builds the site with Jekyll in a `ruby:3.3` stage, then copies the finished pages into a small `nginx:stable-alpine` image. It sets `baseurl: ""`, so the site lives at the root of its address, without `/cheatsheet-tutorial`.
- **`docker/nginx.conf`** tells nginx how to serve the pages, the 404 page and the caching headers.
- **`docker/update.sh`** is for the Debian PC. **Don't use it on OMV**: it runs `docker compose` in the repository folder, which would start a second copy of the site on port 8080, next to the one the plugin manages. Step 8 has an OMV version.

The repository's own `compose.yaml` and `.env.example` aren't used on OMV either. The plugin keeps its own compose file, which you write next.

## Add the compose file in OMV

In the OMV dashboard:

1. Go to **Services → Compose → Files** and click **+** → **Add**.
2. **Name:** `website`.
3. **File:** paste this, then change the `context:` path to **your** path from step 1:

{% include file.html name="website.yml" %}

```yaml
name: website

services:
  # The website: Jekyll builds it, nginx serves it
  web:
    build:
      # The site folder on the NAS. Must be the full path.
      context: /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/website
      # Relative to the context folder above
      dockerfile: docker/Dockerfile
      args:
        SITE_URL: ${SITE_URL:-http://localhost:8081}
    image: website:latest
    container_name: website-web
    ports:
      # NAS port 8081 → port 80 inside the container. Port 80 on the NAS is OMV's.
      - "8081:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1/"]
      interval: 30s
      timeout: 5s
      retries: 3
```

4. **Environment:** paste this, with your NAS's address:

{% include file.html name="Environment" %}

```text
SITE_URL=http://192.168.1.50:8081
```

5. Click **Save**, then apply.

What's different from the Debian PC's `compose.yaml`:

- **`context:` is a full path.** The plugin saves this file in its own folder, `compose/website/website.yml` on your SSD. A relative path like `.` would mean *that* folder, which only holds the compose file, so the build couldn't find the Gemfile or the Dockerfile. The full path sends Docker to the site folder instead.
- **`dockerfile: docker/Dockerfile`** is read **relative to the context**, so it means `…/website/docker/Dockerfile`. Leave it as it is.
- **`image: website:latest`** names the image the build produces. You'll see that name in **Services → Compose → Images**, and it's what the alternative after step 5 relies on.
- **`"8081:80"`** is the port mapping from *Why the site can't use port 80*.
- **`name: website`** fixes the project's name. Docker names the network `website_default` after it, and the tunnel in step 6 joins that network.
- **There's no `.env` file to make by hand.** The **Environment** box *is* the `.env` file: the plugin saves it as `website.env` beside the compose file and hands it to Docker, which fills in `${SITE_URL}`.

## Build and start the site

The first build downloads the Ruby image and compiles several gems. On a Raspberry Pi 4 that takes **10 to 20 minutes**. You can click **Up** on the `website` row in **Services → Compose → Files**; because the image doesn't exist yet, Compose builds it first. But a build that long is easier to follow over SSH, where you see every line and nothing times out:

```bash
sudo omv-compose-run website up -d --build
```

`omv-compose-run` is the helper the plugin uses behind its own buttons. It finds `website.yml` and `website.env` for you and runs `docker compose` with whatever follows the name, here `up -d --build`. So this does exactly what **Up** does, plus a forced rebuild.

When it finishes:

```bash
sudo omv-compose-run website ps
```

```text
NAME          IMAGE            COMMAND                  SERVICE   CREATED          STATUS                    PORTS
website-web   website:latest   "/docker-entrypoint.…"   web       50 seconds ago   Up 49 seconds (healthy)   0.0.0.0:8081->80/tcp
```

`(healthy)` can take up to 30 seconds to appear. You'll also see `website-web` as **running** under **Services → Compose → Containers**.

Check it from the NAS:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/this-page-does-not-exist
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/
```

```text
200
404
200
```

The first is your site, the second its 404 page, and the third is still the OMV dashboard on port 80. Both live side by side.

## Test it from another device

On your phone or laptop, on the same Wi-Fi, open:

```text
http://192.168.1.50:8081
```

Click around: tutorials, a cheatsheet, search, dark mode, and a made-up address for the 404 page. And `http://192.168.1.50` (no port) should still open the OMV login, as before.

{% include callout.html type="note" text="The browser may say **Not secure**, because this is plain `http://` on your home network. That's expected. The Cloudflare Tunnel in Part 2 gives the public address real HTTPS." %}

## Alternative: build the image yourself and use only `image:`
{: .no-step}

Skip this unless the `build:` section gives you trouble. It's another way to get the same result.

The plugin also has a **Services → Compose → Dockerfiles** tab, which stores a Dockerfile and builds an image from it. It suits Dockerfiles that stand on their own. This site's Dockerfile doesn't: it copies the whole site (`COPY . .`) and `docker/nginx.conf`, and those files aren't in the Dockerfiles tab. So instead, build the image over SSH from the site folder, and let the compose file only *run* it:

```bash
cd "$SITE"
sudo docker build -f docker/Dockerfile --build-arg SITE_URL=http://192.168.1.50:8081 -t website:latest .
```

Then, in the compose file, replace the whole `build:` block (all five lines, from `build:` to `SITE_URL:`) with one line under `image:`:

```yaml
    image: website:latest
    pull_policy: never
```

`pull_policy: never` stops Docker from looking for `website:latest` on Docker Hub, where it doesn't exist. Click **Up**. From now on, an update is that `docker build` command followed by **Up**, which swaps the container for one with the new image.

## Part 2: Keep it public with Cloudflare Tunnel
{: .no-step}

## Add the tunnel to the compose file

This works exactly like in the Docker tutorial: a `cloudflared` container makes an outgoing connection to Cloudflare, so you don't open any ports on your router. If you don't have a tunnel yet, first follow *Put your domain on Cloudflare* and *Create a named tunnel and copy its token* in the [Docker tutorial]({{ '/tutorials/host-this-site-with-docker-and-cloudflare-tunnel/' | relative_url }}), then come back.

{% include callout.html type="warning" title="Moving from the Debian PC? Stop its tunnel first" text="Reusing the same token is the right move: the domain and route stay exactly as they are. But if the PC's `cloudflared` keeps running with that token too, Cloudflare treats both as the same tunnel and sends each visitor to either one. Right before you click **Up** below, run `docker compose down` in `~/workbench` on the PC, and remove its update job with `crontab -e`." %}

Edit the `website` compose file in **Services → Compose → Files** (select it, then the pencil icon). Add the `tunnel` service at the end of **File**, indented like `web:`:

{% include file.html name="website.yml" %}

```yaml
  # Cloudflare Tunnel: connects the site to your domain without opening router ports
  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: website-tunnel
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    restart: unless-stopped
    depends_on:
      web:
        condition: service_healthy
```

And change **Environment** to your public address and token:

{% include file.html name="Environment" %}

```text
SITE_URL=https://notes.example.com
TUNNEL_TOKEN=eyJhIjoiNmU3...the-whole-token...
```

Save and apply, then rebuild (because `SITE_URL` changed, and it's baked into the pages at build time) and start both containers:

```bash
sudo omv-compose-run website up -d --build
sudo omv-compose-run website logs tunnel | grep -i registered
```

```text
INF Registered tunnel connection connIndex=0 ... location=fra08 protocol=quic
INF Registered tunnel connection connIndex=1 ... location=ams15 protocol=quic
```

**The route doesn't change.** In the Cloudflare dashboard, the tunnel's published application route still says service `HTTP` and URL `web:80`. That address is read by `cloudflared` inside its container. Because both services are in the same compose file, they share the `website_default` network, and `web` is the site's container there. Notice it's port **80**, the port inside the container, not 8081: the tunnel never uses the NAS's ports at all. If you're creating the route for the first time, use exactly those values (see *Route your domain to the site* in the Docker tutorial).

Open `https://notes.example.com` on your phone with Wi-Fi off. That's the site, served by your NAS.

**Optional: close port 8081 to your network.** Visitors come in through the tunnel, so the published port is only for you at home. To make it reachable only from the NAS itself, change the ports line to `"127.0.0.1:8081:80"` and click **Up**. To drop it entirely, delete the `ports:` lines. Keep it if you like checking the site at `http://192.168.1.50:8081`.

## Part 3: Keep it up to date
{: .no-step}

## Update the site after you push

You still write on your Mac and push to GitHub; GitHub Pages updates itself. For the NAS copy, pull and rebuild:

```bash
cd /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/website
git pull
sudo omv-compose-run website up -d --build
sudo docker image prune -f
```

- **`git pull`** brings the new commits into the site folder.
- **`--build`** matters. The **Up** button on its own only builds when the image is *missing*, so after the first time it would happily restart the old site. Pull a change, click **Up**, see nothing new? That's why.
- **`docker image prune -f`** removes the previous image left behind by each rebuild. **Services → Compose → Images** shows them as `<none>` if you forget.

Later rebuilds are much faster than the first, a minute or two, because Docker reuses the gem layer unless the `Gemfile` changed.

{% include callout.html type="warning" text="Don't edit files in the `website` folder on the NAS, or over the SMB share. Make every change on your Mac and push it. Local edits make `git pull` stop with a conflict, and the site stops updating until you throw them away with `git restore .`." %}

## Update automatically with an OMV scheduled task

Let the NAS check GitHub every 15 minutes and rebuild only when something changed. Create the script over SSH:

```bash
sudo nano /usr/local/bin/update-website.sh
```

{% include file.html name="/usr/local/bin/update-website.sh" %}

```bash
#!/bin/sh
# Pull new commits from GitHub and rebuild the site, but only if something changed.
# Runs as root from OMV's Scheduled Tasks; Git runs as pi, who owns the folder.
set -eu
SITE=/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/website
git_pi() { sudo -u pi git -C "$SITE" "$@"; }

git_pi fetch --quiet origin main
if [ "$(git_pi rev-parse HEAD)" = "$(git_pi rev-parse origin/main)" ]; then
  exit 0
fi

echo "$(date '+%F %T') updating to $(git_pi rev-parse --short origin/main)"
git_pi merge --ff-only --quiet origin/main
omv-compose-run website up -d --build
docker image prune -f > /dev/null
```

Change `SITE=` to your path, then make it executable and try it once:

```bash
sudo chmod +x /usr/local/bin/update-website.sh
sudo /usr/local/bin/update-website.sh
```

No output means there was nothing new. That's fine.

Why `sudo -u pi` for Git? The script runs as `root`, because Docker needs it. If Git ran as root too, it would refuse to work in a folder owned by `pi` (*detected dubious ownership*) and leave root-owned files behind. So only Git runs as `pi`, and the rest as root.

Now schedule it in the OMV dashboard, under **System → Scheduled Tasks**, **+** → **Create**:

| Field | Value |
|---|---|
| **Enabled** | on |
| **Time of execution** | Certain date |
| **Minute** | `*/15` (every 15 minutes) |
| **Hour, Day of month, Month, Day of week** | `*` |
| **User** | `root` |
| **Command** | `/usr/local/bin/update-website.sh` |
| **Send command output via email** | on, if you set up email notifications in the [phone alerts tutorial]({{ '/tutorials/phone-alerts-for-your-raspberry-pi-nas/' | relative_url }}); you'll get a mail on every update and every failure |
| **Comment** | `Update website from GitHub` |

Save and apply. Push a small change from your Mac, wait up to 15 minutes, and refresh the site. If you use Cloudflare's HTML caching, purge the cache to see it straight away.

## Check that it survives a reboot

```bash
sudo reboot
```

After a minute or two, without logging in, the OMV dashboard should open on `http://192.168.1.50`, the site on `http://192.168.1.50:8081`, and the public address on `https://notes.example.com`. `restart: unless-stopped` brings both containers back as soon as Docker starts.

## Keep it healthy
{: .no-step}

- **Watch it.** **Services → Compose → Containers** shows both containers; the logs button shows their output. Over SSH: `sudo omv-compose-run website logs --tail 50 web`.
- **Update the base images monthly.** `nginx`, `ruby` and `cloudflared` get security fixes. Run `sudo omv-compose-run website build --pull`, then `sudo omv-compose-run website pull tunnel`, then `sudo omv-compose-run website up -d`. The **Pull** button in the Files tab only fetches `cloudflared`, since `website:latest` is built here, not downloaded.
- **Backups.** The site lives in Git and the image can be rebuilt any time. What exists only on the NAS is the compose file and its Environment box with the tunnel token. Keep a copy of both in your password manager.
- **Turn it off.** Select `website` in **Services → Compose → Files** and click **Down**. The GitHub Pages copy isn't affected.

## Troubleshooting
{: .no-step}

**Ports**

- **`Bind for 0.0.0.0:8081 failed: port is already allocated`**: another *container* already uses 8081. {% raw %}`sudo docker ps --format '{{.Names}} {{.Ports}}'`{% endraw %} shows which. Pick another port (8082, …) in the `ports:` line and click **Up**.
- **`failed to bind host port 0.0.0.0:80 … address already in use`**: the `ports:` line says `"80:80"`, and OMV's nginx has port 80. Use `"8081:80"` as on this page. The same goes for 443.
- **`address already in use` on a port that `docker ps` doesn't show**: a program outside Docker holds it. `sudo ss -tlnp | grep :8081` names it.
- **The phone can't open `http://192.168.1.50:8081`, but `curl http://localhost:8081` works on the NAS**: the `ports:` line probably says `127.0.0.1:8081:80`, which is NAS-only. Also check the phone isn't on mobile data or a guest Wi-Fi.
- **`http://192.168.1.50:8081` opens the OMV login instead of the site**: you typed the address without `:8081`, or the browser dropped it. Port 80 is OMV.

**Paths**

- **`unable to prepare context: path "/srv/…/website" not found`**: the `context:` path has a typo, or is still the example ID. Run `ls -d /srv/dev-disk-by-uuid-*/website` again and copy the result exactly.
- **`failed to read dockerfile: open docker/Dockerfile: no such file or directory`**: either `context:` points one folder too high or low (it must be the folder that *contains* `docker/`, `Gemfile` and `_config.yml`), or the clone is incomplete. `ls "$SITE"/docker/Dockerfile` should list it.
- **`COPY Gemfile ./` fails with `not found`**: `context:` is a relative path like `.` or `./website`. The plugin reads those from its own `compose/website/` folder. Use the full `/srv/…` path.
- **Pages load without styling, or links include `/cheatsheet-tutorial`**: the build didn't use the repository's `docker/Dockerfile` (which sets `baseurl: ""`), or you changed it. Check `dockerfile: docker/Dockerfile` and rebuild with `--build`.

**Permissions**

- **`git clone` or `git pull` says `Permission denied`**: the folder is still owned by root. Run `sudo chown -R pi:users "$SITE"`.
- **`fatal: detected dubious ownership in repository`**: Git ran as a different user than the folder's owner, usually because of `sudo git …`. Run Git without `sudo`, as `pi`. In the scheduled task, keep the `sudo -u pi` part of the script.
- **`omv-compose-run` or `docker` says `permission denied … docker.sock`**: you left out `sudo`.
- **`git pull` fails with `Your local changes would be overwritten`**: something edited the NAS copy (often an editor over SMB, or `.DS_Store` files from a Mac). `git status` lists them, `git restore .` throws them away. Setting the `website` share to read-only for users stops it happening again.

**Builds and updates**

- **The build stops at `bundle install`**: usually a download hiccup, or the Pi ran out of memory compiling a gem. Run the build again. If it keeps failing, `free -h` should show some swap; add more, or stop other big containers during the build.
- **You pushed a change, clicked Up, and the site didn't change**: **Up** doesn't rebuild an image that already exists. Use `sudo omv-compose-run website up -d --build`, or wait for the scheduled task.
- **The scheduled task runs but nothing updates**: run `sudo /usr/local/bin/update-website.sh` by hand and read the error. `Not possible to fast-forward` means local edits on the NAS (see above).

**Tunnel**

- **Visitors sometimes see the old site, sometimes the new one**: the Debian PC's `cloudflared` is still running with the same token. Run `docker compose down` there.
- **`502 Bad Gateway` on the public address**: the route should be `HTTP` and `web:80`. Not `localhost:8081`, not the NAS's IP, not `https`. And `website-web` should be `healthy` in `sudo omv-compose-run website ps`.
- **Error 1033**: no connector is running. `sudo omv-compose-run website logs tunnel` should show `Registered tunnel connection`; if it says the token is invalid, paste it into the Environment box again, the whole `eyJ…` string with no quotes or spaces.
