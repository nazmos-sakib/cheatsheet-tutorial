---
title: "Linux disks, partitions and file systems, explained simply"
description: How Linux sees an SSD or any other disk, from device names and UUIDs to partitions, file systems and mount points. Mount and unmount safely, mount at boot with fstab, format, check and repair, and learn lsblk, blkid, findmnt, df, du, fdisk, mkfs, dumpe2fs, fsck.ext4 and tune2fs without losing data.
tags: [linux, storage, raspberry-pi, nas, basics, concepts]
related: [raspberry-pi-nas-openmediavault, systemd-mount-ssd-at-boot, linux-users-groups-and-permissions, phone-alerts-for-your-raspberry-pi-nas]
tested_on: "Written for Debian 12 and 13, Raspberry Pi OS (Bookworm and Trixie) and OpenMediaVault 8, with util-linux 2.38 and e2fsprogs 1.47 or newer"
time: "1 hour to read, longer if you try the practice lab"
updated: 2026-10-27
---

Plugging an SSD into a Linux machine doesn't make your files appear. Linux first has to recognise the disk, find the partitions on it, understand the file system inside each partition, and then attach that file system to a folder. When any one of those layers goes wrong, the symptoms all look the same: "the disk is gone", even though usually it isn't.

This page explains each layer from the beginning, using the Raspberry Pi NAS as the example: OpenMediaVault (OMV) on a microSD card, and a USB SSD mounted under `/srv`. You'll learn:

- how a disk becomes a folder: disk, partition, file system, mount point,
- why `/dev/sda` can turn into `/dev/sdc` overnight, and why UUIDs don't,
- how to look at disks with read-only commands: `lsblk`, `blkid`, `findmnt`, `df`, `du`, `fdisk -l` and `dumpe2fs`,
- how to mount and unmount by hand, and at every boot with `/etc/fstab`,
- how to partition and format (`fdisk`, `mkfs`), check and repair (`fsck.ext4`), and change settings (`tune2fs`),
- the traps that destroy data, including one in the OMV dashboard, and a practice lab where you can make every mistake on a fake disk.

All commands run **on the Linux machine**, in a terminal or over SSH. Commands that start with `sudo` need an account that is allowed to use it (see [Linux users, groups and permissions]({{ '/tutorials/linux-users-groups-and-permissions/' | relative_url }})).

{% include callout.html type="warning" title="Read before you type" text="Most disk commands on this page only **look**. A few **erase**: `mkfs`, `wipefs`, `fdisk` (once you press `w`), `dd`, `tune2fs` on the wrong device, and **Wipe** or **Create** in the OMV dashboard. Each of those is marked with a warning. There is no undo and no recycle bin for them. When you are not sure, use the [practice lab](#practice-lab-break-a-fake-disk-safely) first." %}

## The big picture: four layers
{: .no-step}

Think of a disk like an empty warehouse:

| Layer | Warehouse picture | On the Pi NAS |
|---|---|---|
| **Disk** | The empty building | The SSD, which Linux calls `/dev/sda` |
| **Partition** | Walls that split the building into rooms | `/dev/sda1`, one partition that fills the SSD |
| **File system** | Shelves, labels and an index in one room, so things can be found again | ext4, the standard Linux file system |
| **Mount point** | The door from the street into that room | The folder `/srv/dev-disk-by-uuid-e4cf…` |

Stacked up, it looks like this:

```text
  /srv/dev-disk-by-uuid-e4cf…/     ← mount point: the folder you and your apps use
            ▲
            │  mount
  ext4 file system (UUID e4cf…)    ← the index of files and folders
            │
  /dev/sda1  (partition)           ← a slice of the disk
            │
  /dev/sda   (whole disk)          ← the SSD itself, a long row of numbered blocks
```

Two facts follow from this picture, and they explain most disk problems:

1. **Formatting replaces the index, not just the files.** `mkfs` builds a brand-new, empty file system with a brand-new UUID. The old index is gone, so the old files are gone, even if their bytes are still somewhere on the disk.
2. **A mount point is just a folder.** When nothing is mounted on it, it is an ordinary, empty folder on the microSD card, and programs can happily write into it. More on that trap in [Mounting](#mounting-how-a-disk-appears-in-a-folder).

## Device names: sda, nvme0n1, mmcblk0
{: .no-step}

Linux puts every disk and partition in `/dev` as a special file, called a **block device**. The names follow the kind of connection:

| Name | What it is |
|---|---|
| `/dev/sda`, `/dev/sdb`, … | USB, SATA and SAS disks, in the order they were detected. Partitions add a number: `sda1`, `sda2`. |
| `/dev/nvme0n1` | An NVMe SSD. Partitions add `p` and a number: `nvme0n1p1`. |
| `/dev/mmcblk0` | The microSD card on a Raspberry Pi. Partitions: `mmcblk0p1` (boot) and `mmcblk0p2` (the system). |
| `/dev/loop0`, `/dev/zram0` | Not real disks. A loop device is a file pretending to be a disk; zram is compressed swap in RAM. You can ignore them. |

{% include callout.html type="warning" title="sdX names can change at every boot" text="The letters are handed out first come, first served. Add a USB stick, use a different port, or let a disk spin up a second slower after a power cut, and yesterday's `/dev/sdc` is today's `/dev/sda`. **Never** put `/dev/sdX` names in `/etc/fstab`, scripts or backup jobs, and always check the name again with `lsblk` right before a command that writes to a disk." %}

On the Pi NAS, the SSD showed up as `sdc` when OMV was installed and as `sda` after a power cut. That change on its own is harmless, because OMV doesn't use the letters. It uses UUIDs.

## UUIDs, labels and stable names
{: .no-step}

Because letters move around, Linux gives you names that don't:

| Name | Belongs to | Changes when… |
|---|---|---|
| **UUID** (e.g. `e4cf455c-238f-…`) | The **file system** | You format (`mkfs`) or deliberately change it with `tune2fs -U`. Not when you move ports. |
| **PARTUUID** | The **partition** | You re-create the partition table (`fdisk`, OMV Wipe). |
| **LABEL** (e.g. `data`) | The file system | You set it with `mkfs -L`, `tune2fs -L` or `e2label`. Optional, and two disks can share one by mistake. |
| **by-id** (e.g. `usb-SupTronics_X825_2022…`) | The **physical disk**: model and serial number | Never. It survives formatting. |

Each kind has a folder of shortcuts under `/dev/disk/` that always point at the current letter:

```bash
ls -l /dev/disk/by-uuid/
ls -l /dev/disk/by-id/
```

```text
lrwxrwxrwx 1 root root 10 Oct 27 12:30 6c772d25-7fc3-4192-aada-1bf34f58642c -> ../../sda1
lrwxrwxrwx 1 root root 13 Oct 27 12:30 02f61d5e-92cb-4f9c-a781-099d97795020 -> ../../mmcblk0p2
```

So `/dev/disk/by-uuid/6c772d25-…` is "whatever `sdX1` currently holds that file system". That is exactly what OMV writes into `/etc/fstab`, and why its mount folders are called `/srv/dev-disk-by-uuid-…`.

The UUID being tied to the file system cuts both ways. Moving the SSD to another port: fine. Formatting it, even with the same size and the same type: **new UUID**, and OMV, `fstab` and every shared folder stop finding it. If you ever see "the disk has a different UUID now", the file system was re-created. A power cut can damage a file system, but it can't invent a new UUID.

{% include callout.html type="tip" title="Which physical disk is it?" text="`by-id` names contain the model and serial number, and they don't change when the disk is formatted. When you have two similar drives, `ls -l /dev/disk/by-id/` tells you which `sdX` is which box on your desk." %}

## Partition tables: GPT and MBR
{: .no-step}

The very start of a disk holds the **partition table**: the list of where each partition starts and ends. There are two kinds:

| Type | Also called | Use it when |
|---|---|---|
| **GPT** | `gpt` | Almost always. Any disk size, up to 128 partitions, and a backup copy of the table at the end of the disk. |
| **MBR** | `dos`, `msdos` | Old computers, and the Raspberry Pi's own microSD card. Disks up to 2 TiB, four main partitions. |

You can put a file system straight on a whole disk with no partition table (`mkfs.ext4 /dev/sda`), and OMV sometimes does this. It works, but other tools and other operating systems may think the disk is empty and offer to "initialise" it. One partition that fills the disk is the safer habit.

## File systems: which one to choose
{: .no-step}

| File system | Good for | Notes |
|---|---|---|
| **ext4** | Any disk that only Linux uses: the NAS SSD, the Pi's system | The default. Journaled, so it survives power cuts well, understands Linux owners and permissions, mature repair tools. **Use this unless you have a reason not to.** |
| **XFS** | Very large disks and big files | Fast and robust. It can grow but never shrink. Repair tool is `xfs_repair`. |
| **Btrfs** | Snapshots, checksums, several disks in one pool | Powerful, more to learn. OMV supports it. |
| **exFAT** | USB sticks and drives you also plug into Windows and macOS | No Linux owners or permissions, no journal, so a power cut can hurt more. Install `exfatprogs`. |
| **FAT32** (vfat) | The Pi's boot partition, very old devices | 4 GB maximum file size. |
| **NTFS** | Drives that mostly live on Windows | Linux can read and write it (`ntfs3` driver), but repairs need Windows. |
| **swap** | Extra memory on disk | Not for files. |

The rest of this page uses ext4, because that is what OMV creates by default. The tools `e2fsck` (also called `fsck.ext4`), `dumpe2fs`, `tune2fs` and `resize2fs` belong to the **ext2/3/4 family** and only work on ext file systems.

A **journal** is the reason ext4 copes with power cuts: before it changes the index, it writes down what it is about to do. After a crash it replays or discards those notes in a second, instead of checking the whole disk. A journal protects the file system's structure. It doesn't save the last file that was being written, and it can't protect against a disk that loses power in the middle of its own internal housekeeping. A small UPS or a USB enclosure on the same power strip as the Pi helps there.

## Mounting: how a disk appears in a folder
{: .no-step}

Linux has one tree of folders starting at `/`. There is no `C:` or `D:`. To use a file system, you **mount** it on an existing folder, the mount point, and from then on that folder shows the file system's contents:

```text
/                    ← the microSD card (mmcblk0p2)
├── boot/firmware    ← the microSD boot partition (mmcblk0p1)
├── home/
└── srv/
    └── dev-disk-by-uuid-e4cf…/   ← the SSD, when mounted
        ├── sync/
        └── nextcloud/
```

Unmounting detaches it again. The folder stays, now empty.

### The hidden-files trap

Here is the part that catches everyone once. When the SSD is **not** mounted, `/srv/dev-disk-by-uuid-e4cf…` is just an empty folder on the microSD card. If Syncthing, Nextcloud or a Docker container starts at that moment, it doesn't see an error. It sees an empty folder it is allowed to write to, and it starts filling it, on the SD card.

Later the SSD is mounted on top. The SSD's files appear, and the files that were written to the SD card are **hidden underneath**, still taking up space. Worse, a sync program that saw the "empty" folder may already have told your other devices that everything was deleted.

Two habits protect you:

- **Check what is under a mount point before mounting over it.** With the disk unmounted, `sudo du -sh /srv/dev-disk-by-uuid-…` should say `4.0K` (an empty folder). Anything bigger means files were written to the SD card.
- **Make the empty mount folder read-only for everyone, even root.** While the disk is **unmounted**, run:

```bash
sudo chattr +i /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
```

The `i` (immutable) flag means nothing can create files in the empty folder. Mounting over it still works, and once the SSD is mounted you see the SSD's own folder, which is unaffected. Now a missing SSD makes apps fail loudly ("read-only" or "permission denied") instead of silently writing to the wrong place. `lsattr -d /srv/dev-disk-by-uuid-…` shows the flag, and `sudo chattr -i …` removes it.

For containers there is one more safety net: start them only when the disk is mounted. In OMV's compose plugin or in a systemd unit this is a dependency on the mount (see [Writing systemd units: mount an SSD at boot]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }})).

## Look before you touch: read-only commands
{: .no-step}

Everything in this section only reads. Run these as often as you like; they can't hurt your data. Before every command that writes to a disk, run the first two again.

### lsblk: what disks are there?

`lsblk` lists block devices as a tree. With `-f` it adds the file system, label, UUID, free space and where it is mounted:

```bash
lsblk -f
```

```text
NAME        FSTYPE FSVER LABEL  UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
sda
└─sda1      ext4   1.0   data   e4cf455c-238f-442d-a08f-9ddf45850684  201.3G    9% /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
mmcblk0
├─mmcblk0p1 vfat   FAT32 bootfs 0398-3084                             432.9M    14% /boot/firmware
└─mmcblk0p2 ext4   1.0   rootfs 02f61d5e-92cb-4f9c-a781-099d97795020   22.8G    17% /
zram0       swap   1     zram0  8c65cae8-cbcf-4cd3-9b4d-279c56c7ae4e                [SWAP]
```

How to read it:

- Lines without an indent (`sda`, `mmcblk0`) are **disks**. Indented lines (`└─sda1`) are **partitions** on that disk.
- An empty `FSTYPE` and `UUID` means "no file system Linux recognises here": a new disk, or a damaged one.
- An empty `MOUNTPOINTS` means "not mounted right now".
- On OMV you'll see many extra mount points for `mmcblk0p2` under `/run/omv-writecache/…`. That's OMV's feature that reduces writes to the SD card; it's normal.

To tell physical disks apart, ask for model, serial, size and connection instead:

```bash
lsblk -o NAME,SIZE,TYPE,TRAN,MODEL,SERIAL
```

`TRAN` shows `usb`, `sata` or `nvme`. Size plus model is the quickest way to be sure `sda` is the SSD and not a USB stick.

### blkid: what is on this partition?

`blkid` reads the label at the start of a partition and prints its type and IDs:

```bash
sudo blkid /dev/sda1
```

```text
/dev/sda1: LABEL="data" UUID="e4cf455c-238f-442d-a08f-9ddf45850684" BLOCK_SIZE="4096" TYPE="ext4" PARTUUID="071f3b6c-4684-4ae7-8f7e-74c8c59f3e00"
```

It can also search the other way round, from an ID to a device:

```bash
sudo blkid -U e4cf455c-238f-442d-a08f-9ddf45850684    # which device has this UUID?
sudo blkid -L data                                    # which device has this label?
```

If `blkid -U` prints **nothing**, no connected disk has that UUID. That's the one-line test for "OMV is looking for a file system that isn't there". Careful with `sudo blkid $(sudo blkid -U …)`: when the inner command finds nothing, the outer `blkid` runs with no argument and lists **every** device, which looks like a match but isn't.

### findmnt: what is mounted where?

`findmnt` shows the tree of mounted file systems, and answers questions about one mount point or file:

```bash
findmnt                                   # everything, as a tree
findmnt --real                            # only real disks, no /proc, /sys and friends
findmnt /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
findmnt -T /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684/sync
```

```text
TARGET                                                  SOURCE    FSTYPE OPTIONS
/srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684 /dev/sda1 ext4   rw,relatime,quota,usrquota,grpquota
```

- `findmnt PATH` prints a line **only if something is mounted exactly there**. No output means the folder is a plain folder right now, so anything written to it lands on the SD card.
- `findmnt -T PATH` (target) tells you which file system a file or folder **lives on**. If it says `/dev/mmcblk0p2` for a path under `/srv/…`, you are on the SD card, not the SSD.
- `findmnt --verify` checks `/etc/fstab` for mistakes without mounting anything. Run it after every fstab edit (see [Mount at boot with /etc/fstab](#mount-at-boot-with-etcfstab)).

`mount` with no arguments prints the same information as one long, hard-to-read list. Prefer `findmnt`.

### df: how full is each file system?

`df` (disk free) reports size, used and free space per **mounted** file system:

```bash
df -h
df -hT /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
```

{% include cmd.html sheet="linux" id="df" %}

```text
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4  234G   21G  201G   9% /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
```

`-h` means human-readable (G, M instead of block counts), `-T` adds the type. Point `df` at any path and it tells you about the file system that path lives on, which is another way to check whether you're on the SSD or the SD card.

Two things that confuse people:

- **Size minus Used isn't Avail.** ext4 keeps 5% of the space reserved for root by default, so a full disk doesn't stop the system. On a 240 GB data disk that's 12 GB you can't use. `tune2fs -m` changes it (see [tune2fs](#tune2fs-change-settings-without-formatting)).
- **"No space left on device" while `df` shows free space.** Check `df -i`. That shows **inodes**, the slots for file entries. A disk full of millions of tiny files can run out of inodes before it runs out of bytes.

### du: what is using the space?

`df` says how full a file system is; `du` (disk usage) says which folders and files are filling it:

```bash
sudo du -sh /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
sudo du -h --max-depth=1 /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684 | sort -h
```

{% include cmd.html sheet="linux" id="biggest-items" %}

- `-s` gives one total for the folder; `-h` is human-readable.
- `--max-depth=1` gives one line per subfolder, and `sort -h` puts the biggest last.
- `-x` stays on one file system. `sudo du -xh --max-depth=1 / | sort -h` finds what is filling the **SD card** without counting the SSD mounted under `/srv`.
- Use `sudo`, or folders you can't read are skipped and the totals come out too small.

If `df` and `du` disagree a lot, two usual causes: files hidden under a mount point (the trap above; `du` can't see them while the disk is mounted on top), or a deleted file that a program still has open. `sudo lsof +L1` lists those; restarting the program frees the space.

`ncdu` (`sudo apt install ncdu`) is an interactive version of `du` you can browse with the arrow keys.

### fdisk -l: the partition table

`fdisk -l` (lower-case L, for "list") prints a disk's size, model, partition table type and partitions. It changes nothing:

```bash
sudo fdisk -l /dev/sda
```

```text
Disk /dev/sda: 238.47 GiB, 256060514304 bytes, 500118192 sectors
Disk model: 2115
Disklabel type: gpt
Disk identifier: 6CEC2EE7-59AA-4BC8-8C8C-4A600DE730E2

Device     Start       End   Sectors   Size Type
/dev/sda1   2048 500118158 500116111 238.5G Linux filesystem
```

`Disklabel type` is the partition table (gpt or dos). `Start` and `End` are in sectors of 512 bytes. A first partition starting at sector 2048 (1 MiB) is the normal, well-aligned layout. Without `-l`, `fdisk` opens its editor, covered in [Partition a disk with fdisk](#partition-a-disk-with-fdisk).

### dumpe2fs -h: an ext4 file system's history

`dumpe2fs` prints what an ext file system knows about itself. Always use `-h` (header only); without it you get thousands of lines about every block group:

```bash
sudo dumpe2fs -h /dev/sda1
```

The useful lines:

```text
Filesystem volume name:   data
Filesystem UUID:          e4cf455c-238f-442d-a08f-9ddf45850684
Filesystem state:         clean
Filesystem created:       Sun Oct 18 09:12:44 2026
Last mount time:          Tue Oct 27 07:41:03 2026
Last write time:          Tue Oct 27 07:41:03 2026
Mount count:              14
Last checked:             Sun Oct 18 09:12:44 2026
Reserved block count:     3125725
Block size:               4096
```

| Line | Tells you |
|---|---|
| `Filesystem created` | **When it was formatted.** If this is newer than your files, the disk was formatted since. |
| `Last mount time`, `Mount count` | When it was last used, and how often. `n/a` and `0` mean never mounted since it was created. |
| `Filesystem state` | `clean`, or `not clean` / `not clean with errors` after a crash. Run fsck on the latter. |
| `Last checked` | When fsck last checked the whole thing. |
| `Reserved block count` | The root-only reserve that `df` doesn't show as available. |

This is the command that settles "did my disk get formatted?" in seconds: an empty file system whose `Filesystem created` time is today, with a mount count of 0, was made today. To see just those lines:

```bash
sudo dumpe2fs -h /dev/sda1 | grep -E "created|Last mount|Mount count|state"
```

`sudo tune2fs -l /dev/sda1` prints the same header.

### Kernel messages: is the hardware OK?

When a disk drops off the USB bus, has read errors, or ext4 hits a problem, the kernel logs it. Look there before blaming the file system:

```bash
sudo dmesg -T | grep -iE "sd[a-z]|usb|ext4|i/o error" | tail -30
sudo journalctl -k -b -1 | grep -iE "sd[a-z]|ext4"     # same, from the previous boot
```

`I/O error`, `reset SuperSpeed USB device` or `USB disconnect` point at the cable, the power supply or the adapter, not at Linux. On a Raspberry Pi, a USB SSD that draws more power than the port can give is the most common cause.

## Mount and unmount by hand
{: .no-step}

### mount

To mount a file system, give the device (or better, its UUID) and an existing, empty folder:

```bash
sudo mkdir -p /mnt/ssd
sudo mount /dev/sda1 /mnt/ssd
sudo mount UUID=e4cf455c-238f-442d-a08f-9ddf45850684 /mnt/ssd     # same, by UUID
```

Linux detects ext4 by itself. For others you can name the type with `-t`, e.g. `-t exfat`.

Options go after `-o`, separated by commas. The ones worth knowing:

| Option | Meaning |
|---|---|
| `ro` | **Read-only.** The safest way to look at a disk you're worried about. Nothing can be written. |
| `rw` | Read-write (the default). |
| `noatime` | Don't record the time of every read. Fewer writes; good for SSDs and SD cards. |
| `remount,ro` / `remount,rw` | Change the options of something already mounted, without unmounting. |
| `uid=1000,gid=1000` | For exFAT, FAT and NTFS only, which have no Linux owners: who owns every file. |

The safe way to peek at a disk you're unsure about:

```bash
sudo mkdir -p /mnt/check
sudo mount -o ro /dev/sda1 /mnt/check
ls -la /mnt/check
sudo umount /mnt/check
```

{% include callout.html type="note" title="mount: (hint) your fstab has been modified" text="This hint means `/etc/fstab` changed and systemd hasn't re-read it yet. Run `sudo systemctl daemon-reload`. It's harmless, but systemd may otherwise use the old fstab." %}

A fresh ext4 file system belongs to root. To let your user write to it, change the owner **while it is mounted** (see [Linux users, groups and permissions]({{ '/tutorials/linux-users-groups-and-permissions/' | relative_url }})).

### umount

Note the spelling: `umount`, without the first `n`. You can give either the folder or the device:

```bash
sudo umount /mnt/ssd
```

Unmounting writes any data still in memory to the disk, then detaches it. **Always unmount (or shut down) before unplugging a disk.** Pulling a mounted disk is the USB version of a power cut.

If it says **`target is busy`**, something still has a file or folder open there, very often your own terminal sitting inside it. Step out and find the culprit:

```bash
cd ~
sudo fuser -vm /mnt/ssd        # which processes use it
sudo lsof +f -- /mnt/ssd       # which files are open
```

Stop that program (for a container, `docker stop NAME`) and try again. `umount -l` (lazy) detaches the folder immediately and finishes later, but programs keep writing to the disk in the background, so don't unplug after a lazy unmount.

For a USB disk you're about to unplug, `sync` then `umount` is enough. `udisksctl power-off -b /dev/sda` also spins the disk down, if `udisks2` is installed.

## Mount at boot with /etc/fstab
{: .no-step}

Mounting by hand lasts until the next reboot. To mount a file system at every boot, add a line to `/etc/fstab` (file systems table). Each line has six fields:

{% include file.html name="/etc/fstab" %}

```text
# <what>                                    <where>      <type> <options>                <dump> <pass>
UUID=e4cf455c-238f-442d-a08f-9ddf45850684   /mnt/ssd     ext4   defaults,noatime,nofail  0      2
```

| Field | What to put there |
|---|---|
| **what** | `UUID=…` (best), `LABEL=…`, or `/dev/disk/by-uuid/…`. **Never `/dev/sda1`**, because the letter can change. |
| **where** | The mount point. The folder must exist. |
| **type** | `ext4`, `exfat`, `vfat`, `ntfs3`, `xfs`, `btrfs`… or `auto`. |
| **options** | `defaults` plus extras, comma-separated, **no spaces**. |
| **dump** | `0`. An old backup tool used it; nothing does now. |
| **pass** | When to run fsck at boot: `1` for `/`, `2` for other ext4 disks, `0` for never (use `0` for exFAT, NTFS and network shares). |

The options that matter for a USB SSD:

- **`nofail`**: if the disk is missing or broken, keep booting. **Without it, a missing USB disk stops the boot and the Pi drops into emergency mode**, with no network and no SSH. Always use it for anything that isn't the system disk.
- **`x-systemd.device-timeout=10s`**: how long to wait for the disk to appear (default 90 seconds). Shorten it so a missing disk doesn't slow the boot.
- **`noatime`**: fewer writes.

`nofail` has the side effect from [the hidden-files trap](#the-hidden-files-trap): the system boots happily with the folder empty, and programs may write into it. That's why the `chattr +i` habit is worth the ten seconds.

### Test an fstab change before you reboot

A broken fstab line is one of the few ways to make a Pi unbootable over SSH. Always test:

```bash
sudo cp /etc/fstab /etc/fstab.bak       # a backup to go back to
sudo nano /etc/fstab                    # make your change
sudo findmnt --verify                   # check the syntax, UUIDs and types
sudo systemctl daemon-reload            # let systemd read the new file
sudo mount -a                           # mount everything listed, now
findmnt /mnt/ssd                        # did it work?
```

`mount -a` mounts everything in fstab that isn't mounted yet and prints an error for a bad line, so you find the mistake now, not at the next boot. Only reboot once both checks are quiet.

If the machine still ends up in emergency mode, log in at the console with a keyboard and screen, run `mount -o remount,rw /` if needed, fix or comment out (`#`) the bad line, or copy back `/etc/fstab.bak`, and reboot.

{% include callout.html type="warning" title="On OpenMediaVault, let OMV write fstab" text="OMV manages its own lines in `/etc/fstab`, between `# >>> [openmediavault]` and `# <<< [openmediavault]`, and rewrites them every time you apply a change in the dashboard. Edits you make inside that block are lost. Mount OMV disks through **Storage → File Systems**. Lines you add **outside** the block are kept." %}

On a systemd system, each fstab line becomes a `.mount` unit at boot. If you'd rather write that unit yourself, or have a service wait for the disk, see [Writing systemd units: mount an SSD at boot]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}).

## Partition a disk with fdisk
{: .no-step}

{% include callout.html type="warning" title="This erases the disk" text="Writing a new partition table makes everything on the disk unreachable. Before you start: run `lsblk -o NAME,SIZE,MODEL,SERIAL` and confirm the disk by size **and** model, run `findmnt` to make sure nothing on it is mounted, and make sure you have a copy of anything you need. Never point `fdisk` at `/dev/mmcblk0`, which is the Pi's system." %}

`fdisk` without `-l` is an interactive editor. **Nothing is written until you press `w`**, and `q` quits without changes, so you can explore safely as long as you never type `w`:

```bash
sudo fdisk /dev/sda
```

To give a disk a fresh GPT table with one partition that fills it, type these keys, pressing Enter after each:

| Key | Does |
|---|---|
| `p` | Print the current table. Look at it: is this the right disk? |
| `g` | Create a new, empty **GPT** table (`o` would create MBR). |
| `n` | New partition. Press Enter three times to accept number 1, the first sector and the last sector (the whole disk). |
| `p` | Print again to check. If it asks to remove an old signature, answer `Y`. |
| `w` | **Write and exit. This is the point of no return.** |

The new partition is `/dev/sda1`. It has no file system yet; `lsblk -f` shows it with an empty `FSTYPE`.

The same thing in one line, with `parted`, which is easier in scripts:

```bash
sudo parted /dev/sda --script mklabel gpt mkpart primary ext4 0% 100%
```

Old signatures sometimes confuse tools after re-partitioning. `sudo wipefs /dev/sda` (no options) **lists** the signatures it finds; `sudo wipefs -a /dev/sda` **erases** them all, which is what OMV's quick Wipe does.

## Format: create a file system with mkfs
{: .no-step}

{% include callout.html type="warning" title="This erases the partition" text="`mkfs` replaces whatever is on the partition with a new, empty file system and a new UUID. Check the name with `lsblk -f` right before you press Enter. On an SSD, `mkfs.ext4` also tells the drive to erase every block (TRIM), so afterwards there is usually **nothing left to recover**, even with recovery tools." %}

`mkfs` (make file system) is a family of commands, one per type:

```bash
sudo mkfs.ext4 -L data /dev/sda1        # ext4, labelled "data"
sudo mkfs.exfat -n USB /dev/sdb1        # exFAT (needs exfatprogs)
sudo mkfs.vfat -F 32 -n USB /dev/sdb1   # FAT32
```

Useful `mkfs.ext4` options:

| Option | Meaning |
|---|---|
| `-L data` | Label, up to 16 characters. |
| `-m 1` | Reserve 1% for root instead of 5%. Sensible for a data-only disk; keep the default on the system disk. |
| `-n` | **Dry run**: print what it would do and write nothing. Good for checking you have the right device. |

When it finishes it prints the new UUID. If this replaces a file system that OMV or fstab knew about, that old UUID is now gone, which is why OMV shows the file system as missing afterwards. To mount it, add the new UUID to fstab, or in OMV, mount it as a new file system.

## Check and repair: fsck.ext4
{: .no-step}

`fsck` (file system check) reads the whole index of a file system, finds inconsistencies, and can repair them. For ext4 the tool is `e2fsck`; `fsck.ext4` is the same program under another name.

{% include callout.html type="warning" title="Never fsck a mounted file system" text="Repairing a file system while Linux is also writing to it can destroy it. Unmount it first (`sudo umount /dev/sda1`, and check with `findmnt`). For the system disk, fsck runs automatically at boot, before `/` is mounted read-write." %}

The safe order:

```bash
sudo umount /dev/sda1                 # 1. make sure it is not mounted
sudo fsck.ext4 -fn /dev/sda1          # 2. check only, answer "no" to every fix
sudo fsck.ext4 -fy /dev/sda1          # 3. if step 2 found problems: repair
```

| Option | Meaning |
|---|---|
| `-n` | **Read-only.** Report problems, change nothing. Always start here. |
| `-f` | Force a full check, even if the file system says it is clean. |
| `-p` | Fix simple, safe problems automatically, stop on serious ones. What boot uses. |
| `-y` | Answer yes to every repair. Use it after `-n` has shown you what is wrong. |

A healthy result ends like this:

```text
Pass 5: Checking group summary information
/dev/sda1: 12/15630336 files (0.0% non-contiguous), 1259204/62514513 blocks
```

`12/15630336 files` is "12 files used out of 15 million possible". A brand-new, empty ext4 file system always has about 11 or 12 (the root folder, `lost+found` and internal files), so a number that low on a disk that should be full of photos means the file system is new, not damaged.

What the exit code means (`echo $?` right after):

| Code | Meaning |
|---|---|
| `0` | No errors. |
| `1` | Errors found and fixed. |
| `2` | Fixed; reboot (only matters for the system disk). |
| `4` | Errors left unfixed. Run again with `-y`, or ask for help. |
| `8` | fsck itself failed: wrong device, not ext4, still mounted. |

After a repair, files whose folder entry was lost turn up in `lost+found` at the top of the file system, named by number. That's what the folder is for.

### "Bad magic number in super-block"

The **superblock** is the file system's header, at the start of the partition. If it is damaged, fsck and mount both fail with `bad superblock` or `Bad magic number`. ext4 keeps backup copies further along the disk. Try the first backup (for 4 KB blocks it is at block 32768):

```bash
sudo fsck.ext4 -n -b 32768 /dev/sda1      # check using the backup, read-only
sudo fsck.ext4 -y -b 32768 /dev/sda1      # repair using it
```

`sudo dumpe2fs /dev/sda1 | grep -i "superblock at"` lists all backup locations, if the primary is still readable. If `blkid` shows no `TYPE` at all and no backup works, the partition may not be ext4, may be on a different partition, or may have been overwritten. Stop there and see [If you formatted the wrong disk](#if-you-formatted-the-wrong-disk).

## tune2fs: change settings without formatting
{: .no-step}

`tune2fs` changes an existing ext file system's settings **without touching the files**. Most changes are safe on a mounted file system; changing the UUID is not, so unmount for that one.

```bash
sudo tune2fs -l /dev/sda1                 # list settings (like dumpe2fs -h)
sudo tune2fs -L data /dev/sda1            # set the label
sudo tune2fs -m 1 /dev/sda1               # reserve 1% for root instead of 5%
sudo tune2fs -c 30 -i 1m /dev/sda1        # full fsck every 30 mounts or monthly
sudo tune2fs -c -1 -i 0 /dev/sda1         # turn those periodic checks off (the default)
```

### Changing the UUID

`-U` gives a file system a UUID of your choice, or `random`. This is how you make OMV and fstab recognise a re-created file system **as if it were the old one**, so all the shared folders, SMB shares and container paths that point at `/srv/dev-disk-by-uuid-OLD` work again (empty, if the files are gone):

```bash
sudo umount /dev/sda1
sudo e2fsck -f /dev/sda1                                        # tune2fs requires a fresh check first
sudo tune2fs -U e4cf455c-238f-442d-a08f-9ddf45850684 /dev/sda1  # give it the old UUID
sudo systemctl daemon-reload
sudo mount -a
findmnt /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684
```

{% include callout.html type="warning" title="Two disks, one UUID" text="Only do this when the old file system is gone for good. If two connected disks share a UUID, Linux picks one of them, and it may not be the one you expect. Never give a copy or clone the same UUID as a disk that is still in use." %}

## Keep an SSD healthy
{: .no-step}

### TRIM

An SSD runs faster and wears more evenly when it knows which blocks are free. **TRIM** tells it. Debian and Raspberry Pi OS run it weekly with a timer:

```bash
systemctl status fstrim.timer          # is the weekly TRIM on?
sudo fstrim -v /srv/dev-disk-by-uuid-e4cf455c-238f-442d-a08f-9ddf45850684   # run it now
lsblk --discard                        # DISC-MAX of 0B: this disk or adapter doesn't support TRIM
```

Many USB-to-SATA adapters don't pass TRIM through. The SSD still works, just without it.

### SMART: the disk's own health report

Disks keep their own error counters, called SMART. OMV shows them under **Storage → S.M.A.R.T.**; on the command line:

```bash
sudo apt install smartmontools
sudo smartctl -H /dev/sda              # overall verdict: PASSED or FAILED
sudo smartctl -a /dev/sda              # everything
sudo smartctl -a -d sat /dev/sda       # if a USB adapter hides SMART, try this
```

Watch `Reallocated_Sector_Ct`, `Media_Wearout_Indicator` or `Percentage Used` (NVMe), and `Power-Off_Retract_Count` or `Unsafe_Shutdowns`, which count power cuts. A rising error count means replace the disk soon.

### Power

ext4's journal handles a sudden power cut well, but SSDs and USB adapters can still lose data that was in flight. On a Pi NAS: use the official power supply, give an SSD board with its own power input the same power strip as the Pi, shut down with `sudo poweroff` instead of pulling the plug, and consider a small UPS. And keep backups, because nothing else protects against the disk dying.

## The OpenMediaVault traps
{: .no-step}

OMV does everything above for you through the dashboard, which is great until a button does more than it looks like. Four things to know:

1. **Wipe and Create run immediately.** In **Storage → Disks**, **Wipe** erases the disk the moment you confirm. In **Storage → File Systems**, **Create** formats the moment you click Save. The yellow "pending changes" banner that appears afterwards is only about **configuration**: mount entries, shared folders, services. Clicking **Discard** there does **not** undo a wipe or a format. By then the data is already gone.
2. **"Missing" doesn't mean "create a new one".** When OMV shows a file system as missing, or the disk shows up with a different UUID, the right move is to find out why (the [troubleshooting](#troubleshooting) list below), not to create a file system on the disk you see. Creating one is a format.
3. **Mount an existing file system, don't create one.** If you move a disk to a new OMV install, use the **mount** (play icon) button in **Storage → File Systems** to add the file system that is already there. Create is only for empty disks.
4. **Shared folders point at a UUID.** Every shared folder, SMB share and Docker bind mount sits under `/srv/dev-disk-by-uuid-…`. If the UUID changes, they all break at once. OMV won't let you delete a file system that shared folders still use, which protects your settings; `tune2fs -U` (above) can bring a re-created file system back under the old name.

## If you formatted the wrong disk
{: .no-step}

1. **Stop writing to it.** Unmount it, stop containers that use it, and don't create, wipe or copy anything onto it. Every write can overwrite what's left.
2. **Look for copies elsewhere first.** Syncthing devices, Nextcloud clients, a phone's camera roll, a laptop: anything that synced from the NAS still has a full copy. Don't let them sync with the empty NAS until you've restored, or they may "sync" the emptiness.
3. **Recovery tools are a long shot on SSDs.** `testdisk` can find lost partition tables (this works if only the table was wiped, not the file system); `photorec` searches raw blocks for files by type. On a hard disk they often find a lot. On an SSD, `mkfs.ext4` and OMV's wipe usually TRIM the whole disk, after which the drive returns zeros and there is nothing to find. Work on an image, not the disk: `sudo dd if=/dev/sda of=/path/on/another/disk/ssd.img bs=4M status=progress` (and triple-check that `if=` is the source and `of=` the destination, because swapping them overwrites the disk).
4. **Then fix the cause and add a backup.** One copy of anything you care about isn't a backup. An rsync job to a second disk (OMV **Services → Rsync**) or a backup to another machine is.

## Practice lab: break a fake disk safely
{: .no-step}

You can try every dangerous command on this page without any risk, using a **file that pretends to be a disk**. Linux calls that a loop device. If you make a mistake here, the worst outcome is deleting one file.

## Create a fake 1 GB disk

Make an empty 1 GB file in your home folder and attach it as a loop device:

```bash
truncate -s 1G ~/practice.img
sudo losetup -fP --show ~/practice.img
```

The second command prints the loop device it chose, for example `/dev/loop1`. **Use the name it printed** in every command below; this page writes `/dev/loopX`. Check it:

```bash
lsblk /dev/loopX
```

It shows a 1G disk with no partitions. This "disk" is the only thing you'll touch in this lab.

## Partition it with fdisk

```bash
sudo fdisk /dev/loopX
```

Type `g`, then `n`, press Enter three times, type `p` to look, then `w`. Now:

```bash
lsblk -f /dev/loopX
sudo fdisk -l /dev/loopX
```

There is a partition `loopXp1` with an empty `FSTYPE`: partitioned, not yet formatted.

## Format it and look at it

```bash
sudo mkfs.ext4 -L practice /dev/loopXp1
lsblk -f /dev/loopX
sudo blkid /dev/loopXp1
sudo dumpe2fs -h /dev/loopXp1 | grep -E "name|UUID|created|Mount count|state"
```

Note the UUID and the creation time. Mount count is 0, because it has never been mounted.

## Mount it, use it, unmount it

```bash
sudo mkdir -p /mnt/practice
sudo mount /dev/loopXp1 /mnt/practice
sudo chown "$USER": /mnt/practice
echo "hello" > /mnt/practice/test.txt
findmnt /mnt/practice
df -h /mnt/practice
du -sh /mnt/practice
```

Now try the busy error on purpose:

```bash
cd /mnt/practice
sudo umount /mnt/practice        # target is busy: your shell is inside it
cd ~
sudo umount /mnt/practice        # works
ls /mnt/practice                 # empty: you see the plain folder again
```

## See the hidden-files trap with your own eyes

With the fake disk unmounted, write a file into the empty folder, then mount on top:

```bash
sudo touch /mnt/practice/written-while-unmounted.txt
sudo mount /dev/loopXp1 /mnt/practice
ls /mnt/practice                 # test.txt and lost+found; the other file is hidden
sudo umount /mnt/practice
ls /mnt/practice                 # and there it is again
sudo rm /mnt/practice/written-while-unmounted.txt
```

Now protect the folder and try again:

```bash
sudo chattr +i /mnt/practice
sudo touch /mnt/practice/again.txt     # Operation not permitted
sudo mount /dev/loopXp1 /mnt/practice  # mounting still works
ls /mnt/practice
sudo umount /mnt/practice
```

## Check, tune and re-format

```bash
sudo fsck.ext4 -fn /dev/loopXp1                  # healthy, read-only check
sudo tune2fs -L renamed /dev/loopXp1
sudo tune2fs -m 1 /dev/loopXp1
sudo dumpe2fs -h /dev/loopXp1 | grep -E "name|Reserved block count"
```

Now format it again, as if you clicked Create by mistake, and compare:

```bash
sudo mkfs.ext4 -F /dev/loopXp1
sudo blkid /dev/loopXp1                 # new UUID, no label
sudo mount /dev/loopXp1 /mnt/practice
ls /mnt/practice                        # test.txt is gone; only lost+found
sudo umount /mnt/practice
```

That is exactly what a format looks like afterwards: healthy, empty, a new UUID and a creation time of "just now". Put the old UUID back with `tune2fs -U` if you like; the name comes back, the files don't.

## Clean up

```bash
sudo chattr -i /mnt/practice
sudo rmdir /mnt/practice
sudo losetup -d /dev/loopX
rm ~/practice.img
```

`losetup -d` detaches the loop device; `rm` deletes the file that was your fake disk. Nothing else on the machine was touched.

## Safety checklist before any command that writes to a disk
{: .no-step}

Run through this every time, for `fdisk`, `mkfs`, `wipefs`, `dd`, `tune2fs -U`, fsck repairs, and OMV's Wipe or Create:

1. **Which disk?** `lsblk -o NAME,SIZE,MODEL,SERIAL,MOUNTPOINTS`. Match the size and model, not just the letter.
2. **Is anything on it mounted?** `findmnt` / `lsblk -f`. Unmount first; never fsck or format something mounted.
3. **What's on it?** `sudo blkid` and, for ext4, `sudo dumpe2fs -h`. If it has a file system you don't recognise, find out why before you erase it.
4. **Is there a copy?** If losing it would hurt, back it up first.
5. **Type the device last**, after re-reading the command, and prefer a dry run (`fsck -n`, `mkfs -n`, `wipefs` without `-a`) when there is one.

## Troubleshooting
{: .no-step}

- **The disk doesn't mount after a reboot or power cut.** Work down the layers. Does Linux see the disk at all (`lsblk`, `sudo dmesg -T | tail -30`)? Does the partition have a file system (`lsblk -f`)? Is it the UUID fstab expects (`grep -v '^#' /etc/fstab`, then `sudo blkid -U THAT-UUID`)? Is it healthy (`sudo fsck.ext4 -fn /dev/sda1`)?
- **The disk has a different name (`sdc` is now `sda`).** Normal. Nothing to fix, as long as fstab uses UUIDs.
- **The disk has a different UUID.** The file system was re-created: a wipe, a Create in OMV, or `mkfs`. Check `Filesystem created` in `dumpe2fs -h`. If the files are gone, `tune2fs -U OLD-UUID` brings back the name so OMV's settings work again.
- **`wrong fs type, bad option, bad superblock`.** Wrong `type` or an option typo in fstab, or a damaged superblock. Check `lsblk -f` for the real type, then try `fsck.ext4 -n -b 32768`.
- **`can't read superblock` or `I/O error`.** Usually hardware: cable, power, adapter. Check `dmesg`, try another port and the official power supply, and look at `smartctl -H`.
- **The Pi boots into emergency mode.** An fstab line for a disk that isn't there, without `nofail`. Fix it at the console (see [Test an fstab change](#test-an-fstab-change-before-you-reboot)).
- **`target is busy` on umount.** `cd ~`, then `sudo fuser -vm /mount/point` to find who is using it.
- **"No space left on device" but `df` shows space.** Out of inodes (`df -i`) or the root reserve (`tune2fs -m`). If `df` says full but `du` finds little, look for files hidden under a mount point, or deleted-but-open files (`sudo lsof +L1`).
- **The SD card is filling up for no reason.** Files written under `/srv/…` while the SSD wasn't mounted. Unmount the SSD (stop the containers first) and run `sudo du -sh /srv/dev-disk-by-uuid-*` to see them.
- **fsck says `is mounted`.** Unmount it first. The system disk `/` can't be unmounted; it is checked at boot instead. To force a full check of it once on a Pi, add ` fsck.mode=force` to the end of the single line in `/boot/firmware/cmdline.txt`, reboot, then remove it again.
- **Permission denied on a freshly formatted disk.** New ext4 file systems belong to root. `sudo chown` the folders you need while it is mounted.

## The commands in one place
{: .no-step}

**Look (read-only, always safe)**

| Command | What it tells you |
|---|---|
| `lsblk -f` | Disks, partitions, file system types, UUIDs, mount points |
| `lsblk -o NAME,SIZE,MODEL,SERIAL,TRAN` | Which physical disk is which |
| `sudo blkid /dev/sda1` | Type, label, UUID, PARTUUID of one partition |
| `sudo blkid -U UUID` | Which device has this UUID (nothing: none does) |
| `ls -l /dev/disk/by-uuid/ /dev/disk/by-id/` | Stable names and where they point |
| `findmnt --real` | What is mounted where |
| `findmnt /path` | Is something mounted exactly here? |
| `findmnt -T /path/file` | Which file system does this file live on? |
| `findmnt --verify` | Check `/etc/fstab` for mistakes |
| `df -hT` | Size, used, free per file system |
| `df -i` | Inodes used and free |
| <code>sudo du -h --max-depth=1 /path &#124; sort -h</code> | Which folders use the most space |
| `sudo fdisk -l /dev/sda` | Partition table and partitions |
| `sudo dumpe2fs -h /dev/sda1` | ext4 header: created, last mounted, state, UUID |
| <code>sudo dmesg -T &#124; tail -30</code> | Recent kernel messages: disconnects, I/O errors |
| `sudo smartctl -H /dev/sda` | The disk's own health verdict |

**Mount**

| Command | Does |
|---|---|
| `sudo mount /dev/sda1 /mnt/ssd` | Mount now |
| `sudo mount -o ro /dev/sda1 /mnt/check` | Mount read-only, to look safely |
| `sudo umount /mnt/ssd` | Unmount |
| `sudo fuser -vm /mnt/ssd` | Who keeps it busy |
| `sudo systemctl daemon-reload && sudo mount -a` | Apply an fstab change now |
| `sudo chattr +i /empty/mount/point` | Stop anything writing into an unmounted mount point |

**Change (check the device first)**

| Command | Does |
|---|---|
| `sudo fsck.ext4 -fn /dev/sda1` | Check, change nothing (unmounted) |
| `sudo fsck.ext4 -fy /dev/sda1` | Check and repair (unmounted) |
| `sudo tune2fs -L NAME /dev/sda1` | Set the label |
| `sudo tune2fs -m 1 /dev/sda1` | Root reserve to 1% |
| `sudo tune2fs -U UUID /dev/sda1` | Set the UUID (unmounted, after `e2fsck -f`) |
| `sudo fstrim -v /mount/point` | TRIM an SSD now |

**Erase (there is no undo)**

| Command | Does |
|---|---|
| `sudo fdisk /dev/sda` then `w` | Write a new partition table |
| `sudo parted /dev/sda --script mklabel gpt mkpart primary ext4 0% 100%` | Same, in one line |
| `sudo wipefs -a /dev/sda` | Erase all signatures (OMV's quick Wipe) |
| `sudo mkfs.ext4 -L data /dev/sda1` | New, empty ext4 file system, new UUID |
| OMV **Wipe** / **Create** | The same, and it happens before the yellow banner appears |
