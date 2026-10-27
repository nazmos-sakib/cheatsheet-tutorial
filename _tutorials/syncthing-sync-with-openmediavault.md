---
title: "Sync every device through your Raspberry Pi NAS with Syncthing"
description: Run Syncthing in Docker on OpenMediaVault and keep folders in sync between the NAS and your Windows, Mac, Linux, Android and iPhone devices, with the NAS as the always-on hub.
tags: [raspberry-pi, nas, syncthing, docker, sync, storage]
related: [raspberry-pi-nas-openmediavault, docker-basics-explained-simply, systemd-mount-ssd-at-boot]
tested_on: "Written for Syncthing 2 (official syncthing/syncthing Docker image) on OpenMediaVault 8 with the compose plugin on a Raspberry Pi 4, Syncthing-Fork on Android and Möbius Sync on iOS"
time: "About 1 hour, plus a few minutes per device"
updated: 2026-10-20
---

A shared folder on the NAS is great while you're at home, but you have to be connected to open it, and files you save on your laptop on the train aren't on the NAS until you copy them there. **Syncthing** fixes that. It keeps a real copy of a folder on every device and copies changes between them automatically, in both directions, as soon as the devices can reach each other. There is no cloud account: the files only ever travel between your own devices, encrypted.

Syncthing has no central server; any two devices can sync directly. That's flexible, but with five or six devices it gets messy, and two devices that are rarely on at the same time hardly ever sync. So this tutorial makes the NAS the **hub**: it's always on, every device syncs with it, and changes travel phone → NAS → laptop even when the phone and laptop are never online together.

By the end you will have:

- Syncthing running in Docker on your OpenMediaVault NAS, with its files on the SSD,
- your Windows, Mac and Linux computers syncing folders with the NAS,
- your Android phone syncing with Syncthing-Fork, and your iPhone with Möbius Sync,
- phone photos copied to the NAS automatically,
- deleted and overwritten files kept on the NAS for a while, in case you change your mind.

This builds on [Build a NAS on a Raspberry Pi 4 with OpenMediaVault]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}). You need a working OMV NAS with a data drive, users and shared folders before you start.

## How it fits together
{: .no-step}

```text
   iPhone ────┐                ┌──── Windows PC
              │                │
  Android ────┼──►  NAS  ◄─────┼──── Mac
              │  (always on)   │
   Laptop ────┘                └──── Linux PC
```

Each device only knows about the NAS, and the NAS knows about every device. When you add a folder, you share it from the NAS to the devices that should have it. Not every device needs every folder: your phone might get only `Documents`, while your desktop gets everything.

Three words you'll see in Syncthing:

- **Device:** a computer or phone running Syncthing. Each one has a long **Device ID**, like `MFZWI3D-BONSGYC-...`. Two devices only sync once each has added the other's ID.
- **Folder:** a folder that is synced. It has a **Folder ID** (the same on every device) and a **path** (where it lives on each device, which can differ).
- **Folder type:** **Send & Receive** (normal two-way sync), **Send Only** (this device's changes go out, others' changes don't come in) or **Receive Only** (the opposite).

{% include callout.html type="warning" title="Sync is not a backup" text="Syncthing copies deletions and mistakes as faithfully as it copies new files. Delete a folder on your laptop and it disappears from the NAS and every other device too. Step 6 turns on **file versioning** on the NAS, which keeps old and deleted files for a while, but keep a real backup of the NAS as well (see *Keep the NAS healthy* in the NAS tutorial)." %}

## What you need
{: .no-step}

| Thing | Notes |
|---|---|
| **An OpenMediaVault NAS** | Set up as in the [NAS tutorial]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}), with the SSD or hard disk mounted and a user account for yourself. A Pi 4 with 2 GB of RAM is enough; Syncthing uses around 100 to 300 MB. |
| **SSH access to the Pi** | For two quick commands in step 3. |
| **The devices you want to sync** | Windows 10 or 11, macOS, Linux, Android 8 or newer, iPhone. |
| **About 2 to 3 times the space you'll sync, on the NAS** | The files themselves, plus room for old versions in `.stversions`. |

## Which user is which
{: .no-step}

A NAS set up as in the NAS tutorial usually has **three different logins**, and mixing them up is the most common reason Syncthing fails with "permission denied". Here's what each one is for:

| Login | Example | What it's for | Does Syncthing use it? |
|---|---|---|---|
| **OMV dashboard admin** | `admin` | Logging in to the OMV web page at `http://nas.local`. It only exists inside OMV and owns no files on the disk. | No |
| **Pi system user** | `pi` | The account you made in Raspberry Pi Imager, for SSH and `sudo`. As the first user on the Pi it gets **uid `1000`**. | No |
| **NAS share user** | `naz` | The account you created under **Users → Users** in OMV and type in when you open a share from Windows, macOS or Linux. Users created later get **uid `1001`**, `1002`, and so on. | **Yes** |

Syncthing should run as the **NAS share user**. Then every file it writes belongs to that user, and you can open, change and delete it over SMB without permission errors. In this tutorial that user is `naz` with uid `1001`. If you only ever made one account and use it for both SSH and shares, that account is your share user and its uid is `1000`.

**Users have numbers.** Linux doesn't store user names on the disk, only numbers: the **uid** (user ID) and **gid** (group ID). Docker containers only see these numbers too, which is why the compose file asks for `PUID` (the user's number) and `PGID` (the group's number), not a name. The group is always `users`, number `100` on every OMV system; every user you create in OMV is in it.

**There are two kinds of permissions in OMV,** with two different buttons in **Storage → Shared Folders**:

- **Permissions** (the key icon) only decides who may open the folder **over SMB/NFS**. Syncthing doesn't go through SMB, so this button doesn't affect it.
- **Access control list** (ACL) shows and sets the **real permissions on the disk**: the folder's owner, its group, and what owner, group and everybody else may do. This is what Syncthing needs, and the place to look when it says "permission denied".

For folders, Linux permissions are **read** (list what's inside), **write** (create and delete files inside) and **execute** (go into the folder at all). Syncthing needs all three on its folders. Without execute, it can't even look inside, and the error says `stat ...: permission denied`.

## Create shared folders on the NAS

Syncthing needs two places on the data drive: one for its own settings and database, and one for the files it syncs. The OMV compose plugin also needs a folder for its compose files. Keeping them as separate shared folders keeps each one's permissions simple.

Open the OMV dashboard (`http://nas.local`), go to **Storage → Shared Folders** and create these three, with **+** → **Create** each time. Pick your data drive as the **File system** for all of them:

| Name | What goes in it | Permissions |
|---|---|---|
| `compose` | The compose files the plugin manages. Skip it if you already have one from another Docker app. | Administrator: read/write, Users: read/write, Others: no access |
| `syncthing` | Syncthing's settings, keys and database. | Administrator: read/write, Users: read/write, Others: no access |
| `sync` | The files you sync. Every synced folder becomes a subfolder of this one. | Administrator: read/write, Users: read/write, Others: read-only |

Click **Save** after each one, then the check mark on the yellow banner to apply.

**Check the disk permissions.** For `syncthing` and `sync`, select the folder and click **Access control list**. At the top you'll see the folder's owner and group with their permissions. It should look like this:

- **Owner:** `root`. That's normal for a new shared folder and can stay.
- **Group:** `users` with **Read/Write/Execute**. This is the line that matters, because Syncthing runs in the `users` group.
- **Others:** **No access** (or Read/Execute on `sync`, if you chose read-only for others).

If the group has anything less than Read/Write/Execute, change it, tick **Recursive** so it applies to everything inside, and click **Save**.

{% include callout.html type="note" title="Don't create these folders with sudo mkdir" text="Create shared folders and their subfolders from the OMV dashboard, from a share over SMB, or let Syncthing create them. A folder made over SSH with `sudo mkdir` belongs to `root` with no write access for the group, so neither Syncthing nor your share user can use it. If that's already happened, step 3 shows how to hand it to your share user with `chown`." %}

{% include callout.html type="tip" title="Want to see the synced files over SMB too?" text="Share the `sync` folder over SMB as in the NAS tutorial. Then you can open the NAS's copy of every synced folder from Explorer or Finder, and anything you change there syncs out to your devices as well." %}

## Install the compose plugin and Docker

OMV runs Docker apps through the **compose** plugin from omv-extras, which the OMV install script already added.

1. Go to **System → Plugins**, search for `compose`, select **openmediavault-compose** and click **Install** (the down-arrow icon). Wait for it to finish and reload the page when it asks.
2. Go to **Services → Compose → Settings**.
3. Under **Compose Files**, set **Shared folder** to `compose`.
4. Under **Docker**, set **Docker storage** to a folder on your data drive rather than the microSD card, for example the absolute path of your drive followed by `/docker` (see step 3 for how to find it). Docker writes a lot, and microSD cards wear out.
5. Click **Save** and apply.
6. If the **Status** at the top of the Docker section says Docker is **not installed**, click **Reinstall Docker** and wait for it to finish.

When Docker is running, the settings page shows its version and **Status: Installed and running**.

New to Docker? [Docker basics, explained simply]({{ '/tutorials/docker-basics-explained-simply/' | relative_url }}) covers images, containers and compose files in 20 minutes.

## Look up your user ID and the folder paths

Two details go into the compose file in the next step.

**Which user Syncthing runs as.** This is your **NAS share user**, the one you type in when you open a share (see *Which user is which* above), not the `pi` user you log in to SSH with. Log in over SSH **as `pi`**, and ask Linux for the share user's numbers (replace `naz` with your share user's name):

```bash
ssh pi@nas.local
id naz
```

```text
uid=1001(naz) gid=100(users) groups=100(users)
```

Note the **uid** (here `1001`). The gid of `users` is `100` on every OMV system. Run `id` with the **share user's** name: plain `id` without a name, or `id pi`, prints the SSH user's number (`1000`), which is the wrong one unless you use a single account for everything.

{% include callout.html type="warning" title="Pick the user before the first start" text="Syncthing makes its settings files private to the user it runs as. If you start it as one uid and later change `PUID` to another, it can't open its own settings and the container keeps restarting with `syncthing.lock: permission denied`. If that happens, hand both folders to the new user over SSH (with your paths and uid), then click **Down** and **Up** in **Services → Compose → Files**:<br>`sudo chown -R 1001:100 /srv/dev-disk-by-uuid-*/syncthing`<br>`sudo chown -R 1001:100 /srv/dev-disk-by-uuid-*/sync`<br>Your settings, password and Device ID are kept; only the owner changes. The same command fixes a folder someone made with `sudo mkdir`." %}

**Where the shared folders are.** OMV mounts your drive at a long path like `/srv/dev-disk-by-uuid-1f3c...`. Back in the dashboard on **Storage → Shared Folders**, click the **column chooser** icon (top-right of the table) and switch on **Absolute Path**. Copy the paths of `syncthing` and `sync`. Or list them over SSH:

```bash
ls -d /srv/dev-disk-by-uuid-*/sync /srv/dev-disk-by-uuid-*/syncthing
```

```text
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/sync
/srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/syncthing
```

## Start Syncthing from a compose file

1. Go to **Services → Compose → Files** and click **+** → **Add**.
2. **Name:** `syncthing`.
3. **File:** paste the following, then change the two paths and `PUID` to your own values from step 3:

{% include file.html name="syncthing.yml" %}
```yaml
services:
  syncthing:
    image: syncthing/syncthing:latest
    container_name: syncthing
    environment:
      - PUID=1001   # your NAS share user's uid from step 3 (not pi's)
      - PGID=100    # the "users" group
    volumes:
      # Syncthing's settings, keys and database
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/syncthing:/var/syncthing
      # The files you sync. Inside Syncthing this folder is called /data
      - /srv/dev-disk-by-uuid-1f3c5a7e-0b2d-4e6f-8a9c-123456789abc/sync:/data
    network_mode: host
    restart: unless-stopped
    healthcheck:
      test: curl -fkLsS -m 2 127.0.0.1:8384/rest/noauth/health | grep -o --color=never OK || exit 1
      interval: 1m
      timeout: 10s
      retries: 3
```

4. Click **Save**, then apply.
5. Select the `syncthing` row and click **Up** (the up-arrow icon). OMV pulls the image and starts the container; the output window shows the progress. When it says the container is `Started`, click **Close**.

What the important lines do:

- **`network_mode: host`** puts Syncthing straight on the Pi's network instead of Docker's private one. This is what the Syncthing developers recommend, because it lets your devices find the NAS automatically on your home network. Syncthing then uses port `8384` for its dashboard, `22000` (TCP and UDP) to sync and `21027` (UDP) to announce itself on the network.
- **`PUID` and `PGID`** make Syncthing run as your share user and the `users` group instead of as root, so the files it writes are yours and you can change them over SMB.
- **`volumes`** connect folders on the NAS to folders inside the container. Each line reads `folder on the NAS : name inside the container`. The part **before** the colon is the real folder on your drive, and the part **after** is what Syncthing calls it. The container can't see anything on the NAS that isn't listed here.

  ```text
  /srv/dev-disk-by-uuid-1f3c.../sync : /data
  (real folder on the drive)           (what Syncthing calls it)
  ```

  So when you type `/data/Documents` in the Syncthing dashboard, the files really go to `sync/Documents` on your drive. It's one folder with two names. `/data` is just the name this tutorial uses; Syncthing doesn't require a single root folder, and you can add more lines for more shared folders (see *Sync shared folders you already have* near the end).
- **`restart: unless-stopped`** starts Syncthing again after a reboot.

Under **Services → Compose → Containers**, `syncthing` should show as **running**, and after a minute or two its health as **healthy**.

## Open the Syncthing dashboard and set a password

Syncthing has its own web dashboard, separate from OMV's. Open it on port 8384:

```text
http://nas.local:8384
```

The first time, Syncthing asks whether you want to send anonymous usage reports; answer either way. A red banner then warns that the dashboard has no password. Anyone on your network could open it and share your files with their own device, so fix that first:

1. Click **Settings** in the banner (or **Actions → Settings** in the top-right).
2. On the **GUI** tab, enter a **GUI Authentication User** and a strong **GUI Authentication Password**.
3. Tick **Use HTTPS for GUI** if you like. Your browser will then warn about a self-signed certificate the first time, which is expected for a home server.
4. On the **General** tab, change **Device Name** to `nas`, so other devices show it by a friendly name.
5. Click **Save**. The page reloads and asks you to log in.

Now find the NAS's identity. Click **Actions → Show ID**. You'll see a long Device ID and a QR code. You'll need this ID for every device, so leave this browser tab open.

## Create your first synced folder on the NAS

Syncthing may have created a folder called **Default Folder** on its first start. It lives inside Syncthing's settings folder, not on your `sync` share, so remove it: click it, **Edit** → **Remove** and confirm. This only removes it from Syncthing; no files are deleted.

Then tell Syncthing where new folders should go, so you don't have to type the path each time. Go to **Actions → Settings → General**, click **Edit Folder Defaults**, set **Folder Path** to `/data/` and click **Save** twice.

Now create a folder to sync, for example `Documents`:

1. Click **+ Add Folder**.
2. **General** tab:
   - **Folder Label:** `Documents`. This is the friendly name every device shows.
   - **Folder ID:** Syncthing makes up a random one like `abcd1-ef234`. Keep it; it's how devices recognise the same folder.
   - **Folder Path:** `/data/Documents`.
3. **File Versioning** tab: choose **Staggered File Versioning** and keep the default **Maximum Age** of 365 days. Whenever a file is changed or deleted by another device, the NAS moves the old copy into a hidden `.stversions` folder instead of throwing it away. It keeps one version per hour for the last day, one per day for the last month, and one per week after that, up to the maximum age.
4. **Advanced** tab: leave **Folder Type** as **Send & Receive**.
5. Click **Save**.

The folder appears on the right with the status **Up to Date**. Repeat for every folder you want to sync, for example `Photos`, `Music` or a `Shared` folder for the whole family.

{% include callout.html type="tip" title="Getting old versions back" text="Old versions sit in `sync/Documents/.stversions/` on the NAS, with the date and time added to their names. You can open that folder over SMB and copy a file back. Or, in the Syncthing dashboard, click the folder → **Versions** to browse and restore them by date." %}

{% include callout.html type="note" title="Already have files on the NAS?" text="Point a new folder at an existing subfolder of `sync` and Syncthing will scan and share what's there. If the same folder already exists on a computer too, Syncthing merges the two: files only on one side are copied over, and if a file differs on both sides, the newer one wins and the other is kept as a `.sync-conflict` copy. Nothing is silently lost, but a big merge can leave a few conflict files to tidy up." %}

## Install Syncthing on your computers

Each computer runs its own copy of Syncthing in the background, with the same kind of dashboard at `http://127.0.0.1:8384`. Install it on every computer that should sync. Step 8 then connects each one to the NAS.

### Windows

The simplest way is **SyncTrayzor**, which wraps Syncthing in a tray icon, starts it with Windows and shows a notification when files change. The original project is no longer maintained; use the maintained **v2** fork:

1. Download the latest installer (`SyncTrayzorSetup-x64.exe`, or `arm64` on a Snapdragon laptop) from [github.com/GermanCoding/SyncTrayzor/releases](https://github.com/GermanCoding/SyncTrayzor/releases).
2. Run it and keep the defaults. SyncTrayzor downloads Syncthing itself on first start.
3. When Windows Firewall asks whether Syncthing may communicate on **private networks**, click **Allow**. Without this, the NAS can't find the PC.

SyncTrayzor opens with the Syncthing dashboard inside its window. Closing the window keeps it running in the tray.

### macOS

1. Download **Syncthing for macOS** (a `.dmg`) from [syncthing.net/downloads](https://syncthing.net/downloads/).
2. Drag **Syncthing** into **Applications** and open it. It adds an icon to the menu bar, not the Dock.
3. Click the menu bar icon → **Preferences** and tick **Start at login**.
4. When macOS asks whether Syncthing may find devices on your **local network**, click **Allow**. If you missed it, turn it on under **System Settings → Privacy & Security → Local Network**.

Open the dashboard from the menu bar icon → **Open**.

### Linux

On Debian, Ubuntu, Mint and Raspberry Pi OS, install from Syncthing's own package repository, which has the current version (the distribution's package is often far behind):

```bash
sudo mkdir -p /etc/apt/keyrings
sudo curl -L -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable-v2" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt update
sudo apt install syncthing
```

Start it as **your user** (not root), and make it start whenever you log in:

```bash
systemctl --user enable --now syncthing.service
```

To keep it running even when you're logged out, for example on a home server, also run `sudo loginctl enable-linger $USER`. Check it's running with `systemctl --user status syncthing`, then open `http://127.0.0.1:8384` in a browser. (What `systemctl --user` and these unit files are is explained in [Writing systemd units]({{ '/tutorials/systemd-mount-ssd-at-boot/' | relative_url }}).)

On Fedora use `sudo dnf install syncthing`, and on Arch `sudo pacman -S syncthing`, then the same `systemctl` command.

## Pair a device with the NAS and share a folder

You do this once per device. It works the same on Windows, macOS and Linux, and almost the same on phones (steps 9 and 10).

**On the computer:**

1. Open its Syncthing dashboard. If it created a **Default Folder** (a `Sync` folder in your home folder), remove it as in step 6, unless you want to use it.
2. Click **+ Add Remote Device**.
3. **Device ID:** paste the NAS's ID from step 5. If the computer is on your home network, the NAS usually appears in a list under the box already; just click it.
4. **Device Name:** `nas`.
5. Click **Save**.

**On the NAS dashboard** (`http://nas.local:8384`), within a minute a banner appears: *Device "laptop" (ABCD123...) wants to connect. Add new device?*

1. Click **Add Device**.
2. On the **Sharing** tab, tick the folders this device should get, for example `Documents`.
3. Click **Save**.

**Back on the computer,** a new banner appears: *nas wants to share folder "Documents". Add new folder?*

1. Click **Add**.
2. Check **Folder Path**. It suggests a folder in your home folder, like `~/Documents`. Change it if you want the files somewhere else.
3. Click **Save**.

The two start syncing. The folder on the computer shows **Syncing** with a percentage, then **Up to Date**, and the NAS device shows **Connected** on the right. From now on, change a file on either side and the other has it within seconds.

{% include callout.html type="warning" title="Careful with folders that already exist" text="If you point the shared folder at a computer folder that already has files in it, such as your real `~/Documents`, Syncthing merges it with the NAS copy. That's often what you want, but do it once with a test folder first so you know what to expect, and make sure versioning is on at the NAS (step 6)." %}

{% include callout.html type="note" title="Should the computers also sync with each other?" text="No need. With every device connected only to the NAS, a change on your laptop goes to the NAS and from there to your desktop. If the two are both online and you want faster syncing between them, you can pair them directly as well; Syncthing will then use whichever path is available. It's optional." %}

Repeat this step for each computer. To share another folder later, edit the folder on the NAS (**Edit** → **Sharing**), tick the device, save, and accept it on the device.

## Set up Android with Syncthing-Fork

The original Syncthing Android app was discontinued at the end of 2024. **Syncthing-Fork** is the community-maintained continuation, with Syncthing built in and more control over when it runs.

1. Install **Syncthing-Fork** from [F-Droid](https://f-droid.org/packages/com.github.catfriend1.syncthingandroid/) or Google Play. Check the listing is called Syncthing-Fork and not some other "Syncthing" app.
2. Open it and go through the welcome screens. Grant the permissions it asks for:
   - **All files access** (or storage), so it can sync folders like `Documents` and `DCIM`.
   - **Notifications**, which it needs to keep running in the background.
   - **Ignore battery optimisation**. Without this, Android will stop it after a few minutes and syncing becomes unreliable.
3. Remove the example **Camera** folder it may suggest, if you don't want it yet (step 11 sets up photos properly).

Then pair it with the NAS:

1. Open the **Devices** tab and tap **+**.
2. Tap the **QR code** icon next to the Device ID field and scan the QR code from the NAS's **Actions → Show ID** screen. That saves typing the long ID.
3. **Name:** `nas`. Tap the **check mark** to save.
4. On the NAS dashboard, accept the phone and tick the folders it should get, exactly as in step 8.
5. On the phone, a notification says the NAS wants to share a folder. Tap it, choose where on the phone to put it (for example `Documents/Documents`), and tap the check mark.

**Choose when it runs.** In **Settings → Run conditions** you can limit syncing to when the phone is on Wi-Fi, on specific Wi-Fi networks (your home network) or charging. A good starting point is **Run only when on Wi-Fi**, so big folders don't use your mobile data. Turn off **Respect Android battery saver** if you want it to keep syncing while the battery saver is on.

{% include callout.html type="tip" title="Keep it on, but quiet" text="Syncthing-Fork shows a permanent notification while it runs. Android requires it for background apps. You can hide it by long-pressing it and turning that notification category off, without stopping the app." %}

## Set up iPhone with Möbius Sync

There's no official Syncthing app for iOS. **Möbius Sync** is the most established Syncthing app for iPhone and iPad. It's free to try with a 20 MB limit on synced data; a one-time in-app purchase removes the limit.

**Know the limitation first.** iOS doesn't let apps run in the background whenever they like. Syncthing needs to stay connected to sync, so Möbius Sync can only sync properly **while the app is open**, plus short moments iOS grants it in the background now and then. Your iPhone won't receive a file the instant it lands on the NAS, as Android and the computers do; it catches up the next time you open the app. Because the NAS is always on, that's fine in practice: the iPhone picks up everything at once when you open Möbius, and its changes are on the NAS for every other device straight away.

1. Install **Möbius Sync** from the App Store and open it.
2. Allow **Local Network** access when iOS asks. Without it, it can't find the NAS at home.
3. Tap the **Devices** tab → **+**, scan the NAS's QR code (or paste the ID), name it `nas` and save.
4. On the NAS dashboard, accept the iPhone and tick the folders it should get (step 8).
5. In Möbius Sync, accept the shared folder when it appears. It's stored inside Möbius's own space on the phone.

You'll find the synced folders in the **Files** app under **On My iPhone → Möbius Sync**, where other apps can open and save files in them.

**Making it sync more often:**

- Leave **Settings → General → Background App Refresh** on for Möbius Sync, so iOS gives it the occasional background window.
- Open Möbius Sync for a minute when you want something synced right away, for example before you leave home with documents you'll need.
- Create a **Shortcuts** automation to open it for you: in the Shortcuts app, **Automation → +**, choose a trigger like **Arrive** (home) or **Charger** (is connected), and add the action **Open App → Möbius Sync**. Set it to run immediately.

{% include callout.html type="note" title="A free alternative" text="**Synctrain** is a newer, free and open-source Syncthing app for iOS. It has the same background limitation, since that's iOS, not the app. Try it if you don't need Möbius's extra features." %}

## Back up phone photos to the NAS

Photos are a special case. You want every photo the phone takes copied to the NAS, but you don't want the NAS pushing your whole photo archive back onto the phone. Folder types handle that.

**On Android:**

1. In Syncthing-Fork, open **Folders** → **+**.
2. **Folder label:** `Phone photos (Pixel)`, or any name with the phone in it, so every phone gets its own folder.
3. **Directory:** pick `DCIM/Camera`.
4. **Folder type:** **Send Only**.
5. Under **Share with devices**, switch on `nas`. Save.
6. On the NAS dashboard, accept the new folder with the path `/data/Phone photos (Pixel)`. Then edit it: on **Advanced**, set **Folder Type** to **Receive Only**, and on **File Versioning**, choose **Trash Can File Versioning** with **Clean out after** `0` days (keep forever). Save.

**On iPhone:** Möbius Sync has a photo backup feature that copies your camera roll into a Syncthing folder, which then syncs to the NAS like any other. Find it in the app's settings, turn it on, share the folder it uses with the NAS, and set it to **Receive Only** with trash can versioning on the NAS as above. Remember that it only runs while Möbius gets time to run (step 10).

Why trash can versioning? **Send Only** means the phone sends its changes, and deleting a photo is a change. When you clear photos off a full phone, Syncthing removes them from the NAS folder too, but the trash can versioning moves them into `.stversions` instead of deleting them. So everything the phone ever took stays on the NAS. Every now and then, move older photos from the NAS folder (and its `.stversions`) into your main photo archive over SMB.

## Keep junk files out and handle conflicts

**Ignore system junk.** macOS scatters `.DS_Store` files and Windows makes `Thumbs.db` and `desktop.ini`. Syncthing would happily sync them all around. Add an ignore list on the NAS so it never shares them: click a folder → **Edit** → **Ignore Patterns** and paste:

{% include file.html name="Ignore Patterns" %}
```text
// System junk from macOS, Windows and Linux.
// (?d) lets Syncthing delete these if they block removing a folder.
(?d).DS_Store
(?d)._*
(?d).Spotlight-V100
(?d).Trashes
(?d)Thumbs.db
(?d)desktop.ini
(?d).directory
// Half-written files from editors and downloads
*.tmp
*.part
*.crdownload
~$*
```

Save. Ignore patterns aren't synced between devices; they apply to the device you set them on. Setting them on the NAS stops junk from being passed on through the hub. Add the same list on your Mac and Windows PC to stop them sending it in the first place.

**Conflicts.** If the same file is changed on two devices before they've synced (say, you edit a document on your laptop offline and on your desktop at home), Syncthing can't know which you want. It keeps the newer one under the real name and saves the other next to it as:

```text
report.sync-conflict-20261020-143512-ABCD123.docx
```

The date, time and the start of the losing device's ID are in the name. Open both, keep what you need, and delete the conflict file. To find them all on the NAS, run this over SSH:

```bash
find /srv/dev-disk-by-uuid-*/sync -name '*.sync-conflict-*'
```

Conflicts are rare when every device syncs through an always-on NAS. They happen most with an iPhone that hasn't opened Möbius for a while, so open it before editing shared documents on the phone.

## Syncing when you're away from home
{: .no-step}

Out of the box, Syncthing works outside your home network too. Each device announces itself to Syncthing's free **global discovery** servers, and when two devices can't connect directly (because both are behind a router, as your NAS is), they go through a public **relay**. Everything is end-to-end encrypted, so the relay only passes along scrambled data. So your laptop syncs with the NAS from a café with no extra setup. Relays are slower than a direct connection, though, so expect big files to take a while.

For faster connections from outside, there are two options:

- **Let your router open the port automatically.** Syncthing asks your router to forward port 22000 using UPnP if the router allows it. Check the NAS dashboard: under **This Device**, **Listeners** and the connection type of a remote device show whether it's direct or relayed.
- **Use a VPN such as Tailscale or WireGuard.** If your devices are already on one, they connect directly over it.

If you'd rather your files never leave your home network at all, turn off **Global Discovery**, **Enable Relaying** and **Enable NAT traversal** under **Actions → Settings → Connections** on the NAS. Devices then only sync when they're at home (or on your VPN).

## Sync shared folders you already have
{: .no-step}

Syncthing doesn't need everything under one root folder. A synced folder can be any folder the container can see, and `sync` is only the starting point this tutorial uses. If your NAS already has shared folders, say `projects` and `documents`, that you open over SMB, you can sync those directly instead of copying files into `sync`:

1. Find their absolute paths as in step 3.
2. In **Services → Compose → Files**, edit `syncthing` and add one line per folder under `volumes:`. The name after the colon is up to you:

   {% include file.html name="syncthing.yml (volumes only)" %}
   ```yaml
       volumes:
         - /srv/dev-disk-by-uuid-1f3c.../syncthing:/var/syncthing
         - /srv/dev-disk-by-uuid-1f3c.../sync:/data
         - /srv/dev-disk-by-uuid-1f3c.../projects:/projects
         - /srv/dev-disk-by-uuid-1f3c.../documents:/documents
   ```

3. Save, then click **Up** again. OMV recreates the container with the new folders.
4. Check each folder's **Access control list** gives the `users` group Read/Write/Execute (step 1), or Syncthing can't write there.
5. In the Syncthing dashboard, **+ Add Folder** with a path like `/projects/my-android-app` or simply `/projects`, and share it with your devices as in step 8.

The folders stay normal SMB shares. Anything you change over SMB syncs out, and anything that syncs in shows up over SMB. Files already in the folder are merged with what each device has, so try it with a small folder first.

**Example: one project at the office and at home.** Say you work on an Android app on your office PC and want to carry on from your laptop at home. GitHub covers the code, but the project also has architecture documents, notes, `.env` files with secrets you'd never push, PDFs and screenshots. Keep the whole project in one synced folder, shared from the NAS to the office PC and the laptop, and every file is on both machines by the time you get home. Add ignore patterns (step 12) for the files Android Studio builds on each machine, because syncing them only causes conflicts:

{% include file.html name="Ignore Patterns" %}
```text
build/
.gradle/
.idea/
*.iml
local.properties
```

`local.properties` holds each computer's own Android SDK path, so it must stay local. A git repository inside a synced folder works too, as long as you don't change the project on both machines before they've synced. Let the office PC show **Up to Date** before you leave.

## Keep Syncthing up to date and backed up

**Updates.** Syncthing inside Docker doesn't update itself. Every month or so, in **Services → Compose → Files**, select `syncthing` and click **Pull** (download the newest image), then **Up** to restart it on the new version. Your settings and files are untouched, because they live on the shared folders, not in the container. Your computers' Syncthing updates itself (Windows, macOS) or with `apt upgrade` (Linux); the phone apps update through their stores.

**Keep Syncthing's settings safe.** The `syncthing` shared folder holds the NAS's keys, and the keys *are* its identity: lose them and every device sees a stranger. It's small, so include it in the nightly rsync job from the NAS tutorial alongside `sync`.

**Keep a real backup.** Versioning protects against accidents for a while, but it lives on the same drive as everything else. Back up the `sync` folder to a second drive or another place, as described in *Keep the NAS healthy* in the NAS tutorial.

**Watch it now and then.** The NAS dashboard shows each device's **Last Seen** time. A device that hasn't been seen in weeks (an old laptop, or an iPhone where Möbius hasn't been opened) is quietly falling behind. Remove devices you no longer use with **Edit → Remove**.

## Troubleshooting
{: .no-step}

- **`http://nas.local:8384` doesn't open.** Check **Services → Compose → Containers**: the container must be **running**. Click the `syncthing` row → **Logs** for the reason. Most often a path in the compose file has a typo; copy it again from **Absolute Path** in step 3.
- **The logs say `stat /data/Documents: permission denied` or `Failed to create folder root directory`.** Syncthing isn't allowed into the folder at all. In **Storage → Shared Folders → Access control list**, give the `users` group **Read/Write/Execute** on `sync` and tick **Recursive** (step 1). Remember the key-icon **Permissions** button only covers SMB and won't fix this. Also check `PUID` is your share user's uid from `id naz`, not pi's (step 3). Then click the folder → **Rescan**.
- **The container keeps restarting with `Failed to acquire lock ... syncthing.lock: permission denied`.** You changed `PUID` after Syncthing's first start, so the new user can't open the old settings. Run the `chown` commands from the warning in step 3, then **Down** and **Up**.
- **I created a folder on the NAS but can't open it from another device.** If you made a new shared folder in OMV, it also needs its own SMB share under **Services → SMB/CIFS → Shares** and the right users under **Permissions**. If you made it over SSH with `sudo mkdir`, it belongs to root: hand it to your share user with `sudo chown -R 1001:100` and that folder's path, then `sudo chmod -R 2775` on it. `ls -la` on the parent folder shows who owns what.
- **A device stays "Disconnected".** Check both sides have added each other's Device ID exactly. On a computer, allow Syncthing through the firewall on private networks (Windows) or allow Local Network access (macOS). On the NAS, the compose file must have `network_mode: host`.
- **The NAS shows "Failed to start filesystem watcher" for a folder.** Linux limits how many folders one program can watch, and a big folder tree runs past the Pi's default. Syncthing still syncs, just by rescanning every hour instead of instantly. Raise the limit over SSH:

  ```bash
  echo "fs.inotify.max_user_watches=204800" | sudo tee /etc/sysctl.d/90-syncthing.conf
  sudo sysctl --system
  ```

  Then restart the container from **Services → Compose → Files** (**Down**, then **Up**).
- **The first sync is very slow.** Syncthing hashes every file when it first scans a folder, and the Pi 4 isn't fast at that. Tens of gigabytes can take hours the first time. Later changes only scan what changed.
- **The Android app stops syncing after a while.** Android stopped it to save battery. In Android **Settings → Apps → Syncthing-Fork → Battery**, choose **Unrestricted**. Some phone makers (Samsung, Xiaomi, Huawei) have an extra "sleeping apps" or "autostart" list; add Syncthing-Fork there too. [dontkillmyapp.com](https://dontkillmyapp.com/) lists the steps for each brand.
- **The iPhone is always behind.** That's the iOS limitation from step 10. Open Möbius Sync and leave it open until it says it's up to date, and add the Shortcuts automation.
- **Files I write over SMB to `sync` aren't synced.** They are, but on its own schedule if the filesystem watcher failed (see above). Click the folder → **Rescan** to sync now.
- **A folder says "Out of Sync" with a list of failed items.** Click **Failed Items** to see why. Common causes are file names Windows can't store (such as names containing `:` or `?`, or ending with a space or dot) and files open in another program on Windows. Rename the file on the device that has it, and the error clears on the next scan.
- **I accidentally deleted a folder on my laptop and it vanished everywhere.** Look in `.stversions` in the same folder on the NAS (step 6), or click the folder → **Versions** in the NAS dashboard, and restore from there.
