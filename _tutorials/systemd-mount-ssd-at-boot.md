---
title: "Writing systemd units: mount an SSD at boot"
description: Learn how systemd unit files work by writing one that mounts an SSD at every boot, then add an automount and a service that waits for the drive.
tags: [systemd, linux, raspberry-pi, storage]
tested_on: "Written for systemd 252 or newer: Debian 12, Raspberry Pi OS Bookworm, Ubuntu 22.04 and 24.04"
time: "30 minutes"
updated: 2026-10-11
---

systemd is the program that starts everything else on most Linux systems. Every job it does, whether starting SSH, mounting a disk or running a backup at night, is described in a small text file called a **unit**. Once you can write one unit, you can write them all, because they share the same layout.

This tutorial teaches that layout with a real job: mounting an SSD at `/mnt/ssd` every time the machine boots. By the end you will have:

- a `.mount` unit that mounts the SSD at boot, and that you can start, stop and inspect like any service,
- optionally, an `.automount` unit that mounts it only when something first touches the folder,
- optionally, your own `.service` unit that refuses to start until the SSD is mounted.

You need:

- A Linux machine with systemd (Debian, Ubuntu, Raspberry Pi OS, Fedora and Arch all qualify) and a user that can run `sudo`.
- An SSD plugged in over USB, SATA or NVMe.
- A terminal on the machine, or an SSH session to it (see [SSH key configuration on pi]({{ '/tutorials/ssh-key-configuration-on-pi/' | relative_url }})).

All commands run **on the Linux machine**.

## How a unit file is built
{: .no-step}

A unit file is an INI-style text file. Its extension says what kind of unit it is, and each kind has its own section in the middle:

| Section | What goes in it |
|---|---|
| `[Unit]` | A description, and how this unit relates to others: what it needs (`Requires=`, `Wants=`) and what it must start after (`After=`). The same in every kind of unit. |
| `[Mount]`, `[Service]`, `[Automount]`, `[Timer]`, ... | The actual job. Its name matches the file extension: `[Mount]` in a `.mount` file, `[Service]` in a `.service` file. |
| `[Install]` | What happens when you run `systemctl enable`. `WantedBy=multi-user.target` means "start this during a normal boot". |

Unit files live in two places:

| Folder | Who puts files there |
|---|---|
| `/etc/systemd/system/` | **You.** Your own units, and overrides of other units. Files here win. |
| `/usr/lib/systemd/system/` (or `/lib/systemd/system/`) | Installed packages. Don't edit these; a package update overwrites them. |

Every unit is controlled with the same few commands, so everything you learn with the mount unit below works for services too:

| Command | What it does |
|---|---|
| `sudo systemctl daemon-reload` | Re-read unit files after you create or change one. |
| `sudo systemctl start NAME` / `stop NAME` | Run or stop it now. |
| `sudo systemctl enable NAME` / `disable NAME` | Run it (or not) at every boot. Add `--now` to also start or stop it immediately. |
| `systemctl status NAME` | Is it running, since when, and its last log lines. |
| `journalctl -u NAME -b` | All of its log lines since the last boot. |

## Find the SSD and its UUID

Plug the SSD in and list the disks with their file systems:

```bash
lsblk -f
```

You will see something like this:

```text
NAME        FSTYPE FSVER LABEL  UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
sda
└─sda1      ext4   1.0   ssd    3f1c2a9e-7b44-4d6a-9f0e-2c8b1d5e6a70
mmcblk0
├─mmcblk0p1 vfat   FAT32 bootfs 9E3B-1A2C                             436M    15% /boot/firmware
└─mmcblk0p2 ext4   1.0   rootfs 1b7c2f40-5d1e-4c3a-8a8b-0f2e9d7c4b11   21G    22% /
```

Pick out the SSD by its size and by not being mounted at `/`. USB and SATA drives show up as `sda`, `sdb` and so on; NVMe drives as `nvme0n1`. The line you want is the **partition** (`sda1`), not the whole disk (`sda`).

Copy its **UUID**. That is the file system's own ID, and unlike `/dev/sda1` it never changes when you plug drives into a different port or add a second disk.

If the partition has no `FSTYPE` and no `UUID`, or there is no partition under the disk at all, the SSD is empty. Do the next step. If it already has a file system with data on it, skip to step 3.

{% include callout.html type="tip" text="`sudo blkid /dev/sda1` prints the same UUID and file system type for one partition, which is handy when `lsblk` output is crowded." %}

## Format the SSD (new drives only)

Skip this step if the SSD already holds files you want to keep.

{% include callout.html type="warning" title="This erases the whole drive" text="Check the device name twice with `lsblk`. Formatting `/dev/mmcblk0` or your system disk by mistake wipes your operating system." %}

Create one partition that fills the drive, then an ext4 file system on it with the label `ssd` (replace `/dev/sda` with your disk):

```bash
sudo parted /dev/sda --script mklabel gpt mkpart primary ext4 0% 100%
sudo mkfs.ext4 -L ssd /dev/sda1
```

Run `lsblk -f` again and copy the new partition's UUID.

ext4 is the right choice for a drive that only this Linux machine uses. If you need to plug the SSD into Windows or macOS too, see the note on exFAT in step 5.

## Create the mount point

The mount point is the empty folder the SSD's contents will appear in:

```bash
sudo mkdir -p /mnt/ssd
```

You can use any path. This tutorial uses `/mnt/ssd` throughout, and the next step explains why a path without dashes keeps things simple.

## Work out the unit's file name

A mount unit's file name is not free to choose. systemd requires it to be the mount path with the leading `/` dropped, the other `/` turned into `-`, and `.mount` on the end. Ask systemd to do the conversion so you don't get it wrong:

```bash
systemd-escape -p --suffix=mount /mnt/ssd
```

```text
mnt-ssd.mount
```

So the unit for `/mnt/ssd` must be called `mnt-ssd.mount`. If the name and the path don't match, systemd refuses to load the unit.

{% include callout.html type="note" title="Dashes in the path" text="A dash in the path is escaped, so `/mnt/my-ssd` becomes `mnt-my\x2dssd.mount`. That works, but you have to type the backslash in every command. Picking `/mnt/ssd` or `/mnt/my_ssd` avoids it." %}

## Write the mount unit

Create the unit file:

```bash
sudo nano /etc/systemd/system/mnt-ssd.mount
```

Paste this, and replace the UUID with yours from step 1:

{% include file.html name="/etc/systemd/system/mnt-ssd.mount" %}

```ini
[Unit]
Description=External SSD at /mnt/ssd

[Mount]
What=/dev/disk/by-uuid/3f1c2a9e-7b44-4d6a-9f0e-2c8b1d5e6a70
Where=/mnt/ssd
Type=ext4
Options=defaults,noatime

[Install]
WantedBy=multi-user.target
```

Save with `Ctrl+O`, Enter, and exit with `Ctrl+X`. Line by line:

- **`Description=`** is the name shown in `systemctl status` and in boot messages.
- **`What=`** is the device to mount. `/dev/disk/by-uuid/...` is a link that always points at the partition with that UUID, wherever it is plugged in.
- **`Where=`** is the mount point. It must match the file name, as in the previous step.
- **`Type=`** is the file system, the `FSTYPE` column from `lsblk -f`.
- **`Options=`** are the same options you would give `mount -o`. `noatime` stops Linux writing a "last read" time on every file read, which saves needless writes to the SSD.
- **`WantedBy=multi-user.target`** means a normal boot *wants* this mount. "Wants" is a soft link: if the SSD is unplugged, the mount fails after a short wait (90 seconds by default) but the machine still boots.

You don't need an `After=` line here. systemd sees that `What=` is a block device and adds "wait for this device to appear" by itself.

{% include callout.html type="note" title="exFAT or NTFS drives" text="If the SSD must also work on Windows or macOS and is formatted as exFAT, use `Type=exfat` and `Options=defaults,noatime,uid=1000,gid=1000,umask=022`. exFAT has no Linux owners, so `uid` and `gid` decide who owns every file; `id -u` and `id -g` print your numbers. For NTFS, use `Type=ntfs3` on kernel 5.15 or newer, or install `ntfs-3g` and use `Type=ntfs-3g`. Skip step 8 for both." %}

## Check the unit for mistakes

systemd can check a unit file before you use it:

```bash
sudo systemd-analyze verify /etc/systemd/system/mnt-ssd.mount
```

No output means the file is fine. If it complains about `mnt-ssd.mount`, fix that line; warnings about *other* unit files on your system can be ignored here.

Then tell systemd the new file exists. You need this after every change to a unit file:

```bash
sudo systemctl daemon-reload
```

## Start the mount and check it worked

A mount unit is started like any service. Starting it mounts the SSD:

```bash
sudo systemctl start mnt-ssd.mount
```

Check its status:

```bash
systemctl status mnt-ssd.mount
```

```text
● mnt-ssd.mount - External SSD at /mnt/ssd
     Loaded: loaded (/etc/systemd/system/mnt-ssd.mount; disabled; preset: enabled)
     Active: active (mounted) since Sat 2026-10-11 09:12:03 CEST; 4s ago
      Where: /mnt/ssd
       What: /dev/sda1
```

`active (mounted)` is what you want. `disabled` only means it won't happen at boot yet; that comes in step 9. Confirm the SSD really is at `/mnt/ssd` and see its free space:

```bash
findmnt /mnt/ssd
df -h /mnt/ssd
```

`sudo systemctl stop mnt-ssd.mount` unmounts it again, exactly like `sudo umount /mnt/ssd`.

## Give your user access to the files

A fresh ext4 file system belongs to `root`, so your normal user can't write to it yet. With the SSD mounted, hand it to your user:

```bash
sudo chown "$USER": /mnt/ssd
touch /mnt/ssd/hello.txt && ls -l /mnt/ssd
```

The ownership is stored on the SSD itself, so you only do this once and it survives reboots.

{% include callout.html type="warning" title="Mounted first, then chown" text="Run `chown` while the SSD is mounted. Run it before mounting and you change the empty folder underneath, which the SSD then hides." %}

## Enable the mount at boot and test it

Enabling reads the `[Install]` section and hooks the unit into the boot:

```bash
sudo systemctl enable mnt-ssd.mount
```

```text
Created symlink /etc/systemd/system/multi-user.target.wants/mnt-ssd.mount → /etc/systemd/system/mnt-ssd.mount.
```

That symlink is all `enable` does: `multi-user.target` starts everything in its `.wants` folder. `systemctl is-enabled mnt-ssd.mount` now prints `enabled`.

The only real test is a reboot:

```bash
sudo reboot
```

When the machine is back, check that the SSD mounted on its own, and read its log lines from this boot:

```bash
systemctl status mnt-ssd.mount
journalctl -b -u mnt-ssd.mount
```

`systemctl list-units --type=mount` lists every mount systemd manages, including the ones it creates from `/etc/fstab`.

## Mount on first use instead (optional)

With the `.mount` unit alone, the boot waits for the SSD (and for up to 90 seconds if it is unplugged). An **automount** unit changes that: systemd watches `/mnt/ssd` and only mounts the SSD the first time something opens the folder. Boot never waits for the drive, and a drive that is unplugged at boot no longer delays it.

An automount unit always works together with a mount unit of the same name, so keep `mnt-ssd.mount` and add `mnt-ssd.automount` next to it:

```bash
sudo nano /etc/systemd/system/mnt-ssd.automount
```

{% include file.html name="/etc/systemd/system/mnt-ssd.automount" %}

```ini
[Unit]
Description=Mount the SSD at /mnt/ssd on first access

[Automount]
Where=/mnt/ssd
TimeoutIdleSec=10min

[Install]
WantedBy=multi-user.target
```

`TimeoutIdleSec=10min` unmounts the SSD again after ten minutes with no use, which is useful for a drive you unplug often. Delete that line to keep it mounted once it has been touched.

Now swap which unit runs at boot. Disable and stop the mount, then enable and start the automount:

```bash
sudo systemctl daemon-reload
sudo systemctl disable --now mnt-ssd.mount
sudo systemctl enable --now mnt-ssd.automount
```

Try it:

```bash
systemctl status mnt-ssd.mount     # inactive (dead): not mounted yet
ls /mnt/ssd                        # this access triggers the mount
systemctl status mnt-ssd.mount     # active (mounted)
```

To go back to mounting at boot, run the same commands the other way round: `disable --now mnt-ssd.automount`, then `enable --now mnt-ssd.mount`.

## Write a service that needs the SSD (optional)

Mounting the drive is usually only half the job: something then uses it, such as Docker volumes, a media server or a backup script. If that program starts before the SSD is mounted, it happily writes into the empty folder on your SD card or system disk instead. systemd can prevent that with one line.

As a small, real example, here is your own service that shares the SSD's files in a browser on port 8000, using Python's built-in web server:

```bash
sudo nano /etc/systemd/system/ssd-share.service
```

{% include file.html name="/etc/systemd/system/ssd-share.service" %}

```ini
[Unit]
Description=Share /mnt/ssd over HTTP on port 8000
RequiresMountsFor=/mnt/ssd

[Service]
User=pi
ExecStart=/usr/bin/python3 -m http.server 8000 --directory /mnt/ssd
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Replace `pi` with your user name. What is new compared with the mount unit:

- **`RequiresMountsFor=/mnt/ssd`** pulls in whatever unit mounts `/mnt/ssd` (your `.mount` or `.automount`), starts the service only after it, and doesn't start the service at all if the mount fails.
- **`[Service]`** is the job section for a program. `ExecStart=` is the command to run, with the full path to the program. `User=` runs it as your user instead of root.
- **`Restart=on-failure`** starts the program again if it crashes.

Load it, start it and enable it at boot in one go:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ssd-share.service
systemctl status ssd-share.service
```

Open `http://<the machine's IP>:8000` in a browser on another computer and you will see `hello.txt` from step 8. Follow its log live with `journalctl -u ssd-share -f` (`Ctrl+C` to stop).

{% include callout.html type="warning" title="Anyone on your network can read these files" text="This server has no password. Use it to try things out, then turn it off with `sudo systemctl disable --now ssd-share.service`." %}

### Make an existing service wait for the SSD

For a service that came with a package, such as `docker.service`, don't edit its file in `/usr/lib/systemd/system/`. Add an override, called a **drop-in**, instead:

```bash
sudo systemctl edit docker.service
```

This opens an editor on `/etc/systemd/system/docker.service.d/override.conf`. Add these lines in the space the comments point to, then save:

{% include file.html name="/etc/systemd/system/docker.service.d/override.conf" %}

```ini
[Unit]
RequiresMountsFor=/mnt/ssd
```

`systemctl edit` reloads systemd for you. `systemctl cat docker.service` shows the original file with your drop-in underneath, and a package update leaves your drop-in alone.

## fstab or a mount unit?
{: .no-step}

You may have seen SSDs mounted with a line in `/etc/fstab`. On a systemd system, that line is turned into a `.mount` unit at boot anyway (run `systemctl cat mnt-ssd.mount` on a machine that uses fstab and you will see a generated one). The fstab line equivalent to this tutorial is:

{% include file.html name="/etc/fstab" %}

```text
UUID=3f1c2a9e-7b44-4d6a-9f0e-2c8b1d5e6a70  /mnt/ssd  ext4  defaults,noatime,nofail  0  2
```

Both work. A unit file is easier to start, stop and enable on its own, gets its own status and logs, and is the same skill as writing a service. Use one or the other for a given mount point, never both.

{% include callout.html type="warning" text="If you do use fstab, keep `nofail`. Without it, an unplugged SSD stops the boot and drops the machine into emergency mode." %}

## Remove it again
{: .no-step}

Stop and disable whatever you enabled, delete the files, and reload:

```bash
sudo systemctl disable --now ssd-share.service mnt-ssd.automount mnt-ssd.mount
sudo rm /etc/systemd/system/ssd-share.service /etc/systemd/system/mnt-ssd.automount /etc/systemd/system/mnt-ssd.mount
sudo systemctl daemon-reload
```

`disable` may say a unit wasn't enabled; that is fine. The files on the SSD are not touched.

## Troubleshooting
{: .no-step}

Start with the unit's status and its full log from this boot; the reason is almost always in there:

```bash
systemctl status mnt-ssd.mount
journalctl -b -u mnt-ssd.mount
```

- **`Where= setting doesn't match unit name. Refusing.`** The file name and the `Where=` path don't match. Run `systemd-escape -p --suffix=mount /your/path` and rename the file to what it prints (step 4).
- **`Job ... dev-disk-by\x2duuid-....device/start timed out` or `Dependency failed`.** systemd never saw the device. Either the SSD isn't connected or the UUID in `What=` is wrong. Compare it with `ls -l /dev/disk/by-uuid/`. On a Raspberry Pi, also check `dmesg | tail -20`: some USB SSDs need more power than the Pi's port gives and disconnect, so try a powered hub or the Pi's official power supply.
- **`wrong fs type, bad option, bad superblock`.** `Type=` doesn't match the file system. Check the `FSTYPE` column in `lsblk -f`. A typo in `Options=` causes the same message.
- **Your change doesn't take effect, or `Warning: The unit file ... changed on disk`.** Run `sudo systemctl daemon-reload` after every edit.
- **`Permission denied` when you write to `/mnt/ssd`.** The file system belongs to root. Do step 8 while the SSD is mounted.
- **`target is busy` when stopping the mount.** A program or a terminal is still using the folder. `cd ~` out of it, and find the program with `sudo fuser -vm /mnt/ssd`.
- **The service fails with `status=203/EXEC`.** systemd couldn't run the program in `ExecStart=`. Use the full path; `which python3` prints it.
- **The machine boots into emergency mode.** That is almost always an fstab line without `nofail`, not a unit file. Log in at the console, remove or fix the line in `/etc/fstab`, and reboot.
