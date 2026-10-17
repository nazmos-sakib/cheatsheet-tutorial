---
title: Docker basics, explained simply
description: What images, containers, ports, volumes and container IPs really are, told with lunchboxes and apartment buildings, plus the handful of commands you actually need.
tags: [docker, basics, networking, concepts]
related: [install-npm-packages-with-docker]
tested_on: "Docker Engine 27 on Linux (Raspberry Pi OS), Docker Desktop on macOS"
time: "20 minutes to read"
updated: 2026-10-15
---

Docker gets confusing because a lot of new words arrive at once: image, container, port, volume, network. This page explains each one with a picture you can keep in your head, so the next time you read a `docker run` command you know what every part is doing.

You don't need to type anything to follow along. There is a short list of commands at the end for when you want to try it.

## The big idea: a lunchbox for programs

Imagine you cook a great meal at home and take it to a friend's house. In their kitchen the oven is different, a spice is missing, and it tastes wrong. "It works on my machine" is the same problem for programs: the app needs a certain version of Python, some libraries and a few settings, and the other computer has different ones.

Docker's answer is to **pack the program together with everything it needs** into one sealed box. The box runs the same way on your Mac, on a Raspberry Pi or on a server, because it brings its own kitchen.

```text
   Without Docker                         With Docker
   ──────────────                         ───────────
   your app                               ┌──────────────────────┐
     needs Python 3.12 ── you hope the    │ your app             │
     needs libssl 3   ── computer has     │ Python 3.12          │  one box,
     needs config X   ── all of these     │ libssl 3, config X   │  runs anywhere
                                          └──────────────────────┘
```

{% include callout.html type="note" text="A container is **not** a full virtual machine. It shares the host computer's Linux kernel (the core of the operating system) and only brings the files and programs on top of it. That's why it starts in a second and uses little memory." %}

## Image vs container: the recipe and the cake

This is the one that confuses people most, so take it slowly.

- An **image** is a **recipe** (or a cake mould). It is a frozen, read-only package of files: the operating system bits, the app, its libraries. It does nothing on its own. Examples: `nginx`, `postgres:16`, `node:24-bookworm-slim`.
- A **container** is a **cake baked from that recipe**. It is the image actually running, with its own little bit of writable space on top.

One recipe can make many cakes. One image can run as many containers at the same time, each separate from the others.

```text
                 ┌─────────────────┐
                 │  IMAGE: nginx   │   read-only recipe
                 └────────┬────────┘
          docker run      │      docker run       docker run
        ┌─────────────────┼─────────────────┬─────────────────┐
        ▼                 ▼                 ▼
 ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
 │ container A │   │ container B │   │ container C │   running cakes,
 │  (running)  │   │  (running)  │   │  (stopped)  │   each with its own
 └─────────────┘   └─────────────┘   └─────────────┘   scratch space
```

Where do images come from?

- **Docker Hub** (hub.docker.com) is a big shop of ready-made images. `docker pull nginx` downloads one.
- A **Dockerfile** is your own recipe card. `docker build` follows it and produces your own image.

The name after the colon is the **tag**, which is usually the version: `postgres:16` and `postgres:17` are different images. No tag means `:latest`.

{% include callout.html type="warning" title="Containers forget" text="Anything a container writes inside itself is thrown away when the container is **removed** (stopping it is fine, removing it is not). If you want data to survive, keep it in a volume or a bind mount, explained below." %}

### What a container's life looks like

```text
  docker run ─►  RUNNING  ── docker stop ─►  STOPPED  ── docker rm ─►  GONE
                    ▲                           │
                    └──────── docker start ─────┘
```

A container lives as long as its **main program** keeps running. When that program finishes or crashes, the container stops. That's why a container that "just exits immediately" usually means its main program had nothing to do or hit an error: `docker logs` tells you which.

## What's inside a container: its own little world

Each container gets its own private copy of a few things, as if it lived in its own apartment:

| A container has its own... | Like an apartment's...  | What that means                                                        |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| File system                | rooms and furniture     | It sees `/`, `/etc`, `/app`... from its image, not your computer's files. |
| Processes                  | people living there     | Inside, `ps` only shows the container's own programs.                   |
| Network and IP address     | door number and doorbell| It has its own IP and its own `localhost`.                             |
| Hostname                   | name on the door        | Usually the short container ID unless you set one.                      |

All the apartments share the same building (the host's kernel, CPU and memory). The walls keep them from seeing into each other.

```text
 ┌──────────────── host computer (the building) ────────────────┐
 │                                                               │
 │  ┌─ container: web ──┐  ┌─ container: db ───┐  ┌─ app ─────┐  │
 │  │ files from nginx  │  │ files from        │  │ files from│  │
 │  │ own processes     │  │ postgres image    │  │ node image│  │
 │  │ IP 172.18.0.2     │  │ IP 172.18.0.3     │  │ IP ...0.4 │  │
 │  └───────────────────┘  └───────────────────┘  └───────────┘  │
 │                                                               │
 │  Docker Engine (the building manager)   +   shared Linux kernel│
 └───────────────────────────────────────────────────────────────┘
```

## Ports: the doorbell on the outside wall

Say a container runs a website on port 80. Port 80 is a doorbell **inside the container's apartment**. People on the street (your browser, other devices on your Wi-Fi) can't reach it, because they can only ring doorbells on the outside of the building: the host's ports.

**Port mapping** (also called publishing) wires an outside doorbell to the inside one:

```bash
docker run -d -p 8080:80 nginx
```

Read `-p 8080:80` as **"host port 8080 rings container port 80"**. The host side is always on the **left**.

```text
   your browser
   http://localhost:8080   (or http://<pi-ip>:8080 from another device)
          │
          ▼
 ┌─ host ─────────────── port 8080 ──┐
 │                          │        │
 │        ┌─ container ─────▼──────┐ │
 │        │  nginx listening on 80 │ │
 │        └────────────────────────┘ │
 └───────────────────────────────────┘
```

A few things that make ports click:

- **Two containers can both use port 80 inside**, because each has its own apartment. They just need **different host ports**: `-p 8080:80` and `-p 8081:80`.
- **Two things can't share one host port.** If 8080 is already taken on the host, Docker says `port is already allocated`. Pick another left-hand number.
- **No `-p`, no access from outside.** The container still runs, other containers on its network can still reach it, but your browser can't.
- `-p 127.0.0.1:8080:80` publishes the port **only to the host itself**, so other devices on your network can't reach it. Plain `-p 8080:80` opens it to everyone who can reach the host.

{% include callout.html type="note" text='`EXPOSE 80` in a Dockerfile is only a label saying "this app listens on 80". It does **not** open anything. Only `-p` (or `ports:` in Compose) publishes a port.' %}

## Folders: volumes and bind mounts

Remember that containers forget. To keep data, you give the container a folder that lives **outside** it and plug it in at a path inside. There are two kinds.

**Bind mount: lend it one of your folders.** You pick an exact folder on the host, and it appears inside the container. Both sides see the same files instantly. Great for code you are editing, or config files.

```bash
docker run -v "$PWD/site:/usr/share/nginx/html" -p 8080:80 nginx
```

**Named volume: a storage locker Docker looks after.** You give it a name, and Docker decides where to keep it on disk. Great for databases and app data you don't need to open by hand.

```bash
docker run -v pgdata:/var/lib/postgresql/data postgres:16
```

The rule for reading `-v` is the same as for ports: **host side on the left, container side on the right**. If the left side is a path (starts with `/` or `./` or `$PWD`), it's a bind mount; if it's just a name, it's a volume.

```text
 host                                       container
 ────                                       ─────────
 /home/pi/site  ────── bind mount ───────►  /usr/share/nginx/html
 (a folder you chose)

 volume "pgdata" ───── named volume ─────►  /var/lib/postgresql/data
 (Docker keeps it under /var/lib/docker/volumes/)

 everything else in the container ───────►  thrown away on docker rm
```

| | Bind mount | Named volume |
| --- | --- | --- |
| You choose where it lives | Yes, an exact host path | No, Docker manages it |
| Easy to open and edit from the host | Yes | Not really |
| Survives `docker rm` | Yes | Yes |
| Typical use | Source code, config files | Database files, app data |

{% include callout.html type="warning" text="`docker compose down -v` and `docker volume rm` **delete named volumes** and the data in them. Bind-mounted folders are just your folders and are never deleted by Docker." %}

## IP addresses and networks: the building's private hallway

Docker builds a **private network** inside your computer, like a hallway only the apartments open onto. Each container plugged into it gets its own IP address, usually something like `172.17.0.2` or `172.18.0.3`. Those addresses only mean something **inside the host**; your phone or laptop on the same Wi-Fi can't see them.

```text
  other devices on your Wi-Fi
            │   can only reach the host's IP + published ports
            ▼
 ┌──── host  (e.g. 192.168.1.50) ──────────────────────────────┐
 │                                                              │
 │   private Docker network "myapp"   (172.18.0.0/16)           │
 │   ═══════════════════════════════════════════════            │
 │        │                    │                    │           │
 │   ┌────┴─────┐        ┌─────┴────┐         ┌─────┴────┐      │
 │   │ web      │        │ api      │         │ db       │      │
 │   │172.18.0.2│        │172.18.0.3│         │172.18.0.4│      │
 │   └──────────┘        └──────────┘         └──────────┘      │
 │     -p 8080:80         (no -p)               (no -p)         │
 └──────────────────────────────────────────────────────────────┘
```

### Talk by name, not by IP

Container IPs can change every time a container is recreated, so don't write them into config. Instead, put containers on the **same user-made network** and they can find each other **by container name**, the way neighbours knock on "the db apartment" instead of remembering a number:

```bash
docker network create myapp
docker run -d --name db  --network myapp -e POSTGRES_PASSWORD=secret postgres:16
docker run -d --name api --network myapp my-api-image
# inside "api", the database is simply at  db:5432
```

Docker Compose does this for you: every service in one `compose.yml` joins a shared network, and the **service name** is its hostname.

{% include callout.html type="note" text="On Docker's built-in default network (the one you get with no `--network`), names don't work, only IPs. That's the main reason to create your own network or use Compose." %}

### The `localhost` trap

Inside a container, `localhost` means **that container itself**, not your computer and not the other containers.

- App in container A connecting to `localhost:5432` looks for a database **inside A** and fails. Use `db:5432` (the other container's name) instead.
- To reach a program running on the host from a container: on Docker Desktop (Mac and Windows) use `host.docker.internal`. On Linux, add `--add-host=host.docker.internal:host-gateway` to `docker run` to get the same name.

### Container-to-container vs outside-to-container

| Who is connecting | How they connect | Needs `-p`? |
| --- | --- | --- |
| Your browser on the host | `localhost:<host port>` | Yes |
| Another device on your network | `<host IP>:<host port>` | Yes |
| Another container on the same network | `<container name>:<container port>` | No |

Note that container-to-container uses the **container's** port (the right-hand number), not the host one.

{% include callout.html type="tip" text="On a Mac, Docker Desktop runs containers inside a small hidden Linux virtual machine, so you can't ping a container's `172.x` IP from macOS. Use published ports (`localhost:8080`) instead. On a Linux machine like the Pi, the host can reach container IPs directly." %}

## Putting it all together

Here is one command with every idea from this page in it:

```bash
docker run -d --name web --network myapp -p 8080:80 -v "$PWD/site:/usr/share/nginx/html" --restart unless-stopped nginx:1.27
```

| Part | Plain meaning |
| --- | --- |
| `docker run` | Bake a new container from a recipe and start it. |
| `-d` | Run in the background (detached), give me my terminal back. |
| `--name web` | Call it `web`, so I and other containers can refer to it by name. |
| `--network myapp` | Plug it into the `myapp` hallway. |
| `-p 8080:80` | Host doorbell 8080 rings the container's port 80. |
| `-v "$PWD/site:/usr/share/nginx/html"` | Lend it my `site` folder as its web root. |
| `--restart unless-stopped` | Start it again after a crash or a reboot, unless I stopped it. |
| `nginx:1.27` | The recipe: image `nginx`, version `1.27`. |

The same thing in Docker Compose, which is just this written down in a file so you don't have to remember it:

{% include file.html name="compose.yml" %}

```yaml
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    volumes:
      - ./site:/usr/share/nginx/html
    restart: unless-stopped
```

Run it with `docker compose up -d`. The [Docker and Docker Compose cheatsheet]({{ '/cheatsheets/docker/' | relative_url }}) has the rest.

## What the flags mean
{: .no-step}

Flags are the little switches you add to a command. Most of the confusing ones belong to `docker run`. A single letter with one dash (`-p`) is usually a short name for a longer word with two dashes (`--publish`), and both do the same thing.

### `docker run` flags

| Flag | Long name | Plain meaning | Example |
| --- | --- | --- | --- |
| `-d` | `--detach` | Run in the background and give me my terminal back. Without it, the container's output fills your terminal and `Ctrl+C` stops it. | `docker run -d nginx` |
| `-p` | `--publish` | Wire a host port to a container port. **Host on the left, container on the right.** | `-p 8080:80` |
| `-P` | `--publish-all` | Publish every port the image declares with `EXPOSE`, each on a random free host port. `docker ps` shows which. | `docker run -d -P nginx` |
| `-v` | `--volume` | Plug in a folder. A path on the left is a bind mount, a plain name is a named volume. Add `:ro` to make it read-only. | `-v "$PWD/site:/usr/share/nginx/html:ro"` |
| `--mount` | | The long, more explicit way to do `-v`. Unlike `-v`, it errors instead of creating a missing host folder. | `--mount type=bind,source="$PWD/site",target=/app` |
| `--name` | | Give the container a name instead of a random one like `happy_turing`. | `--name web` |
| `--rm` | | Delete the container automatically when it stops. Good for one-off jobs. Volumes and bind-mounted folders are kept. | `docker run --rm alpine echo hi` |
| `-i` | `--interactive` | Keep the keyboard connected, so you can type into the program. | |
| `-t` | `--tty` | Give it a proper terminal screen (colours, a prompt). | |
| `-it` | | `-i` and `-t` together: "let me use a shell inside". You almost always use them as a pair. | `docker run -it ubuntu bash` |
| `-e` | `--env` | Set an environment variable inside the container, often settings like passwords. | `-e POSTGRES_PASSWORD=secret` |
| `--env-file` | | Load many environment variables from a file, one `KEY=value` per line. | `--env-file .env` |
| `--network` | | Plug the container into a network (the hallway), so it can reach other containers there by name. | `--network myapp` |
| `--restart` | | What to do if it stops: `no` (default), `on-failure`, `always`, or `unless-stopped` (restart after crashes and reboots, unless you stopped it). | `--restart unless-stopped` |
| `-w` | `--workdir` | The folder inside the container where the command starts, like `cd` before running. | `-w /app` |
| `-u` | `--user` | Run as this user instead of `root`, so files it creates on a bind mount belong to you. | `-u "$(id -u):$(id -g)"` |
| `-h` | `--hostname` | Set the name the container calls itself. | `-h myhost` |
| `--add-host` | | Add a name to the container's address book. Mostly used on Linux to reach the host. | `--add-host=host.docker.internal:host-gateway` |
| `--entrypoint` | | Replace the program the image normally starts with. | `--entrypoint sh` |

Order matters in one way: **flags go before the image name**, and anything after the image name is the command to run inside it.

```text
docker run  -d -p 8080:80 --name web   nginx:1.27   nginx -g 'daemon off;'
            └──── flags for Docker ──┘ └─ image ─┘  └── command inside ───┘
```

### Flags on other commands

| Command and flag | Plain meaning |
| --- | --- |
| `docker ps -a` | Show **all** containers, including stopped ones. |
| `docker ps -q` | Show only container IDs (**quiet**), handy in scripts. |
| `docker logs -f web` | **Follow** the logs live, like `tail -f`. `Ctrl+C` stops watching, not the container. |
| `docker logs --tail 50 web` | Show only the last 50 lines. |
| `docker exec -it web sh` | Open an interactive shell in an already running container. Same `-it` as above. |
| `docker build -t myapp:1.0 .` | Build an image from the Dockerfile in `.` and **tag** (name) it `myapp:1.0`. |
| `docker build -f Dockerfile.dev .` | Use a Dockerfile with a different **file** name. |
| `docker rm -f web` | **Force**: stop and delete in one go. |
| `docker inspect -f '...' web` | **Format**: print only the piece you ask for instead of the whole JSON. |
| `docker system prune -a` | Also delete **all** images not used by any container, not just dangling ones. |
| `docker compose up -d` | Same `-d` as `docker run`: start everything in the background. |
| `docker compose down -v` | Also delete the project's named **volumes**. Careful, that's your data. |

## The few commands you'll actually use
{: .no-step}

| Command | What it does |
| --- | --- |
| `docker pull nginx` | Download an image (a recipe). |
| `docker images` | List the images you have. |
| `docker run -d -p 8080:80 --name web nginx` | Make and start a container from an image. |
| `docker ps` | List running containers. Add `-a` to include stopped ones. |
| `docker logs -f web` | Show a container's output and keep following it. |
| `docker exec -it web sh` | Open a shell inside a running container (walk into the apartment). |
| `docker stop web` / `docker start web` | Pause and resume a container. Its data stays. |
| `docker rm web` | Delete a stopped container (its inside scratch space goes with it). |
| `docker rmi nginx` | Delete an image you no longer need. |
| `docker volume ls` | List named volumes. |
| `docker network ls` | List networks. |
| `docker inspect web` | Everything about a container, including its IP, ports and mounts. |
| `docker system prune` | Clean up stopped containers, unused networks and dangling images. |

To see just a container's IP:

```bash
docker inspect -f '{% raw %}{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}{% endraw %}' web
```

## Quick memory hooks
{: .no-step}

- **Image = recipe, container = cake.** Many cakes from one recipe.
- **Left side is the host, right side is the container**, for both `-p` and `-v`.
- **Containers forget** unless you give them a volume or a bind mount.
- **No `-p`, no visitors from outside.** Neighbours on the same network can still knock.
- **Talk by name, not by IP**, on your own network or in Compose.
- **`localhost` in a container is the container itself.**

## Troubleshooting
{: .no-step}

- `port is already allocated`: something else is using that host port. Change the left number, for example `-p 8081:80`.
- Page won't load at `localhost:8080`: check `docker ps` shows `0.0.0.0:8080->80/tcp` in the PORTS column. If it's empty, you forgot `-p`.
- Container exits right away: run `docker logs <name>` to see why its main program stopped.
- My data disappeared: it was written inside the container, which was then removed. Put that path on a volume (`-v name:/path`).
- One container can't reach another by name: make sure both are on the same user-made network (`docker network create`, or the same Compose file).
- `permission denied` on `/var/run/docker.sock` on Linux: prefix commands with `sudo`, or add yourself to the `docker` group with `sudo usermod -aG docker $USER` and log out and back in.
