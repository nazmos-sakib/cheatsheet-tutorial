---
title: Host this site on a Debian PC with Docker and Cloudflare Tunnel
description: Run this Jekyll site in a Docker container on your own Debian machine, test it from your phone on the home network, then put it on the internet through a Cloudflare Tunnel without opening a single port on your router.
tags: [docker, cloudflare, self-hosting, linux, networking, jekyll]
related: [docker-basics-explained-simply, ssh-key-configuration-on-pi, systemd-mount-ssd-at-boot]
tested_on: "Docker Engine 29 with Compose v2, ruby:3.3 and nginx:stable-alpine images, cloudflared 2026.10. Written for Debian 13 (Trixie); Ubuntu and Mint work with the note in step 2."
time: "1 to 2 hours"
updated: 2026-10-17
---

GitHub Pages builds and hosts this site for free, and that copy keeps working. This tutorial adds a second home for it: a PC in your own house. You will:

1. Install Docker on a Debian-based PC.
2. Pack the site into a Docker image: Jekyll builds the pages, nginx serves them.
3. Open it from your phone or laptop on the same Wi-Fi to prove it works.
4. Connect it to the internet with a **Cloudflare Tunnel**, so anyone can open `https://notes.your-domain.com`, with HTTPS, and without touching your router.
5. Make it update itself whenever you push to GitHub.

The steps start from a fresh PC and get more advanced as you go. You can stop after step 10 if you only want it on your home network.

If words like *image*, *container*, *port* or *volume* are new, read [Docker basics, explained simply]({{ '/tutorials/docker-basics-explained-simply/' | relative_url }}) first. This page uses those words without explaining them again.

## The whole picture
{: .no-step}

```text
   Your Mac                    GitHub                     Debian PC at home
   ────────                    ──────                     ─────────────────
   edit a tutorial ─ git push ─► repository ── git pull ─► ~/workbench (a clone)
                                    │                          │ docker compose up --build
                                    ▼                          ▼
                             GitHub Pages copy        ┌─ container "web" ─────────┐
                          (*.github.io, unchanged)    │ nginx serving the built   │
                                                      │ site on port 80           │
                                                      └──────▲──────────▲─────────┘
                                                             │          │
                                  phone on your Wi-Fi ───────┘          │ Docker network
                                  http://192.168.1.50:8080              │
                                                      ┌─ container "tunnel" ──────┐
                                                      │ cloudflared, connects     │
                                                      │ OUT to Cloudflare         │
                                                      └──────────────┬────────────┘
                                                                     │ outbound only
                                                                     ▼
                                  anyone on the internet ──► Cloudflare ──► https://notes.example.com
```

Two containers, one Compose file:

- **`web`** holds the finished website and a small web server (nginx). Jekyll only runs while the image is being **built**; the running container is just static files and nginx, which is fast and has very little to attack.
- **`tunnel`** runs Cloudflare's connector, `cloudflared`. It dials **out** to Cloudflare and keeps that connection open. Visitors reach Cloudflare, and Cloudflare sends their requests back down that connection. Nothing on the internet ever connects **in** to your house, which is why you don't need port forwarding, a fixed public IP, or your own HTTPS certificate.

## What you need
{: .no-step}

- A PC running **Debian 12 or 13** (or Ubuntu, Linux Mint, or another Debian-based system), on your home network, with a user that can use `sudo`.
- This site pushed to a **GitHub repository** (see the README for the one-time GitHub setup).
- For Part 2: a free **Cloudflare account** and a **domain name** you can point at Cloudflare. You can try a temporary public link before you have a domain (step 13).

Everything below is typed on the Debian PC, either at its keyboard or over SSH from your Mac. To set up SSH logins with keys, see [SSH key configuration on pi]({{ '/tutorials/ssh-key-configuration-on-pi/' | relative_url }}); the same steps work on any Debian machine.

{% include callout.html type="note" text="The files this tutorial creates (`docker/Dockerfile`, `docker/nginx.conf`, `docker/update.sh`, `compose.yaml`, `.dockerignore` and `.env.example`) are already in this site's repository. You can read each step to understand them and skip the typing, or build them yourself from scratch." %}

## Part 1: Run the site on your home network
{: .no-step}

## Prepare the Debian PC

Bring the system up to date and install Git:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git curl
```

Find the PC's address on your home network. You'll type it into your phone later.

```bash
hostname -I
```

```text
192.168.1.50 fd12:3456:789a::50
```

The first number (here `192.168.1.50`) is its IPv4 address. This tutorial uses `192.168.1.50` everywhere; replace it with yours.

{% include callout.html type="tip" title="Keep that address fixed" text="Your router hands out addresses and may give the PC a different one next week. In the router's admin page, find **DHCP reservation** (sometimes called *static lease* or *address reservation*) and reserve the current address for this PC. The tunnel in Part 2 doesn't care about the address, but your bookmarks on the home network will." %}

## Install Docker Engine

Debian's own `docker.io` package is often old. Install Docker from Docker's official repository instead, so you get current Docker and the `docker compose` plugin.

First remove any older Docker packages, if they are there (it's fine if apt says none are installed):

```bash
sudo apt remove -y docker.io docker-compose docker-doc podman-docker containerd runc
```

Add Docker's signing key and repository:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
```

What that did:

- The **key** lets apt check that packages really come from Docker.
- The **`.sources` file** tells apt where Docker's packages live. `$(. /etc/os-release && echo "$VERSION_CODENAME")` fills in your Debian release name, for example `trixie` or `bookworm`.

{% include callout.html type="note" title="Ubuntu or Linux Mint?" text='Replace `linux/debian` with `linux/ubuntu` in both places, and use `$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")` for `Suites:`. Mint reports its own release name, so it needs the name of the Ubuntu release it is based on.' %}

Install Docker:

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Check it works:

```bash
sudo docker run --rm hello-world
```

You should see `Hello from Docker!`. Docker is also set to start automatically at every boot:

```bash
systemctl is-enabled docker
```

```text
enabled
```

### Use Docker without typing `sudo`

Add yourself to the `docker` group, then **log out and back in** (or reboot) so it takes effect:

```bash
sudo usermod -aG docker "$USER"
```

After logging back in, `docker run --rm hello-world` works without `sudo`. The rest of this tutorial assumes that.

{% include callout.html type="warning" text="Being in the `docker` group is the same as having root on this PC, because a container can be started with the whole disk mounted inside it. Only add users you'd trust with `sudo`." %}

## Try a test page from your phone

Before touching the site, prove that a container on this PC can be reached from another device. Start a plain nginx web server:

```bash
docker run -d --name hello -p 8080:80 nginx:stable-alpine
```

- `-d` runs it in the background.
- `-p 8080:80` connects port **8080 on the PC** to port **80 inside the container** (host side on the left).

On the PC itself:

```bash
curl -s http://localhost:8080 | grep title
```

```text
<title>Welcome to nginx!</title>
```

Now on your **phone or laptop, on the same Wi-Fi**, open `http://192.168.1.50:8080`. You should see "Welcome to nginx!".

If it works on the PC but not on the phone, jump to [Troubleshooting](#troubleshooting): it's almost always a firewall or "guest Wi-Fi" isolation.

Clean up the test container:

```bash
docker rm -f hello
```

## Get the site onto the PC

Clone your repository into a folder called `workbench` in your home folder. Use your own GitHub username and repository name:

```bash
git clone https://github.com/YOUR-USERNAME/cheatsheet-tutorial.git ~/workbench
cd ~/workbench
```

Everything from here on runs inside `~/workbench`.

{% include callout.html type="tip" text="If the repository is **private**, `git clone` over HTTPS will ask for a username and a *personal access token* (not your password). Easier: add an SSH key to GitHub and clone with `git@github.com:YOUR-USERNAME/cheatsheet-tutorial.git`." %}

## Write the Dockerfile

A Dockerfile is the recipe for an image. This one has **two stages**:

```text
 Stage 1 "build"  (ruby:3.3, about 1 GB)          Stage 2  (nginx:stable-alpine, about 50 MB)
 ───────────────────────────────────────          ──────────────────────────────────────────
 install Jekyll and the github-pages gems
 copy the site's source
 jekyll build  ──► /site  (plain HTML, CSS, JS)  ─── copy only /site ───►  nginx serves it
                                                                           ▲
 thrown away after the build                       this is the image you run
```

Building in one stage and serving from another keeps Ruby, compilers and gems **out** of the image that runs all day. It's smaller, starts instantly and has far fewer programs an attacker could use.

{% include file.html name="docker/Dockerfile" %}

```dockerfile
# syntax=docker/dockerfile:1

# ---------- Stage 1: build the site with Jekyll ----------
# The full ruby image already has the compilers some gems need.
# It's big, but only this stage uses it: the final image is just nginx.
FROM ruby:3.3 AS build

WORKDIR /src

# Install gems first, so this slow layer is reused when only content changes
COPY Gemfile ./
RUN bundle install

# Now the rest of the site
COPY . .

# The address people open this copy of the site at. Set SITE_URL in .env.
ARG SITE_URL=http://localhost:8080
ENV JEKYLL_ENV=production

# Serve from the root of the domain (baseurl ""), not /cheatsheet-tutorial
RUN printf 'url: "%s"\nbaseurl: ""\n' "$SITE_URL" > /tmp/_config.docker.yml \
 && bundle exec jekyll build --config _config.yml,/tmp/_config.docker.yml --destination /site

# ---------- Stage 2: serve the finished files with nginx ----------
FROM nginx:stable-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html

EXPOSE 80
```

Line by line, the parts that matter:

- **`FROM ruby:3.3 AS build`** starts stage 1 from the official Ruby image and names it `build`. The full (non-slim) image is used on purpose: some gems in `github-pages` compile C code, and this image already has the compilers.
- **`COPY Gemfile ./` then `RUN bundle install`**, before copying the rest. Docker caches each step. As long as the `Gemfile` doesn't change, the slow gem install is reused and a rebuild after editing a tutorial takes seconds instead of minutes.
- **`ARG SITE_URL`** is a value you pass in at build time (from `.env`, in the next steps). Jekyll uses it for full links, such as the sitemap and the page's canonical link.
- **`baseurl: ""`**. On GitHub Pages the site lives at `https://you.github.io/cheatsheet-tutorial/`, so `_config.yml` sets `baseurl` to `/cheatsheet-tutorial`. At home it will live at the **root** of its own address (`http://192.168.1.50:8080/` or `https://notes.example.com/`), so the build writes a tiny extra config file that sets `baseurl` to empty. Jekyll merges config files left to right, so the second one wins. Your `_config.yml` doesn't change, and GitHub Pages keeps working exactly as before.
- **`JEKYLL_ENV=production`** builds the site the same way GitHub Pages does.
- **`FROM nginx:stable-alpine`** starts stage 2 from a small image with only nginx in it.
- **`COPY --from=build /site ...`** copies the finished pages out of stage 1. Nothing else from stage 1 survives.

## Configure nginx

nginx needs to know a few things about a Jekyll site: tutorials live at addresses like `/tutorials/name/` (a folder with an `index.html` inside), and missing pages should show the site's own `404.html`.

{% include file.html name="docker/nginx.conf" %}

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Don't advertise the nginx version
    server_tokens off;

    # Redirect /about to /about/ without adding nginx's own port (80) to the URL
    absolute_redirect off;

    # Behind Cloudflare Tunnel, log the visitor's real IP, not cloudflared's.
    # Only trust that header from Docker's own networks (where cloudflared lives).
    set_real_ip_from 172.16.0.0/12;
    real_ip_header CF-Connecting-IP;

    # Jekyll's own 404 page
    error_page 404 /404.html;

    location / {
        # /tutorials/foo/ -> /tutorials/foo/index.html, /about -> /about.html
        try_files $uri $uri/ $uri.html =404;
    }

    # CSS, JS and images can be cached by browsers for a week
    location /assets/ {
        expires 7d;
    }

    # Smaller downloads for text files
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/xml;

    # Basic safety headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
```

- **`try_files $uri $uri/ $uri.html =404`**: for `/tutorials/foo/`, nginx looks for that file, then that folder's `index.html`, then `foo.html`, and only then gives up with a 404.
- **`error_page 404 /404.html`** shows this site's "Page not found" page instead of nginx's grey one.
- **`absolute_redirect off`** matters later: when someone opens `/about`, nginx redirects to `/about/`. Without this line it would build a full URL with its own port 80 and `http://`, which is wrong both on port 8080 and behind Cloudflare's HTTPS.
- **`real_ip_header CF-Connecting-IP`**: behind the tunnel, every request arrives from the `cloudflared` container. Cloudflare puts the visitor's real IP in this header, and nginx writes that one into its log. It only trusts the header from Docker's internal networks (`172.16.0.0/12`).
- **`expires 7d`** on `/assets/` lets browsers keep the CSS, JS and icons for a week.
- **`gzip`** compresses text so pages download faster.
- The three **`add_header`** lines are cheap security headers every site should send.

## Keep Docker files out of the build and out of the site

Two small housekeeping files.

**`.dockerignore`** lists what `COPY . .` must skip. It works like `.gitignore`. Without it, Docker would copy your `.git` history, old `_site` builds and your secret `.env` file into the image.

{% include file.html name=".dockerignore" %}

```text
.git
_site
.jekyll-cache
.jekyll-metadata
.sass-cache
.bundle
vendor
Gemfile.lock
.env
.DS_Store
```

**`_config.yml`**: Jekyll publishes every file it doesn't recognise. Add the new Docker files to the `exclude:` list so they don't appear on the website (on GitHub Pages too):

{% include file.html name="_config.yml" %}

```yaml
exclude:
  - README.md
  - templates/
  - Gemfile
  - Gemfile.lock
  - vendor/
  - .jekyll-cache/
  - compose.yaml
  - docker/
```

Files starting with a dot, like `.env` and `.dockerignore`, are skipped by Jekyll automatically.

And make sure Git never stores your `.env` (it will hold a secret in Part 2):

```bash
grep -qxF '.env' .gitignore || echo '.env' >> .gitignore
```

## Describe the setup in a Compose file

Instead of remembering a long `docker run` command, write down how to run everything in `compose.yaml` and let `docker compose` do it. This file is the same on every machine. Anything that differs per machine (the address, the port, later the tunnel's secret) comes from a separate `.env` file.

{% include file.html name="compose.yaml" %}

```yaml
# Runs this site in Docker. Per-machine settings live in .env
name: workbench

services:
  # The website: Jekyll builds it, nginx serves it
  web:
    build:
      context: .
      dockerfile: docker/Dockerfile
      args:
        SITE_URL: ${SITE_URL:-http://localhost:8080}
    image: workbench-site
    container_name: workbench-web
    ports:
      - "${WEB_PORT:-8080}:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1/"]
      interval: 30s
      timeout: 5s
      retries: 3

  # Cloudflare Tunnel: only starts when COMPOSE_PROFILES=tunnel is set in .env
  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: workbench-tunnel
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:-}
    restart: unless-stopped
    depends_on:
      web:
        condition: service_healthy
    profiles: [tunnel]
```

Reading it from the top:

- **`name: workbench`** names the project. Docker uses it for the network it creates (`workbench_default`), which you'll need in step 13.
- **`build:`** tells Compose to build the image from `docker/Dockerfile`, using the repository folder (`.`) as the files it can copy. `args:` passes `SITE_URL` into the Dockerfile's `ARG`.
- **`${SITE_URL:-http://localhost:8080}`** means "the value of `SITE_URL` from `.env`, or `http://localhost:8080` if it isn't set". Same idea for `${WEB_PORT:-8080}`.
- **`ports: "${WEB_PORT:-8080}:80"`** publishes the container's port 80 on the PC's port 8080, so your phone can reach it.
- **`restart: unless-stopped`** brings the container back after a crash or a reboot, unless you stopped it yourself.
- **`healthcheck`** asks nginx for the home page every 30 seconds. `docker compose ps` shows `healthy` when it answers, and the tunnel in Part 2 waits for that before starting.
- **`tunnel`** is there already but has `profiles: [tunnel]`. A service with a profile only starts when that profile is switched on, so for now Compose ignores it completely.

Now create this machine's `.env` from the example:

```bash
cp .env.example .env
nano .env
```

{% include file.html name=".env" %}

```bash
# Copy this file to .env and edit it. .env is never committed to Git.

# The address people will use to open the site (used for links in the sitemap and page headers)
SITE_URL=http://192.168.1.50:8080

# Which host port shows the site. "8080" = every device on your network,
# "127.0.0.1:8080" = only this PC (use this once the tunnel works)
WEB_PORT=8080

# Uncomment both lines once you have a Cloudflare Tunnel (Part 2)
#COMPOSE_PROFILES=tunnel
#TUNNEL_TOKEN=paste-your-token-here
```

Set `SITE_URL` to `http://` plus **your PC's address** and `:8080`. Leave the rest for now. Save with `Ctrl+O`, `Enter`, and exit with `Ctrl+X`.

## Build and start the site

```bash
docker compose up -d --build
```

The first build downloads the Ruby image and installs all the gems, so give it a few minutes. Later builds reuse that work. When it finishes:

```bash
docker compose ps
```

```text
NAME            IMAGE            COMMAND                  SERVICE   CREATED          STATUS                    PORTS
workbench-web   workbench-site   "/docker-entrypoint.…"   web       40 seconds ago   Up 39 seconds (healthy)   0.0.0.0:8080->80/tcp
```

`(healthy)` can take up to 30 seconds to appear; before that it says `(health: starting)`.

Check from the PC:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/tutorials/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/this-page-does-not-exist
```

```text
200
200
404
```

To see nginx's log as requests come in (stop with `Ctrl+C`):

{% include cmd.html sheet="docker" id="logs-f" %}

Use `web` as the service name: `docker compose logs -f web`.

## Test it from another device

On your phone or laptop, on the same Wi-Fi, open:

```text
http://192.168.1.50:8080
```

Click around: the tutorials list, a cheatsheet, the search, dark mode, and a made-up address to see the 404 page. Everything should behave exactly like the GitHub Pages copy, just without `/cheatsheet-tutorial` in the addresses.

{% include callout.html type="note" text="This is plain `http://` on your home network, so the browser may say **Not secure**. That's expected. Part 2 gives the public address real HTTPS through Cloudflare." %}

If you got here, Part 1 is done: the site is running in Docker and reachable on your network.

## Publish changes to the home copy

Your workflow stays the same: edit on your Mac, commit, push to GitHub. GitHub Pages rebuilds itself. For the copy at home, pull and rebuild:

```bash
cd ~/workbench
git pull
docker compose up -d --build
```

`--build` rebuilds the image with the new content, then Compose swaps the old container for the new one. The site is unavailable for only a second or two.

Each rebuild leaves the old image behind as an unnamed (`<none>`) image. Clear them out now and then:

```bash
docker image prune -f
```

Step 18 makes all of this automatic.

{% include callout.html type="tip" text="Changing `SITE_URL` or anything else in `.env` that the **build** uses only takes effect after a rebuild, so always use `--build` after editing `.env`." %}

## Part 2: Make it public with Cloudflare Tunnel
{: .no-step}

## How the tunnel works, and why it's safe
{: .no-step}

The usual way to host from home is **port forwarding**: you tell your router "send everything that arrives on port 443 to this PC". That has problems: your home IP address is public, it can change, many internet providers block incoming connections, and your PC is now directly exposed to the whole internet.

A Cloudflare Tunnel flips the direction around:

```text
  Port forwarding                              Cloudflare Tunnel
  ───────────────                              ─────────────────
  visitor ──► your home IP:443                 visitor ──► Cloudflare (HTTPS, your domain)
            │  (hole in your router)                         │
            ▼                                                │  sent down the tunnel
         your PC                                             ▼
                                               cloudflared on your PC ◄── it dialed OUT
                                                     │                    to Cloudflare first
                                                     ▼
                                                 web container
```

- `cloudflared` opens an **outbound** connection to Cloudflare, just like your browser does. Routers allow outbound connections, so there's nothing to configure on the router.
- Visitors only ever talk to **Cloudflare**. They never learn your home IP address.
- Cloudflare handles **HTTPS certificates** for your domain automatically.
- The **tunnel token** is the only secret. Whoever has it can attach a connector to your tunnel, so you'll keep it in `.env` and never commit it.

## Put your domain on Cloudflare

The tunnel needs a domain whose DNS is managed by Cloudflare. If yours already is, skip to step 13.

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (create a free account if needed).
2. Choose **Add a domain** (it may say *Add a site* or *Onboard a domain*), type your domain, and pick the **Free** plan.
3. Cloudflare shows you **two nameservers**, such as `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`.
4. Log in where you bought the domain (your registrar), find the **nameservers** setting for the domain, and replace the existing ones with Cloudflare's two.
5. Back in Cloudflare, wait until the domain shows as **Active**. It's often a few minutes, occasionally up to a day. Cloudflare emails you when it's done.

{% include callout.html type="tip" text="No domain yet? You can buy one directly in the Cloudflare dashboard under **Domain registration**, at cost price, and it's on Cloudflare from the start." %}

## Try a temporary public link first (optional)

You can see the tunnel idea working before you have a domain. Cloudflare's **quick tunnels** give you a random `trycloudflare.com` address, no account needed. With the site running from Part 1:

```bash
docker run --rm --network workbench_default cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://web:80
```

- `--network workbench_default` puts this temporary container on the same Docker network as the site, so it can reach it by its service name.
- `--url http://web:80` is "the website is at `web`, port 80". **Not** `localhost:8080`: inside the cloudflared container, `localhost` is the cloudflared container itself (the [localhost trap]({{ '/tutorials/docker-basics-explained-simply/' | relative_url }}#the-localhost-trap)).

After a few seconds the log shows a box with an address:

```text
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://random-words-here.trycloudflare.com                                               |
```

Open it on your phone with **Wi-Fi turned off**, to be sure it's really coming over the internet. Press `Ctrl+C` to stop; the address dies with it.

{% include callout.html type="warning" text="While a quick tunnel runs, **anyone** with that address can open the site. That's fine for a public website, but never point one at something private, like a router page or a NAS dashboard." %}

Quick tunnels are for testing only: the address changes every time and there's no uptime guarantee. The next steps make a permanent one on your own domain.

## Create a named tunnel and copy its token

In the Cloudflare dashboard:

1. Open **Zero Trust** from the left sidebar. The first time, it asks you to pick a team name and the **Free** plan (no payment needed for this).
2. Go to **Networks → Tunnels**. Newer dashboards file this under **Networks → Connectors → Cloudflare Tunnels**.
3. Choose **Create a tunnel**, pick **Cloudflared** as the connector type, and name it `workbench`.
4. On the **Install and run a connector** page, choose **Docker**. Cloudflare shows a command like:

   ```text
   docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoiNmU3...
   ```

5. Copy **only the long string after `--token`**, the part that starts with `eyJ`. Don't run the command: Compose will run cloudflared for you.

Leave this browser tab open and go back to the PC.

## Add the tunnel to Compose

Open `.env` again:

```bash
nano .env
```

Change it like this, using your real subdomain, domain and token:

{% include file.html name=".env" %}

```bash
SITE_URL=https://notes.example.com

WEB_PORT=127.0.0.1:8080

COMPOSE_PROFILES=tunnel
TUNNEL_TOKEN=eyJhIjoiNmU3...the-whole-token...
```

Three changes:

- **`SITE_URL`** is now the public address, so the sitemap and canonical links point there.
- **`WEB_PORT=127.0.0.1:8080`** closes the port to the rest of your network. The site is still reachable at `http://localhost:8080` on the PC itself, for checking. Visitors don't need the port at all: `cloudflared` reaches `web` over Docker's private network. If you'd still like to open it from your phone at home, leave `WEB_PORT=8080`.
- **`COMPOSE_PROFILES=tunnel`** switches on the `tunnel` service in `compose.yaml`, and **`TUNNEL_TOKEN`** is passed to it.

Here is the `tunnel` service from `compose.yaml` again, now that it matters:

```yaml
  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: workbench-tunnel
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:-}
    restart: unless-stopped
    depends_on:
      web:
        condition: service_healthy
    profiles: [tunnel]
```

- **`tunnel --no-autoupdate run`** starts the connector. It reads the token from the `TUNNEL_TOKEN` environment variable, so the secret never appears in `docker ps` or in the file. `--no-autoupdate` is right for containers: you update by pulling a new image, not by the program replacing itself.
- **`depends_on ... service_healthy`** waits until nginx answers before connecting, so Cloudflare never sends visitors to a site that isn't up yet.

Lock the file down so only you can read it, then rebuild and start both containers:

```bash
chmod 600 .env
docker compose up -d --build
docker compose ps
```

```text
NAME               IMAGE                           SERVICE   STATUS                   PORTS
workbench-tunnel   cloudflare/cloudflared:latest   tunnel    Up 5 seconds
workbench-web      workbench-site                  web       Up 2 minutes (healthy)   127.0.0.1:8080->80/tcp
```

Check the tunnel connected:

```bash
docker compose logs tunnel | grep -i registered
```

```text
INF Registered tunnel connection connIndex=0 ... location=fra08 protocol=quic
INF Registered tunnel connection connIndex=1 ... location=ams15 protocol=quic
```

Several `Registered tunnel connection` lines are normal: cloudflared keeps a few connections to different Cloudflare data centres in case one drops. In the dashboard, the tunnel's status turns **Healthy**.

## Route your domain to the site

The tunnel is connected, but Cloudflare doesn't yet know which address should lead to it. Back in the dashboard tab, continue to the routing step (or open the tunnel later and use **Edit** → **Published application routes**, which older dashboards call **Public Hostnames**). Add a route:

| Field        | Value                                      |
| ------------ | ------------------------------------------ |
| Subdomain    | `notes` (or leave empty to use the bare domain) |
| Domain       | your domain                                 |
| Path         | leave empty                                 |
| Service type | `HTTP`                                      |
| URL          | `web:80`                                    |

Save. Cloudflare creates the DNS record for `notes.example.com` for you.

`web:80` is read **by cloudflared, inside its container**, so it uses the Compose service name, exactly like the quick tunnel did. The service type is `HTTP`, not `HTTPS`, because the hop from cloudflared to nginx stays inside your PC; visitors still get HTTPS from Cloudflare.

Open `https://notes.example.com` on your phone with Wi-Fi off. That's your site, served from your PC, with a padlock.

## Tighten the Cloudflare settings

A few one-time switches in the Cloudflare dashboard, under your domain:

- **SSL/TLS → Edge Certificates → Always Use HTTPS: On.** Anyone typing `http://` is sent to `https://`.
- **SSL/TLS → Edge Certificates → Minimum TLS Version: 1.2.**
- **Caching**: Cloudflare already caches CSS, JS and images at its edge. To cache the HTML pages too (great for a static site, and it means your PC barely gets any traffic), add a **Cache Rule** for your hostname with *Eligible for cache* and an edge TTL of a few hours. After publishing a change, use **Caching → Configuration → Purge Everything** so visitors see it straight away.

If you ever want the home copy to be **private** (just you, for drafts), Cloudflare Zero Trust has **Access → Applications**: add a self-hosted application for `notes.example.com` with a policy like "emails ending in your address". Visitors then have to log in before Cloudflare lets them through. The tunnel itself doesn't change.

## Part 3: Make it run itself
{: .no-step}

## Update automatically when you push to GitHub

Instead of logging in to pull and rebuild, let the PC check GitHub every 15 minutes and rebuild only when there's something new. The repository has a small script for that:

{% include file.html name="docker/update.sh" %}

```bash
#!/bin/sh
# Pull new commits from GitHub and rebuild the site, but only if something changed.
set -eu
cd "$(dirname "$0")/.."

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi

echo "$(date '+%F %T') updating to $(git rev-parse --short origin/main)"
git merge --ff-only --quiet origin/main
docker compose up -d --build
docker image prune -f > /dev/null
```

- `git fetch` downloads new commits without changing your files yet.
- If your copy (`HEAD`) is already the same as GitHub's `origin/main`, it stops: no rebuild, no noise.
- Otherwise `git merge --ff-only` moves to the new commit. `--ff-only` refuses to do anything clever if the PC's copy has changes of its own, so the script fails loudly instead of creating a mess.
- Then it rebuilds and restarts, and removes the leftover old image.

Make it executable and try it once by hand:

```bash
chmod +x docker/update.sh
./docker/update.sh && echo "up to date"
```

Then schedule it with cron. Open your user's crontab:

```bash
crontab -e
```

Add this line at the bottom:

```text
*/15 * * * * $HOME/workbench/docker/update.sh >> $HOME/workbench-update.log 2>&1
```

`*/15 * * * *` means "every 15 minutes". Output and errors go to `~/workbench-update.log`, so you can check what happened:

```bash
tail ~/workbench-update.log
```

```text
2026-10-15 14:30:01 updating to 3f2a9c1
```

Now publishing a tutorial is just `git push` on your Mac: GitHub Pages updates in about a minute, and the home copy within 15.

{% include callout.html type="tip" text="Prefer systemd over cron? A `.service` that runs the script plus a `.timer` with `OnCalendar=*:0/15` does the same job, and its output lands in `journalctl`. [Writing systemd units: mount an SSD at boot]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}) explains how unit files work." %}

{% include callout.html type="warning" text="Don't edit files inside `~/workbench` on the PC (except `.env`, which Git ignores). Make every change on your Mac and push it. If the PC's copy has its own changes, `git merge --ff-only` stops and the site stops updating until you undo them with `git status` and `git restore`." %}

### If your `docker` commands still need `sudo`

If you skipped the `docker` group in step 2 and still type `sudo docker ...`, the script above can't rebuild the site. Cron runs it as your user, nobody is there to type a password, and `docker` without `sudo` stops with `permission denied`. The `git` part still works, so the PC fetches your changes but never rebuilds. You'll see the error in `~/workbench-update.log`.

The fix is to let your user run `docker`, and only `docker`, through `sudo` without a password. Create a sudoers rule:

```bash
sudo visudo -f /etc/sudoers.d/docker-nopasswd
```

`visudo` opens an empty file. Add this line, using your own username (`whoami` prints it):

{% include file.html name="/etc/sudoers.d/docker-nopasswd" %}

```text
yourusername ALL=(root) NOPASSWD: /usr/bin/docker
```

Save and exit. If nano offers a name ending in `.tmp`, keep it and press `Enter`: `visudo` edits a temporary copy, checks it for mistakes, and only then renames it to `docker-nopasswd`. If it finds a mistake it asks `What now?`. Press `e` to fix it. A broken sudoers file can lock you out of `sudo`, which is why you use `visudo` and not plain `nano`.

Check it works. This should list your containers without asking for a password:

```bash
sudo -n docker ps
```

Then put `sudo -n` in front of the two `docker` lines at the end of `docker/update.sh`. Make this change on your Mac, then commit and push it like any other change:

{% include file.html name="docker/update.sh" %}

```bash
sudo -n docker compose up -d --build
sudo -n docker image prune -f > /dev/null
```

`-n` means "never ask for a password". If the rule is missing, `sudo` fails straight away with an error in the log instead of waiting forever for a password. Your crontab line stays exactly the same, and `git` still runs as you, so the files in `~/workbench` stay owned by you.

{% include callout.html type="note" text="Running `sudo docker` without a password gives the same power as being in the `docker` group, since both effectively mean root. This rule isn't safer than the group; it just keeps the password prompt for everything else. Don't run the script from root's crontab (`sudo crontab -e`) instead: Git would then run as root in your folder, refuse with *dubious ownership*, and leave root-owned files behind." %}

## Check that it survives a reboot

Docker starts at boot, and `restart: unless-stopped` brings both containers back with it. Prove it once:

```bash
sudo reboot
```

After the PC is back (give it a minute):

```bash
docker compose -f ~/workbench/compose.yaml ps
```

Both containers should be `Up`, and `https://notes.example.com` should open again without you doing anything.

## Keep it healthy
{: .no-step}

Things worth doing now and then, or knowing about:

- **See what's happening.** `docker compose logs --tail 50 web` shows recent visits (with real visitor IPs thanks to the nginx setting); `docker compose logs --tail 50 tunnel` shows the connector. `docker stats` shows CPU and memory per container. The [Docker and Docker Compose cheatsheet]({{ '/cheatsheets/docker/' | relative_url }}) has the rest.
- **Update the base images.** The `nginx:stable-alpine`, `ruby:3.3` and `cloudflared` images get security fixes. Once a month:

  ```bash
  cd ~/workbench
  docker compose pull tunnel
  docker compose build --pull
  docker compose up -d
  docker image prune -f
  ```

  `build --pull` re-downloads the base images before building; `pull tunnel` fetches the newest cloudflared.
- **Keep Debian updated.** `sudo apt update && sudo apt full-upgrade` also updates Docker itself, since it came from Docker's apt repository.
- **Backups.** There's almost nothing to lose: the site is in Git, and the images can be rebuilt any time. The only thing that exists only on this PC is `.env`. Keep a copy of the token in a password manager, or simply create a new token if you rebuild the PC.
- **If the token leaks** (for example you committed `.env` by accident): in the dashboard open the tunnel and **refresh/rotate the token**, or delete the tunnel and create a new one. Put the new token in `.env` and run `docker compose up -d`.
- **Pin versions, if you like stability over freshness.** Replace `cloudflare/cloudflared:latest` with a fixed version such as `cloudflare/cloudflared:2026.10.0`, and bump it yourself when you choose to.
- **Turn it off.** `docker compose down` stops and removes both containers. The site goes offline at `notes.example.com`; the GitHub Pages copy is unaffected. `docker compose up -d` brings it back.

## Troubleshooting
{: .no-step}

**On the home network**

- **Works on the PC with `curl`, but the phone can't load `http://192.168.1.50:8080`:**
  - Make sure the phone is on the same network, not mobile data or a **guest Wi-Fi** (guest networks usually block access to other devices).
  - Check the address with `hostname -I` again; it may have changed (see the DHCP reservation tip in step 1).
  - Check `WEB_PORT` in `.env` is `8080`, not `127.0.0.1:8080`, then `docker compose up -d`.
  - If you installed a firewall such as `ufw`, note that Docker opens published ports itself and normally bypasses `ufw`. If you're using `firewalld` or another tool, allow TCP port 8080.
- **`permission denied while trying to connect to the Docker daemon socket`**: you're not in the `docker` group yet. Run the `usermod` command in step 2, then log out and back in. `groups` should list `docker`.
- **`Bind for 0.0.0.0:8080 failed: port is already allocated`**: something else uses port 8080 (maybe the `hello` test container). `docker ps` shows it; remove it, or set `WEB_PORT=8081` in `.env`.

**During the build**

- **The build stops at `bundle install`**: usually a network hiccup while downloading gems. Run `docker compose build` again. If it keeps failing, `docker compose build --no-cache --progress=plain` shows every line of output.
- **`No repo name found. Specify using PAGES_REPO_NWO ...`**: the `github-pages` gem sometimes asks which GitHub repository this is. Add one line to `_config.yml`: `repository: YOUR-USERNAME/cheatsheet-tutorial`. It's harmless on GitHub Pages too.
- **Pages load but have no styling, or links point to `/cheatsheet-tutorial/...`**: the build didn't get `baseurl: ""`. Check the `RUN printf ...` line in the Dockerfile is unchanged, and rebuild with `docker compose up -d --build`.
- **Links in the sitemap show the wrong address**: `SITE_URL` in `.env` is wrong, or you didn't rebuild after changing it.
- **The PC is running out of disk space**: old images and build cache add up. `docker system df` shows how much; `docker image prune -f` and `docker builder prune -f` free most of it.

**With the tunnel**

- **`docker compose ps` doesn't list `workbench-tunnel` at all**: `COMPOSE_PROFILES=tunnel` is missing from `.env`, or still has a `#` in front of it.
- **`workbench-tunnel` keeps restarting, log says `Provided Tunnel token is not valid`**: the token was copied incompletely or with extra characters. Copy it again from the dashboard, the whole `eyJ...` string with no spaces or quotes, then `docker compose up -d`.
- **The public address shows Cloudflare error 1033**: Cloudflare can't find a running connector for the tunnel. Check `docker compose logs tunnel` for `Registered tunnel connection`; if it's not there, the container isn't running or can't reach the internet.
- **The public address shows error 502 Bad Gateway**: the tunnel works but can't reach the site. Check the route's service is `HTTP` and `web:80` (not `localhost:8080`, not `https`), and that `docker compose ps` shows `workbench-web` as `healthy`.
- **`DNS_PROBE_FINISHED_NXDOMAIN` or "site can't be reached"**: the route wasn't saved, or the domain isn't **Active** on Cloudflare yet (step 12). In **DNS → Records** there should be a `CNAME` for `notes` pointing to `<long-id>.cfargotunnel.com`.
- **A change is live on GitHub Pages but not at home**: check `tail ~/workbench-update.log`. If it mentions `Not possible to fast-forward`, the PC's copy has local edits: `cd ~/workbench && git status` shows them, `git restore .` throws them away. If nothing changed on the page, Cloudflare may be serving a cached copy; purge the cache.
