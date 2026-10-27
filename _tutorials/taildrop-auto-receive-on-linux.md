---
title: "Receive Taildrop files automatically on a Linux server"
description: Taildrop on a command-line Linux machine holds incoming files until you run tailscale file get. Turn that command into a systemd service so every file lands in ~/taildrop on its own, after every reboot.
tags: [tailscale, systemd, linux, raspberry-pi]
related: [tailscale-remote-access-openmediavault, systemd-mount-ssd-at-boot]
tested_on: "Written for Tailscale 1.50 or newer from Tailscale's own package repository, on systemd 252 or newer: Debian 12 and 13, Raspberry Pi OS Bookworm and Trixie, Ubuntu 22.04 and 24.04"
time: "15 minutes"
updated: 2026-10-21
---

**Taildrop** is Tailscale's way of sending a file straight to another of your devices: share a photo from your phone, pick a device, done. On a phone, Mac or Windows PC, the file simply appears in Downloads. On a Linux machine without a desktop, such as a Raspberry Pi or a NAS, nothing seems to happen. The file did arrive, but Tailscale is holding it in a waiting area, and it stays there until you collect it:

```bash
tailscale file get ~/taildrop
```

That gets tiring after the second file. Adding `--loop` keeps the command running and collects every file as it arrives:

```bash
tailscale file get --loop ~/taildrop
```

But it only runs as long as your terminal does. Close the SSH window, press <kbd>Ctrl</kbd>+<kbd>C</kbd> or reboot, and files start piling up in the waiting area again.

This tutorial makes the loop permanent. By the end you will have:

- your own user allowed to collect Taildrop files without `sudo`,
- a small systemd service that runs `tailscale file get --loop` in the background, starts at every boot and restarts itself if it ever stops,
- every file sent to the machine saved in `~/taildrop`, owned by you, with no command to type.

You need:

- A Linux machine with systemd that is already in your tailnet. If it isn't yet, [Reach your Raspberry Pi NAS from anywhere with Tailscale]({{ '/tutorials/tailscale-remote-access-openmediavault/' | relative_url }}) shows how to install Tailscale and sign in.
- Another device in the same tailnet to send files from (phone, laptop, anything with Tailscale).
- A terminal on the Linux machine, or an SSH session to it.

The examples use a user called `pi` on a machine called `nas`. Wherever you see `pi`, use your own user name (`whoami` prints it); wherever you see `nas`, use your machine's name from `tailscale status`.

## How Taildrop works on Linux
{: .no-step}

```text
 phone / laptop                       Linux machine "nas"
 ──────────────                       ───────────────────────────────────────────
 Share → Tailscale  ──── tailnet ───▶ tailscaled (runs as root)
                                        │  keeps the file in its waiting area
                                        │  /var/lib/tailscale/files/
                                        ▼
                                      tailscale file get ~/taildrop
                                        │  moves it out, owned by whoever ran it
                                        ▼
                                      /home/pi/taildrop/photo.jpg
```

Two programs are involved:

| Program | What it does |
|---|---|
| `tailscaled` | The Tailscale background service. It runs as root, receives the file over the tailnet and keeps it in its waiting area (often called the *inbox*). It never decides where the file should go. |
| `tailscale file get` | The command you type. It asks `tailscaled` for the waiting files, writes them into the folder you name, and removes them from the waiting area. |

Desktop apps on Windows and macOS run that second part for you. On a headless Linux machine there is no app, so something has to run `tailscale file get`. After this tutorial, that something is systemd.

The `tailscale file get` options this tutorial uses:

| Option | What it does |
|---|---|
| `--wait` | If nothing is waiting, wait for a file to arrive instead of exiting straight away. |
| `--loop` | Don't stop after one batch; keep collecting files as they arrive. |
| `--conflict=rename` | If `~/taildrop` already has a file with the same name, save the new one as `photo (1).jpg` instead of leaving it stuck in the waiting area. The other choices are `skip` (the default) and `overwrite`. |
| `--verbose` | Print a line for each file received, which ends up in the service's log. |

{% include callout.html type="note" title="Only your own devices" text="Taildrop only sends files between devices that belong to the same Tailscale user. A device you have given a tag in the admin console (for example `tag:server`) can't send or receive Taildrop files at all. If the Linux machine doesn't show up as a target when you share a file, check that first." %}

## Send a test file and collect it by hand

First make sure Taildrop itself works, before systemd gets involved.

On the Linux machine, create the folder the files will go to:

```bash
mkdir -p ~/taildrop
```

Now send any small file **from another device**:

- **Android / iPhone:** open a photo, tap **Share**, choose **Tailscale**, then tap `nas`.
- **Windows:** right-click a file in Explorer and choose **Send with Tailscale**, then pick `nas`.
- **macOS:** right-click a file in Finder, **Share** → **Tailscale**, then pick `nas`.
- **Another Linux machine:** `tailscale file cp ./notes.txt nas:` (the colon at the end matters; it marks `nas` as a device, not a file name).

The sender says the file was sent, but nothing appears on `nas` yet. It is in the waiting area. Collect it:

```bash
sudo tailscale file get ~/taildrop
ls -l ~/taildrop
```

The file is there, but look at the owner column: it says `root`, because `sudo` ran the command as root. You can read the file, but you can't edit it without `sudo` again. The next step fixes that.

{% include callout.html type="tip" title="Sending in the other direction" text="`tailscale file cp FILE DEVICE:` sends from the Linux machine to any of your other devices, for example `tailscale file cp ~/backup.tar.gz my-phone:`. `tailscale status` lists the device names." %}

## Let your user collect files without sudo

`tailscaled` only lets two kinds of users talk to it: root, and one user you name as the **operator**. Make yourself the operator:

```bash
sudo tailscale set --operator=$USER
```

`$USER` is filled in with your user name. The setting is saved by `tailscaled`, so it survives reboots. Check it took:

```bash
tailscale debug prefs | grep -i operator
```

```text
	"OperatorUser": "pi",
```

Send another test file, and this time collect it **without** `sudo`:

```bash
tailscale file get ~/taildrop
ls -l ~/taildrop
```

The new file belongs to `pi`. This matters for the service: it will run as your user, so everything it saves is yours.

{% include callout.html type="note" title="Already worked without sudo?" text="If `tailscale file get ~/taildrop` already worked for you without `sudo`, an operator was set earlier, often by `tailscale up --operator=$USER` during installation. Run the `grep` above to confirm it names you." %}

## Try the loop, and see its limit

Run the command you would like to have running all the time:

```bash
tailscale file get --wait --loop --conflict=rename --verbose ~/taildrop
```

The prompt doesn't come back. The command is waiting. Send two or three files from your phone one after another, and watch each one being saved as it arrives.

Now press <kbd>Ctrl</kbd>+<kbd>C</kbd>, or close the terminal. The loop stops, and files sent from now on wait in the inbox again until someone runs the command. The same happens when the SSH connection drops or the machine reboots.

Tricks like `nohup` or `screen` keep it alive after you close the terminal, but not after a reboot, and nothing restarts it if it crashes. A **systemd service** does all three: it starts at boot, runs without any terminal, and starts the command again if it ever exits.

{% include callout.html type="note" title="unknown flag: --conflict?" text="`--conflict` came in Tailscale 1.50. If your version is older (`tailscale version` prints it), update Tailscale with `sudo apt update && sudo apt upgrade`, or leave the option out." %}

## Write the service unit

A service is described by one small text file in `/etc/systemd/system/`. If unit files are new to you, [Writing systemd units: mount an SSD at boot]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}) explains the layout; this one is short.

First, find the full path of the `tailscale` command, because systemd needs it:

```bash
which tailscale
```

With Tailscale's own package it is `/usr/bin/tailscale`. Now create the unit file:

```bash
sudo nano /etc/systemd/system/taildrop.service
```

Paste this, replacing **all three** `pi`s with your user name (and the `/usr/bin/tailscale` path, if `which` printed something else):

{% include file.html name="/etc/systemd/system/taildrop.service" %}

```ini
[Unit]
Description=Taildrop: save incoming files to /home/pi/taildrop
Wants=tailscaled.service network-online.target
After=tailscaled.service network-online.target

[Service]
Type=simple
User=pi
ExecStartPre=/usr/bin/mkdir -p /home/pi/taildrop
ExecStart=/usr/bin/tailscale file get --wait --loop --conflict=rename --verbose /home/pi/taildrop
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Save with <kbd>Ctrl</kbd>+<kbd>O</kbd>, <kbd>Enter</kbd>, and leave with <kbd>Ctrl</kbd>+<kbd>X</kbd>.

What each line does:

| Line | Why it is there |
|---|---|
| `Wants=` / `After=tailscaled.service` | Start Tailscale first, and only start this service after it. Without `tailscaled` there is nothing to collect from. |
| `network-online.target` | Wait until the machine has a network connection at boot. |
| `Type=simple` | The command keeps running in the foreground; systemd treats it as running for as long as it doesn't exit. |
| `User=pi` | Run as you, not as root, so the saved files belong to you. This works because of the operator setting from step 2. |
| `ExecStartPre=` | Create the folder first, in case it was deleted or the machine is new. `-p` makes it do nothing if the folder exists. |
| `ExecStart=` | The same command you ran in step 3. Paths must be written out in full: systemd doesn't know what `~` means. |
| `Restart=always` | If the command ever exits, for example because `tailscaled` restarted during an update, start it again... |
| `RestartSec=10` | ...after 10 seconds, so it doesn't hammer `tailscaled` while it is still coming back up. |
| `WantedBy=multi-user.target` | Start it during a normal boot once you `enable` it. |

{% include callout.html type="warning" title="No ~ or $HOME in unit files" text="`/home/pi/taildrop` must be the real path. systemd runs `ExecStart=` without a shell, so `~/taildrop` or `$HOME/taildrop` would be taken literally and fail. If your home folder isn't under `/home`, `echo $HOME` prints the right one." %}

## Start the service and enable it at boot

Tell systemd a new unit file exists:

{% include cmd.html sheet="linux" id="systemctl-daemon-reload" %}

Then start it now **and** at every boot, in one command:

```bash
sudo systemctl enable --now taildrop.service
```

Check that it's running:

```bash
systemctl status taildrop.service
```

```text
● taildrop.service - Taildrop: save incoming files to /home/pi/taildrop
     Loaded: loaded (/etc/systemd/system/taildrop.service; enabled; preset: enabled)
     Active: active (running) since Tue 2026-10-21 10:12:03 CEST; 4s ago
    Process: 2210 ExecStartPre=/usr/bin/mkdir -p /home/pi/taildrop (code=exited, status=0/SUCCESS)
   Main PID: 2211 (tailscale)
     CGroup: /system.slice/taildrop.service
             └─2211 /usr/bin/tailscale file get --wait --loop --conflict=rename --verbose /home/pi/taildrop
```

The two words to look for are **`enabled`** (it will start at boot) and **`active (running)`** (it is running now). Press <kbd>Q</kbd> to get the prompt back.

## Test it, then reboot and test again

Leave the service's log open, so you can watch files come in:

```bash
journalctl -u taildrop.service -f
```

Send a file from your phone. Within a second or two a line appears in the log naming the file, and it is in `~/taildrop`:

```bash
ls -l ~/taildrop
```

Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop watching the log. That only stops `journalctl`; the service keeps running.

Now the real test. Reboot the machine:

```bash
sudo reboot
```

Wait a minute, and **don't log in**. Send a file from your phone. Then SSH in and look:

```bash
ls -l ~/taildrop
systemctl status taildrop.service
```

The file is already there, saved while nobody was logged in. From now on, sending a file to `nas` is all you have to do.

## Everyday use
{: .no-step}

| Task | Command |
|---|---|
| Is it running? | `systemctl status taildrop.service` |
| What did it receive lately? | `journalctl -u taildrop.service -n 50` |
| Watch files arrive live | `journalctl -u taildrop.service -f` |
| Pause receiving (files wait in the inbox meanwhile) | `sudo systemctl stop taildrop.service` |
| Resume, and collect everything that waited | `sudo systemctl start taildrop.service` |

**Saving somewhere else.** To save files straight to an SSD or a shared folder instead, change the folder in both `ExecStartPre=` and `ExecStart=`, then reload and restart:

```bash
sudo nano /etc/systemd/system/taildrop.service
sudo systemctl daemon-reload
sudo systemctl restart taildrop.service
```

The folder must be writable by your user. If it is on a drive that is mounted at boot, add `RequiresMountsFor=/mnt/ssd` (with your mount point) to the `[Unit]` section, so the service waits for the drive instead of writing into an empty folder underneath it. The [systemd tutorial]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}) explains why.

{% include callout.html type="tip" title="Shared with Samba or Syncthing?" text="Point the service at a folder that is already shared, for example the one Syncthing syncs to your laptop, and anything you Taildrop to the NAS from your phone turns up on all your other devices too." %}

## A user service instead
{: .no-step}

You may see this done as a **user service**: the same unit placed in `~/.config/systemd/user/`, managed with `systemctl --user`, without the `User=` line and with `%h/taildrop` as the folder (`%h` means your home folder in user services). It works too, but a user service normally only runs while you are logged in. To have it run from boot, you also need:

```bash
sudo loginctl enable-linger $USER
```

The system service in this tutorial avoids that extra step and is easier to find later, because it sits next to all the other services in `/etc/systemd/system/`. Use one approach or the other, never both: two loops would race each other for the same files.

## Remove it again
{: .no-step}

```bash
sudo systemctl disable --now taildrop.service
sudo rm /etc/systemd/system/taildrop.service
sudo systemctl daemon-reload
```

Your files in `~/taildrop` stay where they are. New files wait in the inbox again until you run `tailscale file get` by hand. To also drop the operator setting, run `sudo tailscale set --operator=` with nothing after the `=`.

## Troubleshooting
{: .no-step}

Start with the status and the log; the reason is almost always in there:

```bash
systemctl status taildrop.service
journalctl -u taildrop.service -b
```

- **`Access denied: ... requires operator` or `permission denied` in the log.** Your user isn't the operator, or the name in `User=` doesn't match it. Run step 2 again, and compare `tailscale debug prefs | grep -i operator` with the `User=` line.
- **`status=203/EXEC`.** systemd couldn't find the program in `ExecStart=`. Check the path with `which tailscale` and use exactly what it prints.
- **`status=217/USER`.** The user in `User=` doesn't exist. Check the spelling against `whoami`.
- **`flag provided but not defined: -conflict`.** Your Tailscale is older than 1.50. Update it, or remove `--conflict=rename` from the unit, then `daemon-reload` and `restart`.
- **The service keeps restarting, with `failed to connect to local tailscaled`.** Tailscale itself isn't running. Check `systemctl status tailscaled` and `tailscale status`; the service will collect the files on its own once Tailscale is back.
- **Files show up in the log but not in the folder you expect.** The path in `ExecStart=` is a different folder from the one you are looking in, often because of a leftover `pi` in a unit for a user with another name.
- **The sender says it worked, but nothing arrives, and the log is quiet.** Make sure you sent to the right machine (`tailscale status` on the sender lists the names), and that both devices belong to the same Tailscale user and neither is tagged.
- **You changed the unit file, but nothing changed.** Run `sudo systemctl daemon-reload` and `sudo systemctl restart taildrop.service` after every edit.
- **A file with the same name went missing.** It didn't: with `--conflict=rename` it was saved next to the old one as `name (1).ext`. Look with `ls -lt ~/taildrop | head`.
