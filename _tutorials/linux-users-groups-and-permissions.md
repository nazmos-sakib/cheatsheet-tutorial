---
title: "Linux users, groups and permissions, explained simply"
description: Who is allowed to do what on a Linux machine, and why. Users, groups, root and sudo, file permissions and octal numbers, how programs and containers get their rights, and how to fix "permission denied".
tags: [linux, permissions, security, docker, basics, concepts]
related: [docker-basics-explained-simply, syncthing-sync-with-openmediavault, nextcloud-on-openmediavault, systemd-mount-ssd-at-boot]
tested_on: "Written for Debian 12 and 13, Raspberry Pi OS and OpenMediaVault 8, with Docker Engine 27 or newer"
time: "45 minutes to read, longer if you try every command"
updated: 2026-10-27
---

Sooner or later every Linux project stops with the same two words: **permission denied**. Syncthing can't write to a folder, Nextcloud complains its data is "readable by other users", a script won't run, or a container keeps restarting. All of these come from one small set of rules about **who** a program is and **what** that someone is allowed to touch.

This page explains those rules from the beginning, using the Raspberry Pi NAS as the example: OpenMediaVault, an SSD mounted under `/srv`, and Docker containers like Syncthing and Nextcloud. You'll learn:

- what users, groups and root are, and what `sudo` really does,
- how to read `-rwxr-xr--` and numbers like `755` and `2775`,
- why a program can only do what the user it runs as can do,
- how containers fit in: `PUID`, `PGID`, bind-mount ownership and capabilities,
- a step-by-step way to fix any "permission denied".

You don't need to type anything to follow along, but every command here is safe to try in an SSH session on the Pi. Commands that change something are marked.

## The big idea: everything is done by someone
{: .no-step}

Think of the Linux machine as an **office building**. Every person in the building wears a **badge**, and every room, cupboard and drawer has a **lock** that says which badges may open it.

- A **user** is a badge. Not only people have one: every program that runs is wearing someone's badge.
- A **group** is a team. A lock can say "anyone on the IT team may open this", so you don't have to list every person.
- **Root** is the building manager with the master key. Root can open every door.
- A **file permission** is the lock on a file or folder.

The rule that explains almost everything else: **a program can only do what the badge it is wearing allows**. When Syncthing can't write to `/srv/.../sync`, it isn't Syncthing's fault: the badge it wears doesn't open that folder.

```text
   ┌───────────────┐        "may I write here?"       ┌──────────────────────┐
   │   Syncthing   │ ────────────────────────────────►│ /srv/.../sync        │
   │ wearing badge │                                  │ lock: owner naz  rwx │
   │   uid 1001    │ ◄──────── kernel checks ─────────│       group users rwx│
   └───────────────┘        the badge vs the lock     │       others     r-x │
                                                      └──────────────────────┘
```

The one doing the checking is the **kernel**, the core of Linux. It checks every single file open, every write, every program start. There is no way around it except being root.

## Users: who you are
{: .no-step}

Log in to the Pi over SSH and ask who you are:

```bash
whoami
id
```

```text
pi
uid=1000(pi) gid=1000(pi) groups=1000(pi),27(sudo),100(users),994(docker)
```

That line is your whole badge:

- **`uid=1000(pi)`**: your **user ID** is 1000 and its name is `pi`.
- **`gid=1000(pi)`**: your **main group**. On Debian every user gets their own group with the same name.
- **`groups=...`**: every team you belong to. Here `sudo` (may become root), `users` and `docker`.

**Linux only cares about the numbers.** The names are just labels for people. Files on the disk store the number `1000`, not the word `pi`. This sounds like a detail, but it is the key to understanding containers later on.

The list of users lives in a plain text file, `/etc/passwd`:

```bash
grep -E '^(root|pi|naz|www-data):' /etc/passwd
```

```text
root:x:0:0:root:/root:/bin/bash
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
pi:x:1000:1000:,,,:/home/pi:/bin/bash
naz:x:1001:100::/home/naz:/usr/sbin/nologin
```

Each line is `name:x:uid:gid:comment:home:shell`. The `x` means the password is kept elsewhere, in `/etc/shadow`, which only root can read.

There are three kinds of users on every Linux machine:

| Kind | uid | Examples | Used for |
|---|---|---|---|
| **root** | 0 | `root` | The master key. Can do anything. |
| **System or service users** | 1 to 999 | `www-data`, `_apt`, `systemd-timesync` | Badges for programs, not people. Usually no password and a `nologin` shell, so nobody can log in as them. |
| **Normal users** | 1000 and up | `pi`, `naz` | People. The first one you create gets 1000. |

On the NAS you probably have two people-users: `pi` (uid 1000), the one you SSH in with, and the share user you made in OpenMediaVault, `naz` (uid 1001), which owns the files in your shared folders. OMV gives its users the `nologin` shell, so `naz` can open SMB shares but can't SSH in. That's on purpose.

{% include callout.html type="tip" title="Look anyone up" text="`id naz` shows any user's numbers and groups. `getent passwd 1001` goes the other way, from a number to a name." %}

## Groups: teams that share access
{: .no-step}

A group lets several users share a lock without each being named on it. Look at the groups on the Pi:

```bash
grep -E '^(sudo|users|docker):' /etc/group
```

```text
sudo:x:27:pi
users:x:100:pi,naz
docker:x:994:pi
```

Each line is `name:x:gid:members`. On OpenMediaVault the important one is **`users`, gid 100**: every user you create in OMV joins it, and shared folders are usually owned by the group `users` so all of them can work there. That's why the Syncthing compose file says `PGID=100`.

A few groups give special powers, and it's worth knowing which ones you've joined:

| Group | What membership gives you |
|---|---|
| `sudo` | Running commands as root with `sudo` (Debian, Raspberry Pi OS, Ubuntu). On Fedora and Arch it's called `wheel`. |
| `docker` | Talking to Docker without `sudo`. This is the same as root, see the warning below. |
| `adm` | Reading system logs in `/var/log`. |
| `video`, `gpio`, `i2c`, `dialout` | On a Raspberry Pi: the camera, GPIO pins and serial ports (like a USB-connected ESP32). |

Add a user to a group (this changes something):

```bash
sudo usermod -aG dialout pi
```

The `-a` means **append**. Forget it and `-G` replaces all of `pi`'s groups with just `dialout`, which can lock `pi` out of `sudo`.

{% include callout.html type="warning" title="Log out and back in" text="Group changes only reach **new** logins. Your current SSH session keeps its old badge until you log out and in again, so `id` will still look the same. This catches everyone at least once." %}

## Root and sudo: the master key
{: .no-step}

**Root** (uid 0) skips the permission checks. It can read any file, change any owner, kill any program and format any disk. That's exactly why you don't log in as root all day: one typo in a command and nothing stops it.

**`sudo`** is the polite way to borrow the master key for one command. It asks for **your** password (not root's), checks you're allowed, runs that one command as root and writes it in the log.

```bash
cat /etc/shadow           # permission denied
sudo cat /etc/shadow      # works: this one command ran as root
sudo -l                   # what am I allowed to do with sudo?
```

Who may use sudo is set in `/etc/sudoers` and in files under `/etc/sudoers.d/`. On Debian the rule is "members of the group `sudo` may run anything". Only ever edit these with `sudo visudo`, which checks the file before saving: a broken sudoers file locks everyone out of sudo.

Useful variations:

| Command | What it does |
|---|---|
| `sudo command` | Run one command as root. |
| `sudo -i` | Open a root shell. Type `exit` to go back. Your prompt ends in `#` instead of `$` while you're root. |
| `sudo -u www-data command` | Run a command as **another** user. Brilliant for testing, see the troubleshooting section. |
| `sudo !!` | Run the previous command again, this time with sudo. |

### The redirection trap

This one confuses everyone:

```bash
sudo echo "hello" > /etc/motd
```

```text
bash: /etc/motd: Permission denied
```

`sudo` ran `echo` as root, but the `>` is handled by **your own shell** before sudo even starts, and your shell is still `pi`. The fix is to let a root program do the writing:

```bash
echo "hello" | sudo tee /etc/motd          # replace the file
echo "hello" | sudo tee -a /etc/motd       # add to the end
```

## File permissions: reading `-rwxr-xr-x`
{: .no-step}

Every file and folder carries three things: an **owner** (a user), a **group**, and a set of **permission bits**. `ls -l` shows all three:

```bash
ls -l /srv/dev-disk-by-uuid-*/
```

```text
drwxrwsr-x  5 naz  users  4096 Oct 20 18:02 sync
drwx------  4 naz  users  4096 Oct 20 18:01 syncthing
drwxrwx---  3 www-data www-data 4096 Oct 22 09:15 nextcloud-data
drwx------  6 999  999   4096 Oct 22 09:14 nextcloud-db
-rw-r--r--  1 pi   pi      220 Oct 25 11:40 notes.txt
```

Take the first ten characters apart:

```text
    d   rwx   rws   r-x
    │    │     │     │
    │    │     │     └── others: everyone else
    │    │     └──────── group:  members of the file's group (users)
    │    └────────────── owner:  the file's owner (naz)
    └─────────────────── type:   d = directory, - = file, l = link
```

Each set of three is **r** (read), **w** (write) and **x** (execute), or a `-` when that one is missing. The kernel picks **exactly one** set for you, the first one that fits:

1. Are you the **owner**? Use the owner set. Stop.
2. Otherwise, are you in the file's **group**? Use the group set. Stop.
3. Otherwise, use the **others** set.

It doesn't add them up. If a file is `----r--r--` and you're the owner, you can't read it, even though "everyone else" can. Rare, but it shows how the check works.

### Files and folders mean different things

The same three letters mean different things on a folder, and this is where most surprises hide:

| Letter | On a file | On a folder |
|---|---|---|
| **r** | Read what's inside. | See the **list of names** in it (`ls`). |
| **w** | Change what's inside. | **Create, rename and delete** entries in it. |
| **x** | Run it as a program. | **Go into it** and reach anything inside (`cd`, open files by name). |

Three consequences worth remembering:

- **Deleting a file needs `w` on the folder, not on the file.** You can delete a read-only file from your own folder, and you can't delete your own file from someone else's read-only folder.
- **Every folder on the path needs `x`.** To open `/srv/disk/sync/Documents/cv.pdf`, you need `x` on `/srv`, `/srv/disk`, `sync` and `Documents`, then `r` on `cv.pdf`. One missing `x` anywhere up the path and you get "permission denied" with perfectly good permissions on the file itself.
- **Folders almost always want `r` and `x` together.** `r` without `x` lets you see names but not open anything; `x` without `r` lets you open files only if you already know their names.

## Permission numbers: 755, 644 and friends
{: .no-step}

Instead of letters you'll often see numbers like `chmod 755`. Each letter has a value, and you add them up per set:

```text
   r = 4     w = 2     x = 1     - = 0

   rwx = 4+2+1 = 7
   r-x = 4+0+1 = 5
   r-- = 4+0+0 = 4
   rw- = 4+2+0 = 6
```

So a three-digit number is just owner, group and others, one digit each:

```text
   7   5   5
   │   │   └─ others: r-x
   │   └───── group:  r-x
   └───────── owner:  rwx       →   rwxr-xr-x
```

These few cover nearly everything you'll meet:

| Number | Letters | Typical use |
|---|---|---|
| `644` | `rw-r--r--` | Normal files: you edit, everyone reads. |
| `600` | `rw-------` | Secrets: SSH keys, `.env` files with passwords. |
| `755` | `rwxr-xr-x` | Programs, scripts, and normal folders. |
| `700` | `rwx------` | Private folders like `~/.ssh`. |
| `664` / `775` | `rw-rw-r--` / `rwxrwxr-x` | Files and folders a whole group works on. |
| `770` | `rwxrwx---` | Group folder that outsiders can't even look into. Nextcloud's data folder. |
| `777` | `rwxrwxrwx` | Everyone can do everything. Almost never what you want. |

Changing permissions and owners (these change something):

```bash
chmod 600 .env                        # with a number
chmod u+x backup.sh                   # with letters: give the owner (u) execute
chmod g+w,o-rwx shared.txt            # group may write, others get nothing
sudo chown naz:users report.pdf       # new owner and group
sudo chown -R 33:33 nextcloud-data    # -R: the folder and everything in it
```

The letters version uses `u` (user, the owner), `g` (group), `o` (others) and `a` (all three), with `+` to add, `-` to remove and `=` to set exactly.

Two rules about who may change these: **only the owner (or root) can `chmod`** a file, and **only root can `chown`** it to someone else. That's why most `chown` commands start with `sudo`.

To see a file's number directly:

```bash
stat -c '%a %U:%G %n' /srv/dev-disk-by-uuid-*/*
```

```text
2775 naz:users /srv/dev-disk-by-uuid-1f3c.../sync
700 naz:users /srv/dev-disk-by-uuid-1f3c.../syncthing
770 www-data:www-data /srv/dev-disk-by-uuid-1f3c.../nextcloud-data
```

{% include callout.html type="warning" title="Don't reach for chmod 777" text="When something says permission denied, `chmod -R 777` makes the error go away, and also lets every user and every program on the machine change or delete those files. Worse, some programs refuse to start when their files are too open: Nextcloud and SSH both do. Find out **who** needs access (the troubleshooting section shows how) and give exactly that user or group what it needs." %}

## umask: the default permissions for new files
{: .no-step}

When a program creates a file, who decides it gets `644`? The **umask**, a setting every program inherits that says which bits to **take away** from new files and folders.

```bash
umask
```

```text
0022
```

The kernel starts new files at `666` (nobody gets `x` by default, for safety) and new folders at `777`, then removes the umask:

```text
   umask 022      new file:   666 − 022 = 644   rw-r--r--
                  new folder: 777 − 022 = 755   rwxr-xr-x

   umask 002      new file:   666 − 002 = 664   rw-rw-r--
                  new folder: 777 − 002 = 775   rwxrwxr-x
```

`022` means "group and others may not write". `002` means "only others may not write", which is what you want in a shared group folder so your teammates can edit your files. Many Docker images, including Syncthing's, let you set this with an environment variable called `UMASK`, and Samba has its own "create mask" settings for files saved over SMB.

## Special bits: setgid, sticky and setuid
{: .no-step}

There's a fourth digit that sits **in front** of the other three. You've already met one, the `2` in `2775`:

| Bit | Number | Shows as | On a folder | On a program |
|---|---|---|---|---|
| **setgid** | `2000` | `s` in the group's `x` spot: `rwxrwsr-x` | New files inside get the **folder's group**, not the creator's main group. | Runs with the file's group. Rare. |
| **sticky** | `1000` | `t` in others' `x` spot: `rwxrwxrwt` | Anyone may create files, but you can only delete **your own**. | Nothing useful today. |
| **setuid** | `4000` | `s` in the owner's `x` spot: `rwsr-xr-x` | Ignored on Linux. | Runs as the **file's owner**, not as you. |

**setgid on shared folders** is the one you'll use. Without it, when `pi` creates a file in the shared `sync` folder, the file gets `pi`'s main group, `pi`, and the other users in `users` can't edit it. With `chmod 2775`, everything created inside belongs to `users` automatically. That's why the Syncthing tutorial uses `2775`.

**The sticky bit** is on `/tmp`, the folder every user may write to:

```bash
ls -ld /tmp
```

```text
drwxrwxrwt 12 root root 4096 Oct 27 10:00 /tmp
```

Without it, anyone could delete everyone else's temporary files.

**setuid** is how normal users can do a few root-only things. Your password is stored in `/etc/shadow`, which only root may write, yet you can change it with `passwd`. That works because `passwd` is owned by root and has the setuid bit, so it runs as root no matter who starts it:

```bash
ls -l /usr/bin/passwd /usr/bin/sudo
```

```text
-rwsr-xr-x 1 root root ... /usr/bin/passwd
-rwsr-xr-x 1 root root ... /usr/bin/sudo
```

`sudo` itself is a setuid program. setuid programs are carefully written to do only one job; a bug in one is a classic way for attackers to become root, so never add setuid to your own scripts (Linux ignores it on scripts anyway).

## Programs run as someone too
{: .no-step}

Every running program is a **process**, and every process wears a badge. See them:

```bash
ps -eo user,pid,comm | head -20
```

```text
USER         PID COMMAND
root           1 systemd
root         512 sshd
systemd+     498 systemd-timesyn
root         873 dockerd
pi          1402 bash
naz         2210 syncthing
www-data    2391 apache2
999         2388 mariadbd
```

A process gets its badge in one of three ways:

1. **It inherits it from whoever started it.** When you type `nano notes.txt`, nano runs as you. Every program you start from your shell is `pi`, so it can do what `pi` can do and nothing more.
2. **It's started by a service manager with a chosen user.** systemd (PID 1) runs as root and starts services, giving each one the badge its unit file asks for.
3. **It switches down by itself.** Many servers start as root to grab something only root can (like port 80), then drop to a weaker user for the real work. That's why you see one Apache process as root and the workers as `www-data`.

### Why services get their own users

This is a security idea called **least privilege**: give each program the smallest badge that does its job. If the web server is hacked, the attacker gets the `www-data` badge, which can read the website but can't read your SSH keys, your Syncthing files or `/etc/shadow`. If the web server ran as root, the attacker would own the whole machine.

So each service gets its own **service account**: a system user with no password and no login shell, that exists only so one program has a badge. You make one like this (this changes something):

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin backupbot
```

And a systemd service picks its badge with two lines in the `[Service]` section:

```ini
[Service]
User=backupbot
Group=users
ExecStart=/usr/local/bin/backup.sh
```

Leave them out and the service runs as **root**, which is fine for system jobs like mounting a disk (see the systemd tutorial) but more power than most scripts need.

{% include callout.html type="tip" title="Binding to low ports" text="Ports below 1024 (like 80 and 443) are reserved for root. That's why containers often listen on 8080 inside, and why Nextcloud on the NAS is published on 8080 rather than 80." %}

## Capabilities: root's powers in pieces
{: .no-step}

Root isn't one giant power. Since long ago, Linux has split root's abilities into about **40 separate capabilities**, each one a single power:

| Capability | What it allows |
|---|---|
| `CAP_CHOWN` | Change the owner of any file. |
| `CAP_DAC_OVERRIDE` | Ignore read/write/execute permissions. This is "root can open any file". |
| `CAP_NET_BIND_SERVICE` | Listen on ports below 1024. |
| `CAP_NET_ADMIN` | Change network settings: interfaces, routes, firewall. VPNs need it. |
| `CAP_NET_RAW` | Send raw network packets, as `ping` does. |
| `CAP_SYS_ADMIN` | A huge grab-bag, including mounting disks. Nearly as good as full root. |
| `CAP_SYS_TIME` | Change the system clock. |

Root normally holds all of them. The point of splitting them is that you can give a program **just one**. A web server can get `CAP_NET_BIND_SERVICE` to use port 80 without being able to read every file. You'll mostly meet capabilities in two places: in systemd units (`AmbientCapabilities=`) and, much more often, in Docker. That's next.

## Containers: badges inside boxes
{: .no-step}

Containers feel like separate computers, so it's natural to think they have their own users that have nothing to do with the Pi's. That's the most important misunderstanding to clear up:

**A container is just a group of normal processes on the Pi, with a blindfold on.** It shares the same kernel, and the kernel checks permissions using the same uid numbers as everywhere else. A container has its own `/etc/passwd` with its own **names**, but the **numbers** are the real ones.

```text
   inside the container                       on the Pi (the host)
   ────────────────────                       ────────────────────
   /etc/passwd says:                          /etc/passwd says:
     www-data = 33                              www-data = 33   (same by luck: both Debian)
     mysql    = 999                             uid 999 = some other system user, or nothing

   the kernel only sees:   uid 33,  uid 999,  uid 0
```

So when MariaDB inside the `nextcloud-db` container writes a file as its `mysql` user, the file on your SSD belongs to **uid 999**. On the Pi, `ls -l` shows whatever name the Pi happens to have for 999, or just the number. That's why `nextcloud-db` showed `999 999` in the `ls -l` earlier, and why `nextcloud-data` showed `www-data`: Nextcloud's `www-data` is 33, and the Pi's own `www-data` happens to be 33 as well, so the name matches by luck. In `ps` it's the same story: the `mariadbd` process shows up as plain `999`.

### Root in a container is root on the Pi

By default, **uid 0 inside a container is uid 0 on the host**. It's a root with the blindfold on, and a reduced set of powers (more on that in a moment), but for the files you hand it, it's the real root. You can see it for yourself:

```bash
mkdir ~/permtest
docker run --rm -v ~/permtest:/x alpine touch /x/made-by-container
ls -l ~/permtest
```

```text
-rw-r--r-- 1 root root 0 Oct 27 10:30 made-by-container
```

The `alpine` image runs as root, so the file it made on your disk belongs to root, and `pi` can't edit or delete it without `sudo`. This is exactly what happens when a container "messes up the permissions" on a bind-mounted folder. Clean up with `sudo rm -r ~/permtest`.

### Bind mounts keep the host's locks

Remember from the Docker basics page: a **bind mount** puts a real folder from the Pi inside the container (`-v /srv/.../sync:/data`). The folder isn't copied, so its owner, group and permission bits come along unchanged. The program inside the container must pass the **same** lock check it would on the Pi, using its uid number:

```text
   Syncthing container, running as uid 1001, gid 100
            │
            │  writes /data/Documents/cv.pdf
            ▼
   /data  ═══ bind mount ═══  /srv/dev-disk-by-uuid-.../sync   (owner naz=1001, group users=100, 2775)
                                       │
                                       └─► kernel: uid 1001 is the owner, owner has rwx → allowed
```

This is the reason for the most important rule with containers on a NAS: **decide which uid the container runs as, and make the folders you give it belong to that uid.**

### PUID and PGID: choosing the container's badge

There are two ways to pick the uid a container runs as.

**1. The `PUID` and `PGID` environment variables.** Many images for home servers support these: the official Syncthing image, and every image from LinuxServer.io. The container starts as root, creates or adjusts an internal user with those numbers, fixes ownership of its own config folder, then drops down to that user for the real work.

```yaml
services:
  syncthing:
    image: syncthing/syncthing
    environment:
      - PUID=1001   # naz, the OMV share user
      - PGID=100    # the users group
    volumes:
      - /srv/dev-disk-by-uuid-1f3c.../sync:/data
```

Syncthing now writes files as `naz:users`, so they look exactly like files you saved over SMB, and you can edit them from any computer. **These variables only work if the image supports them.** Check the image's documentation; on an image that doesn't, they're silently ignored.

**2. Docker's own `user:` setting.** This works with any image and tells Docker to start the main process as that uid right away:

```yaml
services:
  myapp:
    image: example/app
    user: "1001:100"
```

The catch is that the program never gets to run as root at the start, so if the image expects to set things up as root first, it may fail to start. Use `user:` for images that say they support it, and `PUID`/`PGID` for images that offer them.

**Images that pick their own user.** Some images insist on a specific user and don't let you change it. The official Nextcloud image runs as `www-data` (33); MariaDB runs as `mysql` (999). For those you don't choose the badge, you **match the folder to the badge**:

```bash
sudo chown -R 33:33 /srv/dev-disk-by-uuid-1f3c.../nextcloud-data
sudo chmod 770 /srv/dev-disk-by-uuid-1f3c.../nextcloud-data
```

To find out which uid a running container really uses:

```bash
docker exec nextcloud id
docker exec nextcloud-db id
docker top syncthing
```

```text
uid=0(root) gid=0(root) groups=0(root)
uid=999(mysql) gid=999(mysql) groups=999(mysql)
UID     PID     ...   CMD
naz     2210    ...   /bin/syncthing ...
```

`docker exec` starts a **new** process, by default as the image's starting user, which is why `nextcloud` shows root even though its web server workers run as `www-data`. `docker top` shows the real processes as the Pi sees them, and is the more honest answer. You can also run a single command as a chosen user, which is how the Nextcloud tutorial runs `occ`:

```bash
docker exec -u www-data nextcloud php occ status
```

{% include callout.html type="warning" title="The docker group is root" text="Anyone who can talk to Docker can start a container that bind-mounts the Pi's whole disk as root, for example with `-v /:/host`, and then change any file. So being in the `docker` group, or being able to run `sudo docker`, is the same as having root. Only add users you'd trust with the root password, and never give a container access to `/var/run/docker.sock` unless you trust it the same way." %}

### What else keeps containers in check

If a container's root is the real root, why isn't it all-powerful? Because Docker takes most of its powers away before starting it:

- **It drops most capabilities.** A container's root only gets about 14 of the 40, the harmless ones like `CAP_CHOWN` and `CAP_NET_BIND_SERVICE`. It can't mount disks, change the clock or reconfigure the Pi's network.
- **Namespaces (the blindfold).** It sees only its own processes, its own network and its own files, not the Pi's.
- **Seccomp and AppArmor.** Filters that block dangerous kernel calls and paths, even for root.

You can see a container's capabilities. The numbers are a bit mask; the difference is what matters:

```bash
docker run --rm alpine grep CapEff /proc/self/status
docker run --rm --cap-drop ALL alpine grep CapEff /proc/self/status
```

```text
CapEff: 00000000a80425fb
CapEff: 0000000000000000
```

Sometimes a container genuinely needs a power it doesn't have, and you hand it out one at a time in compose:

```yaml
services:
  vpn:
    image: example/wireguard
    cap_add:
      - NET_ADMIN          # change network settings, nothing more
    devices:
      - /dev/net/tun       # give it the one device it needs
```

And there's the sledgehammer, `privileged: true`, which gives the container **every** capability and every device on the Pi. Guides use it because it makes errors go away, the same way `chmod 777` does. Prefer `cap_add` with the one capability the image's documentation names.

### Small things that make containers safer

None of these are required, but they're cheap:

| Setting in compose | What it does |
|---|---|
| `- /path/on/pi:/inside:ro` | Mount a folder **read-only**. The container can show and share files but never change or delete them. The Nextcloud tutorial does this for the media folder. |
| `user: "1001:100"` or `PUID`/`PGID` | Don't run as root if the image doesn't need it. |
| `cap_drop: [ALL]` then `cap_add:` what's needed | Start with no powers and add back only what's needed. |
| `security_opt: [no-new-privileges:true]` | Stops anything inside from gaining rights through setuid programs. |
| `read_only: true` | Makes the container's own files read-only; only mounted folders can be written. Not every image copes with this. |

### Rootless Docker and user namespaces (good to know)

Two more advanced setups change the "root inside is root outside" rule:

- **User namespace remapping** (`userns-remap` in Docker's settings) shifts every uid inside containers to a high, unused range on the host. Root in a container becomes, say, uid 100000 on the Pi, which owns nothing.
- **Rootless Docker** runs the whole Docker engine as a normal user, so even its root is just that user.

Both are safer, but they change who owns every bind-mounted file and don't fit well with OpenMediaVault's compose plugin. For a home NAS, the `PUID`/`PGID` approach above is the usual choice. It's useful to know these exist when a guide mentions them.

## ACLs: when owner, group and others aren't enough
{: .no-step}

The normal permission bits only have room for **one** owner and **one** group. What if `naz` should have read/write, the `users` group read-only, and the Nextcloud container's `www-data` read-only as well? That's what **ACLs** (access control lists) are for: extra entries for specific users or groups, on top of the normal bits.

You can tell a file has an ACL by the `+` at the end of its permissions:

```bash
ls -ld /srv/dev-disk-by-uuid-*/sync
getfacl /srv/dev-disk-by-uuid-*/sync
```

```text
drwxrwsr-x+ 5 naz users 4096 Oct 20 18:02 /srv/dev-disk-by-uuid-1f3c.../sync

# file: sync
# owner: naz
# group: users
user::rwx
group::rwx
group:users:rwx
mask::rwx
other::r-x
default:user::rwx
default:group::rwx
default:group:users:rwx
default:mask::rwx
default:other::r-x
```

The `default:` lines are copied onto anything new created inside, so they work like a stronger setgid. Give one extra user read access (this changes something):

```bash
sudo setfacl -R -m u:www-data:rX /srv/dev-disk-by-uuid-1f3c.../media
sudo setfacl -R -d -m u:www-data:rX /srv/dev-disk-by-uuid-1f3c.../media
```

The capital `X` means "execute only on folders", so folders can be entered but files aren't made runnable. The second line (`-d`) sets the default for new files.

**On OpenMediaVault you rarely type these.** The **Access control list** button under **Storage → Shared Folders** writes exactly these ACLs for you, and the **Recursive** tick box is the `-R`. The separate key-icon **Permissions** button is different: it controls OMV's own share privileges (who may open the share over SMB), not the files' locks. When a container can't reach a shared folder, it's the ACL or the plain owner and bits that matter.

{% include callout.html type="note" title="ACLs need a Linux file system" text="ext4, XFS and Btrfs store owners, bits and ACLs. FAT32 and exFAT (common on USB sticks) store none of it: every file gets the same owner and permissions, chosen when the drive is mounted. NTFS is similar under Linux. If `chown` does nothing on a drive, this is usually why." %}

## Debugging "permission denied"
{: .no-step}

Every permission problem can be solved by answering three questions in order: **who** is trying, **what** is it trying to do, and **where** on the path is the lock that stops it.

### 1. Who is trying?

Not "who am I", but who is the process that failed:

- A command you typed: you. Check with `id`.
- A service: look at `User=` in its unit (`systemctl cat name.service`), or at the running process with `ps -eo user,pid,comm | grep name`.
- A container: `docker top name` for the real uid, and `docker exec name id`.

Write down the uid and every group number.

### 2. What is it trying to do, and where?

The error message usually names the path. In container logs:

```bash
docker logs syncthing 2>&1 | grep -i denied
```

```text
stat /data/Documents: permission denied
```

Inside the container that's `/data/Documents`. Translate it to the Pi's path through the bind mount: `/data` is `/srv/dev-disk-by-uuid-1f3c.../sync`, so the real folder is `/srv/dev-disk-by-uuid-1f3c.../sync/Documents`.

### 3. Walk the path with namei

`namei -l` shows the owner and bits of **every folder on the way**, which finds the missing `x` that `ls` hides:

```bash
namei -l /srv/dev-disk-by-uuid-1f3c.../sync/Documents
```

```text
f: /srv/dev-disk-by-uuid-1f3c.../sync/Documents
drwxr-xr-x root  root  /
drwxr-xr-x root  root  srv
drwxr-xr-x root  root  dev-disk-by-uuid-1f3c...
drwxrwsr-x naz   users sync
drwx------ root  root  Documents
```

There it is: `Documents` belongs to root with `700`, so nobody but root can go in. Someone made it with `sudo mkdir`. Hand it to the right user and group:

```bash
sudo chown -R 1001:100 /srv/dev-disk-by-uuid-1f3c.../sync/Documents
sudo chmod 2775 /srv/dev-disk-by-uuid-1f3c.../sync/Documents
```

### 4. Prove it as that user

Instead of guessing, test as the badge that failed. `sudo -u` works with numbers too, using `#`:

```bash
sudo -u naz ls /srv/dev-disk-by-uuid-1f3c.../sync/Documents
sudo -u '#33' touch /srv/dev-disk-by-uuid-1f3c.../nextcloud-data/test && echo writable
```

For a container, the most honest test is from inside it:

```bash
docker exec -u 1001 syncthing touch /data/Documents/test && echo writable
```

### Other causes when the bits look right

If owner, group and bits all look correct and it still fails, check these:

| Symptom | Likely cause | Fix |
|---|---|---|
| You were just added to a group but it still fails. | Your session still has the old badge. | Log out and back in, then check `id`. For a container, restart it. |
| `./script.sh: Permission denied` | The script has no `x` bit. | `chmod +x script.sh`, or run it with `bash script.sh`. |
| `x` is set and it still won't run. | The drive is mounted with `noexec`. | Check with `findmnt -T script.sh`; run it with `bash script.sh` or move it. |
| Can't write to a disk at all, even as root. | The file system is mounted read-only, often after an error. | `findmnt -T /path` shows `ro`. Check `dmesg` for disk errors. |
| `chown` silently does nothing. | FAT/exFAT/NTFS drive or a network share. | Use a Linux file system for anything a container writes to. |
| SSH ignores your key. | `~/.ssh` or `authorized_keys` is too open. | `chmod 700 ~/.ssh` and `chmod 600 ~/.ssh/authorized_keys`. |
| Nextcloud: "data directory is readable by other users". | The data folder is too open, not too closed. | `sudo chmod 770` on it. |
| Container restarts with `... .lock: permission denied` after you changed `PUID`. | Its config folder still belongs to the old uid. | `sudo chown -R` the config folder to the new uid, then restart. |
| Permissions are fine, but access to `/proc`, devices or some paths is blocked inside a container. | A capability, seccomp or AppArmor is blocking it. | Check the image's docs for the one `cap_add` or device it needs. |
| `permission denied ... /var/run/docker.sock` | You're not in the `docker` group. | `sudo docker ...`, or add yourself to the group (understanding that it's root). |

## Putting it all together
{: .no-step}

Here's the whole NAS in one picture, with the badge each part wears and the lock it has to pass:

```text
  YOU (pi, uid 1000, groups: sudo docker users)
    │  ssh in, type commands             → runs as pi
    │  sudo ...                          → that one command runs as root (uid 0)
    │
  systemd (root)
    ├─ sshd, mounts the SSD at /srv/...  → root
    ├─ dockerd                           → root ── starts containers:
    │     ├─ syncthing      PUID=1001 PGID=100  → writes as naz:users
    │     │     /data  ══►  /srv/.../sync         naz:users 2775  ✓ owner
    │     ├─ nextcloud      fixed user www-data → uid 33
    │     │     /var/www/html/data ══► /srv/.../nextcloud-data  33:33 770  ✓ owner
    │     │     /mnt/media:ro      ══► /srv/.../media           naz:users 755  ✓ others r-x
    │     └─ nextcloud-db   fixed user mysql    → uid 999
    │           /var/lib/mysql ══► /srv/.../nextcloud-db         999:999   ✓ owner
    │
  SMB share (Samba) → logs you in as naz   → reads and writes as naz:users
```

Each arrow is a badge meeting a lock. When one fails, find which arrow, then use the debugging steps to see why.

## Quick memory hooks
{: .no-step}

- **Every program wears a badge** (a uid), and can only do what that badge allows.
- **Linux checks numbers, not names.** Containers have their own names for the same numbers.
- **Owner, then group, then others**: the first one that matches wins.
- **r = 4, w = 2, x = 1.** Add them up per set: `755`, `644`, `600`.
- **On a folder, `x` means "may go in"**, and every folder on the path needs it.
- **Deleting needs `w` on the folder**, not on the file.
- **Root in a container is root on the host**, so make containers run as a normal uid where you can.
- **The `docker` group is root.**
- **Group changes need a fresh login.**
- **`777` and `privileged: true` hide problems.** Find the badge that needs access and give it exactly that.

## The commands in one place
{: .no-step}

| Command | What it does |
|---|---|
| `id`, `id naz` | Show a user's uid, main group and all groups. |
| `getent passwd 1001` | Find the user name for a uid (or the reverse). |
| `ls -l`, `ls -ld folder` | Show owner, group and bits of files, or of the folder itself. |
| `stat -c '%a %U:%G %n' *` | The same, with the permission number. |
| `namei -l /a/b/c` | Owner and bits of every folder along a path. |
| `chmod 644 file`, `chmod u+x file` | Change permission bits. |
| `sudo chown -R user:group folder` | Change owner and group, recursively. |
| `sudo usermod -aG group user` | Add a user to a group (then log in again). |
| `umask` | Show the bits taken away from new files. |
| `getfacl path`, `sudo setfacl -m u:name:rX path` | Show and set ACLs. |
| `sudo -u name command` | Run a command as another user, to test their access. |
| `sudo -l` | What may I do with sudo? |
| `ps -eo user,pid,comm` | Which user every process runs as. |
| `docker top name` | The real uids a container's processes use. |
| `docker exec -u uid name command` | Run a command inside a container as a chosen user. |
| `findmnt -T path` | How the drive holding a path is mounted (look for `ro`, `noexec`). |
