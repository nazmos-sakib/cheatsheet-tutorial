---
title: "Build a NAS on a Raspberry Pi 4 (the TrueNAS way, with OpenMediaVault)"
description: Turn a Raspberry Pi 4 and a USB drive into a network file server with a web dashboard, user accounts and shared folders you can open from Windows, macOS and Linux.
tags: [raspberry-pi, linux, nas, storage, networking]
tested_on: "Written for Raspberry Pi OS Lite 64-bit (Trixie, Debian 13) and OpenMediaVault 8 on a Raspberry Pi 4 Model B"
time: "1 to 2 hours"
updated: 2026-10-27
---

A NAS (network-attached storage) is a small computer whose only job is to keep your files on its disks and share them with every other device on your network. Commercial NAS boxes and NAS operating systems such as TrueNAS all do the same few things: they manage disks, keep user accounts, and share folders over SMB (what Windows and macOS speak) and NFS (what Linux likes best), all from a web dashboard.

This tutorial builds exactly that on a Raspberry Pi 4. By the end you will have:

- a Pi that boots straight into a NAS, managed from a web page at `http://nas.local`,
- a USB drive formatted and mounted as the NAS's storage,
- your own user accounts with passwords,
- shared folders that open in Windows Explorer, macOS Finder and Linux file managers, and mount automatically if you want.

## Can a Raspberry Pi run TrueNAS?
{: .no-step}

Not properly, and it's worth knowing why before you start.

TrueNAS (both the current Community Edition and the older CORE/SCALE releases) is built only for **x86-64** processors, the kind in Intel and AMD PCs. The Raspberry Pi has an **ARM** processor, and there is no official TrueNAS image for it. Since 2025 there has been an unofficial community port of TrueNAS to 64-bit ARM, but it expects boards that boot with standard UEFI firmware. The Pi doesn't do that out of the box, the community UEFI firmware for the Pi only supports part of its hardware, and TrueNAS's ZFS file system wants more RAM than most Pis have. It is an interesting experiment, not something to trust your files to.

**OpenMediaVault (OMV)** is the NAS system people actually run on a Pi. It is free, built on Debian (which Raspberry Pi OS is too), officially supports ARM, and covers everything you'd use TrueNAS for at home: a web dashboard, disk and file system management, users and groups, SMB/NFS shares, disk health monitoring, scheduled jobs and a plugin system (including ZFS and Docker if you outgrow the basics). So this tutorial uses OMV, and the workflow will feel familiar if you later move to TrueNAS on a PC.

{% include callout.html type="tip" title="Already have a spare x86 PC?" text="If you have an old Intel or AMD computer with 8 GB of RAM or more, real TrueNAS Community Edition is a good choice there. On a Pi, OpenMediaVault is the right tool." %}

## What you need
{: .no-step}

| Part | Why, and what to look for |
|---|---|
| **Raspberry Pi 4 Model B** | 2 GB of RAM works; 4 GB or 8 GB leaves room for plugins and Docker later. |
| **Official USB-C power supply (5.1 V, 3 A)** | Most NAS problems on a Pi are power problems. Phone chargers often sag under load and cause disks to disconnect. |
| **microSD card, 16 GB or larger** | Holds the operating system only. A name-brand A1/A2 card lasts longer. Your files never go here. |
| **One or more USB drives** | An SSD or a hard disk in a USB 3 enclosure. Plug it into a **blue** USB 3 port. |
| **Powered USB hub or self-powered drives** | The Pi can power one 2.5" SSD or laptop hard disk. Two bus-powered hard disks, or any 3.5" disk, need their own power: a 3.5" enclosure with its own adapter, or a powered USB 3 hub. |
| **Ethernet cable** | Plug the Pi into your router. OMV is designed for a wired connection and its installer can break a Wi-Fi setup. |
| **Case with cooling** | A heatsink or small fan keeps the Pi from slowing itself down during long copies. |
| **A computer** | To flash the card and use the web dashboard: Windows, macOS or Linux. |

{% include callout.html type="warning" title="Back up the drive first" text="Preparing a drive for the NAS in step 6 erases it. Copy anything you want to keep off it before you start." %}

What to expect: the Pi 4 has gigabit Ethernet, so a single large file copies at up to roughly 100 MB/s with an SSD, a little less with a hard disk. That's plenty for backups, documents, photos and streaming video around the house.

## Flash Raspberry Pi OS Lite onto the microSD card

OMV installs on top of a plain Raspberry Pi OS, and it must be the **Lite** version: OMV refuses to install on a system with a desktop.

On your computer:

1. Download and install **Raspberry Pi Imager** from [raspberrypi.com/software](https://www.raspberrypi.com/software/) and put the microSD card in your computer.
2. Open Imager and choose:
   - **Device:** Raspberry Pi 4
   - **Operating system:** Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)**
   - **Storage:** your microSD card (check the size to make sure it's the card, not another drive)
3. When Imager offers to **customise the OS settings**, say yes and fill in:
   - **Hostname:** `nas`. This is how you'll reach it later, as `nas.local`.
   - **Username and password:** for example `naz` and a strong password. This is the Linux login, separate from the NAS web login.
   - **Locale:** your time zone and keyboard layout.
   - **Wireless LAN:** leave it **off** if you'll use Ethernet, which is recommended. If the Pi has to use Wi-Fi, fill it in now and read the Wi-Fi note in step 4 before installing OMV.
   - **SSH:** turn it **on**, with password authentication (you can switch to keys later, see [SSH key configuration on pi]({{ '/tutorials/ssh-key-configuration-on-pi/' | relative_url }})).
4. Write the image. Imager erases the card, writes it and verifies it. When it's done, take the card out.

## Boot the Pi and log in over SSH

1. Put the microSD card in the Pi.
2. Plug in the Ethernet cable. **Leave the USB drives unplugged for now**; that keeps the first boot simple.
3. Plug in the power supply. The first boot takes a minute or two while the Pi expands the file system.

On your computer, open a terminal (Terminal on macOS and Linux, PowerShell on Windows) and check the Pi is on the network:

```bash
ping nas.local
```

Replies mean it's up (`Ctrl+C` to stop). Log in with the user name you chose in Imager:

```bash
ssh naz@nas.local
```

Type `yes` the first time to trust the Pi's key, then your password. The prompt changes to `naz@nas:~ $`. Everything from here until step 5 runs **on the Pi**, in this SSH session.

{% include callout.html type="tip" title="nas.local not found?" text="Log in to your router's admin page and look for a device called `nas` in the list of connected devices (often under DHCP clients). Use its IP address instead, for example `ssh naz@192.168.1.50`." %}

Check that you got the 64-bit Lite system based on Debian 13 (Trixie):

```bash
cat /etc/os-release | grep VERSION_CODENAME
uname -m
```

```text
VERSION_CODENAME=trixie
aarch64
```

`aarch64` means 64-bit. If the code name says `bookworm`, your Imager offered an older image; see the troubleshooting section at the end.

## Update the Pi and give it a fixed address

Install all updates first, so OMV installs onto a current system:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

The SSH session closes. Wait a minute and log back in with `ssh naz@nas.local`.

**Give the Pi an address that never changes.** Your computers will remember the NAS by its address, so it shouldn't move around. The reliable way is a **DHCP reservation** in your router, not a setting on the Pi, because OMV takes over the Pi's network settings in the next step and would replace anything you set by hand.

Find the Pi's current IP address and its Ethernet MAC address:

```bash
ip -4 addr show eth0 | grep inet
cat /sys/class/net/eth0/address
```

```text
    inet 192.168.1.50/24 brd 192.168.1.255 scope global dynamic noprefixroute eth0
dc:a6:32:12:34:56
```

In your router's admin page, find the DHCP or LAN settings and add a reservation (sometimes called "static lease" or "address reservation") that ties this MAC address to this IP address. Every router names it a little differently; search for your router's model and "DHCP reservation" if you can't find it.

## Install OpenMediaVault

OMV is installed by a script maintained by the OMV plugin developers. It adds the OMV package sources, installs OMV and the **omv-extras** plugin collection, and moves the Pi's network setup over to OMV.

The installer reconfigures the network part-way through, which can drop your SSH connection. Run it inside `tmux` so it keeps going even if that happens:

```bash
sudo apt install -y tmux
tmux new -s omv
```

You're now inside a tmux session (there's a green bar at the bottom). Run the **pre-install** script, which prepares Raspberry Pi OS for OMV, then reboot:

```bash
wget -O - https://github.com/OpenMediaVault-Plugin-Developers/installScript/raw/master/preinstall | sudo bash
sudo reboot
```

Log back in after a minute, start tmux again, and run the **installer**:

```bash
ssh naz@nas.local
tmux new -s omv
wget -O - https://github.com/OpenMediaVault-Plugin-Developers/installScript/raw/master/install | sudo bash
```

This takes 10 to 30 minutes on a Pi 4 and prints a lot of output. Leave it alone. At the end it reboots the Pi by itself.

{% include callout.html type="warning" title="On Wi-Fi? Add -n" text="Without `-n`, the installer copies your Wi-Fi name and password into OMV, removes Raspberry Pi OS's own network manager and reboots. If copying the Wi-Fi details fails, the Pi drops off the network and you need a screen and keyboard or a cable to get it back. Plug in Ethernet before running it if you can. If the Pi can only use Wi-Fi, run the installer with `-n` so it leaves the network alone: `wget -O - https://github.com/OpenMediaVault-Plugin-Developers/installScript/raw/master/install | sudo bash -s -- -n`. You still get OMV-Extras and the Pi tweaks. The Pi doesn't reboot, Wi-Fi keeps working as before, and you just can't change network settings from the OMV dashboard." %}

{% include callout.html type="note" title="If the SSH session freezes" text="That's the network being reconfigured, and it's expected. Wait 15 to 30 minutes, then try `ssh naz@nas.local` again. If you get back in before the Pi has rebooted, `tmux attach -t omv` shows you the installer's progress." %}

{% include callout.html type="note" title="Piping a script into sudo bash" text="These commands download a script and run it as root without saving it first. That's the method OMV documents, and the script comes from the official OMV plugin developers' GitHub. If you'd rather read it first, download it with `wget`, open it in `nano`, then run it with `sudo bash ./install`." %}

When the Pi is back up, log in once more and check that OMV's engine is running:

```bash
systemctl status openmediavault-engined
```

`active (running)` means the install worked. Press `q` to leave the status view.

### If the installer stops with ERROR 503

The installer downloads OMV from `packages.openmediavault.org`. If that server is having an outage, the installer stops early with something like this:

```text
[omvinstall] Adding openmediavault repo and key...
http://packages.openmediavault.org/public/archive.key:
ERROR 503: Service Unavailable.
[omvinstall] failed to download openmediavault key from http://packages.openmediavault.org/public/archive.key
```

503 means the server is temporarily unavailable. Nothing is wrong with your Pi or your network, and nothing important has changed yet, so it's safe to try again. First see which of OMV's two package servers is answering:

```bash
curl -sI http://packages.openmediavault.org/public/archive.key | head -1
curl -sIL https://packages.openmediavault.io/archive.key | grep HTTP
```

- **The first line says `200`:** the main server is back. Run the installer command again.
- **Only the second one ends in `200`:** install OMV with OMV's own official script, which also downloads from the backup server, `packages.openmediavault.io`:

  ```bash
  wget -O - https://get.openmediavault.io | sudo sh
  ```

  It ends with a summary showing `Failed: 0` and the dashboard's address and default login. Unlike the installer above, this script doesn't reboot the Pi. Then **run the OMV-Extras installer from this step again** (with `-n` if you're on Wi-Fi). It sees that OMV is already installed, skips the download that failed, and adds OMV-Extras, the Pi tweaks and the network handover. If it stops later with another error from the `.org` server, wait until that server is back and run it once more. OMV itself is already installed at that point.

{% include callout.html type="note" title="A 302 is fine" text="If the `.io` check shows `HTTP/2 302` without `-L`, the server is answering and redirecting to where the file is stored. `wget` follows redirects automatically, so the official script works." %}

## Log in to the web dashboard and secure it

From now on almost everything happens in a web browser on your computer. Open:

```text
http://nas.local
```

(or `http://192.168.1.50`, your Pi's address). Log in with OMV's default web login:

- **Username:** `admin`
- **Password:** `openmediavault`

**Change that password straight away.** Click the **user icon** in the top-right corner → **Change password**, enter a new strong password and save. Anyone on your network could otherwise log in and erase your disks.

Then take a quick tour of the settings you'll want right away:

1. **System → Date & Time:** pick your time zone and turn on **Use NTP server**, so file times and logs are correct.
2. **System → Workbench:** change **Auto logout** if 5 minutes is too short for you.
3. **System → Update Management → Updates:** install any updates listed.
4. **Dashboard** (the first page): click the settings icon to switch on widgets such as CPU, memory, file systems and services.

{% include callout.html type="tip" title="The yellow banner" text="Most changes in OMV are saved first and applied later. When a yellow bar appears at the top saying there are pending configuration changes, click the **check mark** (Apply) on it. Until you do, the change isn't live. You'll see it after almost every step below." %}

## Prepare the disk

Plug your USB drive into a **blue USB 3 port** now (and power it on if it has its own power supply).

In the dashboard, go to **Storage → Disks**. You'll see the microSD card (`/dev/mmcblk0`) and your drive, usually `/dev/sda` (a second drive is `/dev/sdb`). Check the model and size so you know which is which.

If the drive is new, or you're happy to lose what's on it, **wipe** it so OMV starts from a clean slate:

1. Select the drive's row (`/dev/sda`). **Never** pick `/dev/mmcblk0`: that's the system.
2. Click the **Wipe** button (the eraser icon) in the toolbar.
3. Confirm, then choose **Quick**. A quick wipe takes a few seconds and removes the old partitions, which is all you need.

{% include callout.html type="warning" title="Wipe and Create can't be undone" text="**Wipe** here and **Create** in the next step erase the disk the moment you confirm them. The yellow banner that appears afterwards is only about settings: clicking **Revert** or discarding it does **not** bring the data back. Double-check the device before you click, and never use either on a disk that holds files you want to keep." %}

{% include callout.html type="note" title="Keeping the files that are already on the drive" text="If the drive already holds files on an ext4, NTFS or exFAT file system and you want to keep them, skip the wipe. In the next step, choose **Mount an existing file system** instead of creating one. NTFS and exFAT work, but Linux permissions don't apply to them, so for a drive that lives in the NAS permanently, ext4 is the better choice." %}

## Create and mount a file system

A file system is the structure that lets a disk store files. **ext4** is the standard Linux file system: fast, reliable, and a safe default for a Pi NAS.

1. Go to **Storage → File Systems**.
2. Click the **+** (Create and mount a file system) button and choose **EXT4**.
3. **Device:** pick your drive (`/dev/sda`). Click **Save**.
4. OMV formats the drive. A large hard disk can take a few minutes. When it says it's finished, click **Close**.
5. OMV now shows the mount settings for the new file system. Leave the defaults and click **Save**.
6. Click the check mark on the yellow banner to apply.

The file system now appears in the list with its size, how much is free, and **Mounted: yes**. OMV mounts it automatically at every boot, under `/srv/dev-disk-by-uuid-...`. You don't need to remember that path; OMV handles it.

If you have a second drive, repeat the wipe and file system steps for it.

{% include callout.html type="note" title="RAID, mirroring and ZFS on a Pi" text="OMV deliberately hides USB disks from its software RAID page, because USB connections can drop for a moment and a RAID array can break when they do. To protect against a dead disk, use your second drive as a **backup**: create an **rsync** job under **Services → Rsync** that copies the first drive to the second every night. If you want pooling or parity, the **mergerfs** and **snapraid** plugins (under **System → Plugins**) are designed for exactly this kind of setup. A **zfs** plugin also exists, but ZFS wants a lot of RAM and is a poor fit for a Pi 4." %}

## Create users

Each person who uses the NAS should get their own account. These are the names and passwords they'll type when their computer connects to a share.

1. Go to **Users → Users** and click **+** → **Create**.
2. Fill in:
   - **Name:** for example `naz`. Lowercase, no spaces.
   - **Email:** optional.
   - **Password** and **Confirm password**.
   - **Groups:** leave **users** selected. Add **_ssh** only if this person should also be allowed to log in over SSH.
3. Click **Save**, then apply the change on the yellow banner.

Repeat for each person. To give several people the same rights in one go, create a group under **Users → Groups** (for example `family`), add the users to it, and grant permissions to the group in the next steps.

{% include callout.html type="note" title="Two kinds of user" text="The user you created in Raspberry Pi Imager is the Pi's Linux admin account, used for SSH. The OMV `admin` account is for the web dashboard only. The users you create here are for the shares. Keep them apart: don't use the dashboard's admin account to open shares." %}

## Create a shared folder

A shared folder is a folder on your data drive that OMV knows about and can share. Create one per kind of content, for example `documents`, `photos` and `media`, so you can give each different permissions.

1. Go to **Storage → Shared Folders** and click **+** → **Create**.
2. Fill in:
   - **Name:** `media`
   - **File system:** your data drive (shown with its size and label).
   - **Relative path:** fills in as `media/` automatically. That's the folder created on the drive.
   - **Permissions:** **Administrator: read/write, Users: read/write, Others: read-only** is a good default for a home NAS. Choose **Others: no access** for private folders.
3. Click **Save** and apply.

Now decide exactly who may use it. Select the shared folder and click the **Permissions** button (key icon). Each user and group is listed with three choices: **Read/Write**, **Read-only** and **No access**. Tick what each should have, click **Save**, and apply.

For example, a `media` folder everyone can watch but only you can change: `naz` read/write, group `users` read-only. A `backups` folder only you can see: `naz` read/write, everyone else no access.

## Share the folder over SMB

**SMB** (also called Samba or CIFS) is the file sharing language of Windows and macOS, and Linux speaks it too. Turning it on makes your folders appear on every computer in the house.

First, switch on the SMB service:

1. Go to **Services → SMB/CIFS → Settings**.
2. Tick **Enabled**.
3. **Workgroup:** leave `WORKGROUP` unless your Windows network uses another name.
4. Click **Save** and apply.

Then share each folder:

1. Go to **Services → SMB/CIFS → Shares** and click **+** → **Create**.
2. Fill in:
   - **Shared folder:** `media`.
   - **Public:** **No**. Users then have to log in with their NAS user name and password, and the permissions from the last step apply.
   - **Browseable:** on, so the share shows up when you browse the NAS.
   - **Enable recycle bin:** optional, but useful. Files deleted over the network go to a hidden `.recycle` folder instead of disappearing.
   - **Time Machine support:** tick this only on a folder you'll use for Mac backups (see step 13).
3. Click **Save** and apply.

Repeat for each shared folder you want on the network.

## Share the folder over NFS (optional, for Linux)

Linux computers can use the SMB shares just fine. NFS is an alternative that's a bit faster and more natural between Linux machines, but it trusts the client computer about who the user is, so only use it on a home network you control. Skip this step if you don't have Linux machines.

1. Go to **Services → NFS → Settings**, tick **Enabled**, click **Save** and apply.
2. Go to **Services → NFS → Shares** and click **+** → **Create**.
3. Fill in:
   - **Shared folder:** `media`.
   - **Client:** your home network, for example `192.168.1.0/24` (all addresses from `192.168.1.0` to `192.168.1.255`).
   - **Privilege:** **Read/Write**.
   - **Extra options:** leave the defaults.
4. Click **Save** and apply.

NFS checks permissions by user **number** (UID), not by name. Linux files you create over NFS are owned by your UID on your Linux computer, which is usually `1000`. For full access, give the NAS user the same UID: on your Linux computer, `id -u` prints yours. If they differ, the simplest fix is to set the shared folder's **Others** permission to read/write for that folder.

## Connect from Windows

**Open the share once:** open File Explorer, click in the address bar, type the address below and press Enter:

```text
\\nas.local\media
```

When asked, enter the NAS user name and password you created in step 8 and tick **Remember my credentials**.

**Map it as a drive letter** so it's always in **This PC**:

1. In File Explorer, right-click **This PC** → **Map network drive** (on Windows 11 it's under **⋯ See more**).
2. **Drive:** pick a letter, for example `Z:`.
3. **Folder:** `\\nas.local\media`
4. Tick **Reconnect at sign-in**, and **Connect using different credentials**.
5. Click **Finish** and enter the NAS user name and password.

If `nas.local` doesn't work on your Windows machine, use the IP address instead: `\\192.168.1.50\media`. The NAS also shows up under **Network** in File Explorer's sidebar.

## Connect from macOS

1. In Finder, press `Cmd+K` (**Go → Connect to Server**).
2. Type the address and click **Connect**:

```text
smb://nas.local/media
```

3. Choose **Registered User**, enter the NAS user name and password, and tick **Remember this password in my keychain**.

The share opens in Finder and appears in the sidebar under **Locations**. To reconnect it automatically at login, open **System Settings → General → Login Items**, click **+** under **Open at Login**, and choose the mounted share.

**Time Machine backups to the NAS:** create a separate shared folder called `timemachine`, share it over SMB with **Time Machine support** ticked (step 10), then on the Mac open **System Settings → General → Time Machine → Add Backup Disk** and pick it. To stop backups from filling the whole drive, set a size limit on the SMB share under **Time Machine support** if your OMV version shows one, or give the backups their own drive.

## Connect from Linux

**From the desktop:** in the Files app (GNOME, and most others), click **Other Locations** and type `smb://nas.local/media` in **Connect to Server**. Enter the NAS user name and password.

**Mount it permanently over SMB.** On the Linux computer, install the SMB tools and create a mount point:

```bash
sudo apt install -y cifs-utils
sudo mkdir -p /mnt/nas
```

Store the NAS login in a file only root can read, rather than in `/etc/fstab`, which everyone can read:

```bash
sudo nano /root/.nas-credentials
```

{% include file.html name="/root/.nas-credentials" %}

```text
username=naz
password=your-nas-password
```

```bash
sudo chmod 600 /root/.nas-credentials
```

Add one line to `/etc/fstab` (`sudo nano /etc/fstab`). Replace `1000` with the output of `id -u` and `id -g`:

{% include file.html name="/etc/fstab" %}

```text
//nas.local/media  /mnt/nas  cifs  credentials=/root/.nas-credentials,uid=1000,gid=1000,_netdev,nofail,x-systemd.automount  0  0
```

`x-systemd.automount` mounts the share the first time something opens `/mnt/nas`, so booting never hangs waiting for the NAS, and `nofail` lets the computer boot even when the NAS is off. Test it:

```bash
sudo systemctl daemon-reload
ls /mnt/nas
```

**Or mount it over NFS** if you set that up in step 11:

```bash
sudo apt install -y nfs-common
sudo mkdir -p /mnt/nas
sudo mount -t nfs4 nas.local:/media /mnt/nas
```

OMV exports NFSv4 shares by their name directly (`nas.local:/media`). For the older NFSv3, the path is `nas.local:/export/media`. To make it permanent, add to `/etc/fstab`:

{% include file.html name="/etc/fstab" %}

```text
nas.local:/media  /mnt/nas  nfs4  _netdev,nofail,x-systemd.automount  0  0
```

These automount options are systemd mount units under the hood; [Writing systemd units: mount an SSD at boot]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}) explains how they work.

## Keep the NAS healthy

A NAS is only useful if you can trust it. A few minutes of setup here pays off later.

**Watch disk health.** Go to **Storage → S.M.A.R.T. → Settings**, tick **Enabled**, and save. Under **Devices**, select your drive, click **Edit**, turn on monitoring and save. Then under **Scheduled tests**, add a **Short self-test** every week. Some cheap USB enclosures don't pass S.M.A.R.T. data through; if the drive shows no data, that's why.

**Get an email when something goes wrong.** Under **System → Notification → Settings**, enter an SMTP server (your email provider's, or a Gmail address with an app password), save, apply, and click **Send a test email**. Under **System → Notification → Notifications**, choose what to be told about: S.M.A.R.T. warnings and full file systems are the important ones.

**Back up what matters.** A NAS isn't a backup by itself; if the drive dies, the files go with it. At minimum:

- Copy the important shared folders to a second drive every night with **Services → Rsync → Tasks** (source and destination are both shared folders).
- Keep a second copy somewhere else, too: another location, or a cloud service. The **rsnapshot** and **borgbackup** plugins can do versioned backups.

**Back up the microSD card.** If the card fails, your files are safe on the data drive but you'd have to set OMV up again. The **openmediavault-backup** plugin (**System → Plugins**, search for "backup") can image the system to your data drive on a schedule.

**Install updates.** Check **System → Update Management** every few weeks, or turn on automatic security updates there.

**Shut down cleanly.** Always turn the NAS off from the **power icon** in the top-right of the dashboard → **Shutdown**, never by pulling the plug. Pulling power while it's writing can damage the file system.

## Troubleshooting
{: .no-step}

- **The SSD doesn't mount anymore, or the shared folders show "not available".** See **The SSD doesn't mount after a power cut** below.
- **The drive keeps disconnecting, or the Pi reboots during big copies.** Almost always power. Use the official power supply, and give hard disks their own power through a powered USB hub or an enclosure with its own adapter. `dmesg | grep -i usb` on the Pi shows "reset" or "disconnect" messages when this happens.
- **The OMV installer stops with a message about a desktop environment.** You flashed the desktop version of Raspberry Pi OS. Flash **Raspberry Pi OS Lite (64-bit)** and start again.
- **`/etc/os-release` says `bookworm`.** That's Debian 12, and the current installer only supports Debian 13. Either flash a current Raspberry Pi OS Lite (64-bit) image, or install OMV 7 with the `installOld7` script from the same GitHub repository (replace `install` with `installOld7` in the command). OMV 7 looks and works almost the same.
- **The installer fails with `ERROR 503: Service Unavailable`.** OMV's package server is down for a while. See **If the installer stops with ERROR 503** in step 4.
- **I can't reach the Pi after the OMV install.** OMV moved the network setup over to itself and the Pi may have a new address. Look in your router's list of connected devices, or connect a screen and keyboard and run `ip -4 addr`. The DHCP reservation from step 3 prevents this in future.
- **I can't log in to the dashboard.** Log in to the Pi over SSH and reset the web admin password with `sudo omv-firstaid`, then choose **Change control panel administrator password**. `omv-firstaid` can also reset the network if that's what's broken.
- **Windows says the network path was not found.** Try the IP address instead of `nas.local`. Make sure SMB is **Enabled** under **Services → SMB/CIFS → Settings** and you applied the pending changes.
- **Windows says I don't have permission, or keeps asking for a password.** Check the shared folder's **Permissions** (step 9) for that user. If Windows has saved a different login for the NAS, remove it under **Control Panel → Credential Manager → Windows Credentials**, then connect again.
- **Copies are slow (under 30 MB/s).** Check the drive is in a **blue** USB 3 port, the Pi is on Ethernet rather than Wi-Fi, and your computer is wired too. Over Wi-Fi, the Wi-Fi is usually the limit, not the Pi.
- **I want Docker apps (Jellyfin, Nextcloud, Immich...) on the NAS.** Install the **compose** plugin from **System → Plugins**. It adds a **Services → Compose** page for running containers, with their data on your shared folders. A Pi 4 with 4 GB or more handles a few light apps well.

### The SSD doesn't mount after a power cut

**What you see:** apps such as Syncthing or Nextcloud stop working, the shared folders in **Storage → Shared Folders** show **not available**, and **Storage → File Systems** shows the SSD as not mounted, sometimes under a different device name (`sdc` instead of `sda`) or with a different UUID.

**Why it happens:** OMV finds a disk only by the **UUID** of its file system, a unique ID stored at the start of the file system. Device names like `sda` and `sdc` are handed out in the order disks show up at boot and can change at any time, so a new name on its own is harmless. A **different UUID**, though, means this is a different file system from the one OMV set up. A power cut can damage the file system, and a file system created again (by **Create** in OMV, or `mkfs`) always gets a new UUID.

{% include callout.html type="warning" title="Don't write to the SSD while you investigate" text="No **Wipe** or **Create** in OMV, and no copying files onto it. If your old files are still there, writing to the disk is what destroys them. Stop the apps that use the SSD too: in **Services → Compose → Files**, select each one and click **Down**." %}

#### 1. Find out what's wrong

Show which UUID OMV expects (the long ID after `/dev/disk/by-uuid/`):

```bash
grep /srv /etc/fstab
```

```text
/dev/disk/by-uuid/e4cf455c-238f-442d-a08f-9ddf45850684  /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684  ext4  defaults,nofail,...
```

Show the disks that are connected and the UUIDs they have now:

```bash
lsblk -f
```

Find the SSD by its size; its partition is usually `/dev/sda1`. Save both values in variables so the next commands can use them (replace them with yours):

```bash
OLD=e4cf455c-238f-442d-a08f-9ddf45850684   # the UUID from /etc/fstab
DEV=/dev/sda1                              # the SSD's partition from lsblk
```

Now compare:

- **The SSD has the same UUID as `fstab`**: the file system is only damaged. Check and repair it with `sudo fsck.ext4 -fn $DEV` (look, change nothing), then `sudo fsck.ext4 -fy $DEV` (repair), and reboot. You're done; the steps below are for the other case.
- **The SSD has a different UUID**: carry on. First make sure no other disk still uses the old UUID. This should print nothing:

  ```bash
  sudo blkid -U $OLD
  ```

#### 2. Check what's on the SSD

Check the file system for errors without changing anything, then look inside it **read-only**:

```bash
sudo fsck.ext4 -fn $DEV
sudo mkdir -p /mnt/check && sudo mount -o ro $DEV /mnt/check && ls /mnt/check; sudo umount /mnt/check
sudo dumpe2fs -h $DEV | grep -E "created|Last mount"
```

- **Your folders are there:** only the UUID changed and nothing is lost. The fix below makes OMV use the disk again as it is.
- **Only `lost+found`, and `Filesystem created` is recent:** the disk was formatted. The fix below still brings OMV, your shared folders and your apps back, but the files have to come back from your other devices (Syncthing) or a backup.

Also look at the mount folder itself. Because OMV mounts with `nofail`, apps can write into this folder on the **SD card** while the SSD is missing:

```bash
sudo du -sh /srv/dev-disk-by-uuid-$OLD
```

A few KB is just empty folders. Move them aside (rather than deleting them) and put an empty folder back, so the SSD can be mounted there:

```bash
sudo mv /srv/dev-disk-by-uuid-$OLD /root/srv-leftovers
sudo mkdir /srv/dev-disk-by-uuid-$OLD
```

If it shows megabytes or more, look inside first. Those are files your apps saved while the SSD was gone, and you'll want to copy them onto the SSD afterwards.

#### 3. Give the SSD its old UUID back

```bash
sudo e2fsck -f $DEV
sudo tune2fs -U $OLD $DEV
sudo systemctl daemon-reload
sudo mount -a
```

What each command does:

- **`e2fsck -f`** checks the whole file system and fixes any errors. `tune2fs` refuses to change a UUID until the file system has just been checked, so this always comes first. The disk must not be mounted.
- **`tune2fs -U $OLD $DEV`** changes the file system's UUID to the one OMV expects. It rewrites only that ID (plus the file system's internal checksums, which are based on it). Your files are not touched. To OMV, the disk now looks exactly like the one it set up, so its mount entry, shared folders, SMB shares and app settings all work again without changes.
- **`systemctl daemon-reload`** makes systemd re-read `/etc/fstab`, so it knows about the disk under its new ID.
- **`mount -a`** mounts everything listed in `/etc/fstab` that isn't mounted yet, including the SSD.

Check it worked. This should show your partition (`/dev/sda1`):

```bash
findmnt /srv/dev-disk-by-uuid-$OLD
```

In the dashboard, **Storage → File Systems** shows the SSD as mounted again.

#### 4. Recreate the shared folders (only if the disk was formatted)

If the shared folders still show **not available**, their settings are fine (OMV keeps them on the SD card) but the folders themselves are missing on the SSD. This creates all of them in one go, with the owner and rights OMV gives a new shared folder:

```bash
mnt=/srv/dev-disk-by-uuid-$OLD
sudo omv-confdbadm read conf.system.sharedfolder | jq -r '.[].reldirpath' | while read -r p; do
  sudo mkdir -p "$mnt/$p"
  sudo chown root:users "$mnt/$p"
  sudo chmod 2775 "$mnt/$p"
done
ls -l "$mnt"
```

- **`omv-confdbadm read conf.system.sharedfolder`** prints every shared folder from OMV's settings, and **`jq -r '.[].reldirpath'`** picks out each one's path on the disk (for example `development/android/`).
- **`mkdir -p`** creates each folder, including parent folders, and doesn't complain if one already exists.
- **`chown root:users`** and **`chmod 2775`** match OMV's default for **Administrator: read/write, Users: read/write, Others: read-only**. The `2` keeps new files inside in the `users` group. For a folder set to **Others: no access**, run `sudo chmod 2770` on it instead.

Reload the dashboard, and the folders show as available. You don't need to redo the per-user **Permissions** or the SMB shares; those live in OMV's settings, not on the disk.

#### 5. Restore the files and restart the apps

Copy your files back from a device that still has them, for example a computer that syncs with Syncthing, or from your backup. Then start the apps again under **Services → Compose → Files** (**Up**). Some apps need their data folder to belong to a specific user; for the official Nextcloud image that's `sudo chown -R 33:33` on its data folder.

{% include callout.html type="tip" title="So it doesn't happen again" text="Shut down from the dashboard's power menu, never by pulling the plug. Plug the SSD's power and the Pi into the same power strip, or better, a small UPS. Keep a second copy of everything with a nightly **Rsync** job to another drive (see step 15). And remember that **Wipe** and **Create** in OMV run immediately: discarding the yellow banner afterwards does not undo them." %}
