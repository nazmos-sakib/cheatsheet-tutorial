---
title: "Reach your Raspberry Pi NAS from anywhere with Tailscale"
description: Put your OpenMediaVault NAS and your Windows, Mac, Linux, Android and iPhone devices on a private Tailscale network, so the OMV dashboard, SSH, SMB shares and Syncthing work away from home without opening a single port on your router.
tags: [raspberry-pi, nas, networking, vpn, tailscale]
related: [raspberry-pi-nas-openmediavault, syncthing-sync-with-openmediavault, ssh-key-configuration-on-pi]
tested_on: "Written for the current Tailscale client from Tailscale's own package repository, on OpenMediaVault 8 and Raspberry Pi OS Lite 64-bit (Trixie, Debian 13) on a Raspberry Pi 4, with the Tailscale apps for Windows, macOS, Linux, Android and iOS"
time: "About 30 minutes, plus a few minutes per device"
updated: 2026-10-20
---

At home, your NAS is easy to reach: `http://nas.local` opens the dashboard and `smb://nas.local/media` opens a share. Leave the house and none of that works, because your router keeps everything on your home network private. That's a good thing. The usual way around it, forwarding ports on the router, puts the NAS's login pages on the open internet where every scanner in the world will find them.

**Tailscale** solves this without opening anything. It's a VPN that links your own devices into a small private network called a **tailnet**. Each device gets a second, private address (starting with `100.`) and a short name, and every device in the tailnet can reach every other one as if they were on the same home network, wherever they actually are. The connections are direct and encrypted with WireGuard, and only devices signed in to your account can join.

By the end you will have:

- Tailscale on the NAS, starting at boot and never logging itself out,
- Tailscale on your Windows, Mac and Linux computers, Android phone and iPhone,
- the OMV dashboard, SSH and your SMB shares working from anywhere, by the name `nas`,
- Syncthing syncing directly through the tailnet instead of through slow public relays,
- optionally, the whole home network reachable, and the NAS as a safe exit for public Wi-Fi.

This builds on [Build a NAS on a Raspberry Pi 4 with OpenMediaVault]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}). You need a working OMV NAS with SSH, users and SMB shares. The Syncthing step assumes [Sync every device through your NAS with Syncthing]({{ '/tutorials/syncthing-sync-with-openmediavault/' | relative_url }}), but you can skip it if you don't use Syncthing.

## How it fits together
{: .no-step}

```text
                       Tailscale coordination server
                       (only swaps keys, never sees files)
                                    ▲
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
   iPhone (café 4G) ◄────── direct, encrypted ──────►  NAS (home)
   100.80.1.2                                         100.64.10.20
                                                      name: nas
   Laptop (hotel Wi-Fi) ◄── direct, encrypted ──────►     ▲
   100.90.3.4                                             │
                                                    your router:
                                                    no ports open
```

Every device runs the Tailscale app and signs in to the same account. Tailscale's servers introduce the devices to each other and hand out keys, then the devices connect **directly** to each other, punching through routers the same way video calls do. When a direct path is impossible (some strict hotel or office networks), traffic goes through Tailscale's **DERP** relays instead; it's still end-to-end encrypted, just slower.

Four words you'll see:

- **Tailnet:** your private network, made of every device signed in to your Tailscale account.
- **Tailscale IP:** each device's fixed private address in the tailnet, such as `100.64.10.20`. It never changes, at home or away.
- **MagicDNS:** Tailscale's name service. It lets you use a device's short name (`nas`) or full name (`nas.tail1234.ts.net`) instead of its IP. It replaces `nas.local`, which only works on your home network.
- **Admin console:** the web page at [login.tailscale.com/admin](https://login.tailscale.com/admin) where you see and manage your devices.

{% include callout.html type="note" title="Why not just forward ports?" text="Forwarding port 80 or 445 to the NAS exposes OMV's login and your SMB shares to the whole internet, and SMB in particular is a favourite target for attacks. With Tailscale, nothing on your router changes and the NAS stays invisible to everyone outside your tailnet." %}

## What you need
{: .no-step}

| Thing | Notes |
|---|---|
| **An OpenMediaVault NAS** | Set up as in the [NAS tutorial]({{ '/tutorials/raspberry-pi-nas-openmediavault/' | relative_url }}), reachable over SSH as `ssh naz@nas.local` (use your own user name). |
| **A Tailscale account** | Free. The **Personal** plan is plenty for one household's devices. You sign in with an existing Google, Microsoft, Apple or GitHub account; Tailscale stores no password of its own. |
| **The devices you want to use the NAS from** | Windows 10 or 11, macOS, Linux, Android, iPhone or iPad. |
| **About 30 MB of RAM on the Pi** | That's all Tailscale uses. It's fine on a 2 GB Pi 4 alongside OMV and Syncthing. |

{% include callout.html type="tip" title="Do the first steps at home" text="Set up the NAS and at least one device while you're on your home network, so you can still reach the NAS the normal way if something goes wrong. Then test from your phone with Wi-Fi turned off, using mobile data, to prove it really works from outside." %}

## Create your Tailscale account

1. Go to [tailscale.com](https://tailscale.com/) and click **Get started**.
2. Choose how to sign in: **Google**, **Microsoft**, **Apple** or **GitHub**. Pick the one you'll keep using for years, because it *is* your tailnet: whoever controls that account can add devices to it. Make sure it has two-factor authentication turned on.
3. Tailscale asks a couple of questions about how you'll use it; answer **personal use**.
4. When it offers to help you add your first device, you can close that page. The next step adds the NAS from the command line.

## Install Tailscale on the NAS

Tailscale goes straight onto the Pi, next to OMV, not in Docker. Installed this way it starts at boot before anything else, keeps working even if Docker is stopped, and can reach every service on the NAS. It doesn't touch OMV's own network settings; it just adds one more network interface called `tailscale0`.

SSH into the Pi from a computer at home:

```bash
ssh naz@nas.local
```

Install Tailscale with its official script. It detects Raspberry Pi OS / Debian, adds Tailscale's package repository and installs the `tailscale` package:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

{% include callout.html type="note" title="Prefer to read the script first?" text="Download it with `curl -fsSL https://tailscale.com/install.sh -o install.sh`, look through it with `nano install.sh`, then run `sh install.sh`. It only adds the repository and installs the package." %}

Now connect the NAS to your tailnet:

```bash
sudo tailscale up
```

It prints a link:

```text
To authenticate, visit:

	https://login.tailscale.com/a/1a2b3c4d5e6f
```

Open that link in a browser on any device, sign in with the account from step 1 and click **Connect**. Back on the Pi, the command finishes on its own. Check it worked:

```bash
tailscale status
tailscale ip -4
```

```text
100.64.10.20    nas    you@  linux  -
100.64.10.20
```

The first line lists the devices in your tailnet (just the NAS for now). The second is the NAS's Tailscale IP. Write it down: you'll use it as a fallback whenever a name doesn't work.

Finally, let Tailscale update itself, so you never run an old version on a machine that's always online:

```bash
sudo tailscale set --auto-update
```

{% include callout.html type="tip" title="Your NAS is called nas.local at home and nas in the tailnet" text="Tailscale names the device after the Pi's hostname, `nas`, which you chose in Raspberry Pi Imager. If you already had another device called `nas` in the tailnet, it becomes `nas-1`; rename it in the admin console (**Machines** → **⋯** → **Edit machine name**) so it matches the rest of this tutorial." %}

## Turn off key expiry for the NAS

For security, every device's Tailscale login expires after 180 days by default and you have to sign it in again. On a phone that's a tap. On a NAS sitting in a cupboard it means one day you're away from home, the NAS quietly drops out of your tailnet, and you can't reach it until you get back.

Turn expiry off for the NAS only:

1. Open the [admin console](https://login.tailscale.com/admin/machines).
2. Find **nas** in the **Machines** list and click the **⋯** menu at the end of its row.
3. Choose **Disable key expiry**.

The NAS now shows **Expiry disabled** under its name. Leave expiry on for your laptops and phones: if one is lost or stolen, its access runs out by itself (and you can remove it straight away, see step 11).

## Install Tailscale on your devices

Install the Tailscale app on every device you want to reach the NAS from and sign in with the **same account**. Each device appears in the admin console as soon as it's signed in.

**Windows:**

1. Download the installer from [tailscale.com/download](https://tailscale.com/download) and run it.
2. A Tailscale icon appears in the notification area by the clock (click **^** if it's hidden). Click it → **Log in**, and sign in in the browser window that opens.
3. When Windows asks whether to allow Tailscale through the firewall, or what kind of network it is, allow it.

**macOS:**

1. Install **Tailscale** from the Mac App Store, or the standalone version from [tailscale.com/download](https://tailscale.com/download). Either works; the App Store one updates with your other apps.
2. Open it. It lives in the menu bar at the top right. Click the icon → **Log in** and sign in.
3. macOS asks to **Allow** Tailscale to add a VPN configuration. Allow it; that's how every VPN on a Mac works.

**Linux (Ubuntu, Debian, Fedora, Mint and others):** use the same script as on the NAS, then sign in:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Open the link it prints, sign in, and you're connected. To use `tailscale` commands later without `sudo`, run `sudo tailscale set --operator=$USER` once.

**Android:**

1. Install **Tailscale** from the Google Play Store.
2. Open it, tap **Get started**, and sign in.
3. Android asks to allow a **VPN connection**. Tap **OK**. A small key icon in the status bar shows when Tailscale is on.

**iPhone and iPad:**

1. Install **Tailscale** from the App Store.
2. Open it, tap **Get started**, sign in, and **Allow** the VPN configuration when iOS asks (it'll want your passcode or Face ID).
3. Tailscale shows as **VPN** in **Settings**, where you can switch it on and off quickly.

{% include callout.html type="note" title="Only one VPN at a time on phones" text="Android and iOS allow just one VPN connection at a time. If you also use a commercial VPN app, turning it on turns Tailscale off, and the NAS becomes unreachable until you switch back. Step 10 shows how the NAS itself can protect you on public Wi-Fi instead." %}

{% include callout.html type="tip" title="Leave it on" text="Tailscale only sends tailnet traffic through the VPN. Your normal browsing, streaming and apps still go straight to the internet as before, so there's no harm in keeping it switched on all the time, and the battery cost is small." %}

## Check the NAS answers by name

Open the [admin console's **DNS** page](https://login.tailscale.com/admin/dns) and check that **MagicDNS** is enabled. It's on by default for new tailnets; if not, click **Enable MagicDNS**. On the same page you'll see your **tailnet DNS name**, something like `tail1234.ts.net`.

Now the NAS has three addresses that work from anywhere in your tailnet:

| Address | Example | When to use it |
|---|---|---|
| Short name | `nas` | Everyday use. Works on all five systems. |
| Full name | `nas.tail1234.ts.net` | When an app needs a "proper" domain name, and for HTTPS (step 6). |
| Tailscale IP | `100.64.10.20` | When a name doesn't resolve, as a sure fallback. |

Test it from a computer:

```bash
ping nas
```

(On Windows PowerShell, `ping nas` too.) Replies from a `100.` address mean the name works. Then do the real test: turn Wi-Fi **off** on your phone so it uses mobile data, and open `http://nas` in its browser. If the OMV login page appears, the NAS is reachable from outside your home.

{% include callout.html type="note" title="Why not nas.local?" text="`nas.local` uses mDNS, a way of finding devices that only works inside one local network. It never travels over the tailnet. Get into the habit of using `nas` instead; it works both at home and away, so you only ever need one address." %}

## Open the OMV dashboard from anywhere

With Tailscale on, the dashboard is simply:

```text
http://nas
```

Log in with OMV's `admin` account as usual. Everything works exactly as it does at home, because as far as the NAS is concerned, you *are* on its network.

That address uses plain `http`. Over Tailscale, that's safe: the WireGuard tunnel already encrypts everything between your device and the NAS. But browsers show a "Not secure" warning, and some password managers won't fill in a password on an `http` page. Tailscale can give the NAS a real HTTPS certificate in two commands.

**Optional: HTTPS for the dashboard.**

1. In the [admin console's **DNS** page](https://login.tailscale.com/admin/dns), scroll to **HTTPS Certificates** and click **Enable HTTPS**.
2. On the NAS, over SSH:

   ```bash
   sudo tailscale serve --bg 80
   ```

   This tells Tailscale to accept HTTPS connections on the NAS's full tailnet name and pass them to OMV's web server on port 80. `--bg` keeps it running in the background, also after a reboot.

3. Open the full name with `https`:

   ```text
   https://nas.tail1234.ts.net
   ```

   The first visit takes a few seconds while Tailscale fetches the certificate. After that it's a normal padlocked page.

Check what's being served with `tailscale serve status`, and undo it with `sudo tailscale serve --https=443 off`.

{% include callout.html type="warning" title="serve, not funnel" text="`tailscale serve` shares a service **inside your tailnet only**. Tailscale has a similar command, `tailscale funnel`, that publishes a service **to the whole internet**. Never use `funnel` for the OMV dashboard, SMB or Syncthing: it would undo exactly the protection this tutorial is about." %}

## SSH into the NAS from anywhere

SSH works the same way: swap `nas.local` for `nas`.

```bash
ssh naz@nas
```

That's from macOS, Linux or Windows PowerShell. If you set up SSH keys as in [SSH key configuration on pi]({{ '/tutorials/ssh-key-configuration-on-pi/' | relative_url }}), they work unchanged, because the NAS's SSH server doesn't care which network you arrive through. If you have a `Host` entry for the NAS in `~/.ssh/config` that says `HostName nas.local`, change it to `HostName nas` so it works both at home and away:

{% include file.html name="~/.ssh/config" %}
```text
Host nas
    HostName nas
    User naz
```

The first time you connect by the new name, SSH asks you to confirm the host key again. That's expected: it remembers keys by name, and `nas` is a new name for the same machine. Type `yes`.

From a phone, SSH apps such as **Termius** (Android and iOS) connect to host `nas` or the Tailscale IP the same way.

{% include callout.html type="note" title="What about Tailscale SSH?" text="Tailscale has its own optional SSH feature (`tailscale set --ssh`) that logs you in with your Tailscale identity instead of keys. You don't need it: the normal SSH server already works over the tailnet, and keeping it means the same keys and login work at home with or without Tailscale." %}

## Open your SMB shares from anywhere

Your shares work over the tailnet too, using `nas` instead of `nas.local`. Log in with the same NAS user name and password as at home.

**Windows:** in File Explorer's address bar, type:

```text
\\nas\media
```

To map it as a drive that works at home and away, use **Map network drive** as in the NAS tutorial, with `\\nas\media` as the folder. If you mapped `\\nas.local\media` before, disconnect that drive and map it again with the new name. If `\\nas` doesn't resolve, use the IP: `\\100.64.10.20\media`.

**macOS:** in Finder, press `Cmd+K` and connect to:

```text
smb://nas/media
```

Choose **Registered User** and let the keychain remember the password.

**Linux:** in the Files app, **Other Locations** → **Connect to Server** → `smb://nas/media`. For a permanent mount, change `//nas.local/media` to `//nas/media` in the `/etc/fstab` line from the NAS tutorial. Keep the `_netdev,x-systemd.automount` options: they make the share mount only when you first open it, so a laptop that boots without the tailnet up doesn't hang.

**iPhone and iPad:** open the **Files** app → **Browse** → the **⋯** menu at the top → **Connect to Server**, and enter:

```text
smb://nas.tail1234.ts.net
```

(iOS sometimes doesn't resolve the short name here, so use the full name or the Tailscale IP.) Choose **Registered User**, enter the NAS user name and password, and your shares appear under **Shared** in the sidebar.

**Android:** Android has no built-in SMB client, so use a file manager app that has one. **Material Files** (free and open source, on Google Play and F-Droid) works well: tap **+** → **Add storage** → **SMB server**, enter `nas` or the Tailscale IP as the **Host**, and your NAS user name and password. **CX File Explorer** has the same feature under **Network** → **Remote**.

{% include callout.html type="warning" title="Using NFS? Let the tailnet in" text="If you followed the optional NFS step in the NAS tutorial, its **Client** setting only allows your home network (for example `192.168.1.0/24`), so NFS mounts will be refused over the tailnet. In **Services → NFS → Shares**, edit each share and add a second entry for `100.64.0.0/10`, the range Tailscale addresses come from. NFS trusts the client about who you are, so only do this if every device in your tailnet is yours." %}

Expect lower speeds than at home. Over the tailnet, a copy is limited by the slower of your home **upload** speed and the network you're on. Opening documents and streaming music or video is usually fine; copying a 50 GB folder is a job for when you're back home, or for Syncthing in the background.

## Let Syncthing connect through the tailnet

If you followed the [Syncthing tutorial]({{ '/tutorials/syncthing-sync-with-openmediavault/' | relative_url }}), your devices already sync while away, through Syncthing's public relays. With Tailscale you can make them connect to the NAS **directly** through the tailnet, which is much faster and doesn't rely on anyone else's servers.

Syncthing on the NAS already listens on the Tailscale interface, because its compose file uses `network_mode: host`. It just doesn't know to *tell* other devices about its Tailscale address, so you tell them yourself. On **each device** (not on the NAS):

1. Open that device's Syncthing dashboard: `http://127.0.0.1:8384` on a computer, the Syncthing-Fork app on Android, Möbius Sync on iPhone.
2. Under **Remote Devices**, click the NAS → **Edit** → **Advanced**.
3. Change **Addresses** from `dynamic` to:

   ```text
   tcp://nas:22000, quic://nas:22000, dynamic
   ```

   Syncthing tries the tailnet first, and `dynamic` keeps the normal discovery as a fallback for when Tailscale is off. If the device doesn't resolve the short name, use the Tailscale IP instead: `tcp://100.64.10.20:22000, quic://100.64.10.20:22000, dynamic`.
4. Click **Save**.

Within a minute the NAS shows as **Connected** with an address starting `100.` instead of **relay://**. You can also open the NAS's own Syncthing dashboard from anywhere at `http://nas:8384`.

{% include callout.html type="tip" title="Keep sync inside your own network" text="Once every device reaches the NAS over Tailscale, you can switch off the public parts of Syncthing on the NAS: **Actions → Settings → Connections**, untick **Global Discovery**, **Enable Relaying** and **Enable NAT traversal**. Syncthing then only talks over your home network and the tailnet. Do this only after every device has the addresses above, or the ones you missed will stop syncing while away." %}

{% include callout.html type="note" title="Syncthing-Fork run conditions" text="Syncthing-Fork on Android can be set to run only on Wi-Fi, or only on certain Wi-Fi networks (**Settings → Run conditions**). If you want phone photos to reach the NAS over mobile data, allow mobile data there. Tailscale works on both." %}

## Reach the rest of your home network (optional)

So far only the NAS is in the tailnet. Tailscale can do two more useful things, with the NAS doing the work for the whole house:

- **Subnet router:** reach *other* devices at home that can't run Tailscale, such as your router's admin page, a printer or a smart TV, by their normal `192.168.1.x` addresses.
- **Exit node:** send *all* your phone's or laptop's internet traffic home through the NAS. On untrusted café or hotel Wi-Fi, nobody nearby can see or tamper with your traffic, and websites see you as being at home.

Both need the Pi to pass traffic along, which Linux doesn't do by default. Over SSH on the NAS:

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

Then advertise both features. Use your own home network's range, which you saw when you looked up the Pi's address in the NAS tutorial (`192.168.1.50/24` means `192.168.1.0/24`):

```bash
sudo tailscale set --advertise-routes=192.168.1.0/24 --advertise-exit-node
```

Tailscale won't turn these on until you approve them, so that a device can't quietly make itself a router:

1. In the [admin console](https://login.tailscale.com/admin/machines), the NAS now shows a **Subnets** badge. Click **⋯** → **Edit route settings**.
2. Tick the `192.168.1.0/24` route and **Use as exit node**, then **Save**.

**Using the subnet router:** Windows, macOS, Android and iOS pick up the route automatically. On a Linux computer, run `sudo tailscale set --accept-routes` once. Then, away from home, `http://192.168.1.1` opens your router's admin page as if you were in the living room.

**Using the exit node:** it's off until you choose it, per device:

- **Windows / macOS:** Tailscale icon → **Exit node** → **nas**.
- **Android / iOS:** in the Tailscale app, tap **Exit node** → **nas**.
- **Linux:** `sudo tailscale set --exit-node=nas` (and `--exit-node=` with nothing after it to stop).

Turn it off again when you're on a network you trust. All your browsing now goes through your home internet connection's upload speed and the Pi, so it's slower than going direct.

{% include callout.html type="warning" title="When home and away use the same addresses" text="Many routers use `192.168.1.x` or `192.168.0.x`. If the network you're visiting uses the same range as home, your device can't tell which `192.168.1.1` you mean, and local things on the visited network may stop working. The NAS itself is always fine, because you reach it by its `100.` address and `nas` name, not by its home address. If it bothers you, change your home router to a less common range such as `192.168.77.0/24`." %}

## Keep your tailnet safe

Your tailnet is now a door into your home. A few habits keep it shut to everyone but you.

**Protect the account.** Whoever can sign in to the Google, Microsoft, Apple or GitHub account you used can add their own device to your tailnet. Keep two-factor authentication on it.

**Remove devices you no longer use.** In the [admin console](https://login.tailscale.com/admin/machines), click **⋯** → **Remove** on an old laptop or a sold phone. If a device is lost or stolen, remove it **straight away**: it's cut off from the NAS at once.

**Turn on device approval (recommended).** In the admin console under **Settings → Device management**, enable **Device approval**. New devices then can't reach anything until you click **Approve** for them, even if someone gets hold of your login.

**Keep the NAS's own passwords strong.** Tailscale decides who can *reach* the NAS. OMV's `admin` password, your SSH keys and your share passwords still decide who can *use* it. Don't relax any of them because "it's only on the VPN".

**Keep everything updated.** The NAS updates Tailscale itself (step 2). Your computers and phones update through their app stores or with Tailscale's own updater. In the admin console, a device running an old version shows an **Update available** badge.

**Don't open router ports.** If you forwarded any ports to the NAS before reading this, remove those rules from your router now. You don't need them any more.

## Troubleshooting
{: .no-step}

- **`nas` doesn't resolve, but the Tailscale IP works.** MagicDNS is off, or the device isn't using it. Check **MagicDNS** is enabled on the admin console's DNS page. On Linux, `tailscale status` should not warn about DNS; if it does, run `sudo tailscale set --accept-dns=true`. As a quick fix, use the full name (`nas.tail1234.ts.net`) or the IP.
- **Nothing on the NAS answers over Tailscale.** On the NAS, run `tailscale status`. If it says `Logged out` or `NeedsLogin`, run `sudo tailscale up` and sign in again, then disable key expiry (step 3). If the `tailscaled` service isn't running, `sudo systemctl enable --now tailscaled` starts it and makes it start at boot.
- **It works at home but not on mobile data.** Make sure Tailscale is actually **on** on the phone (Android's key icon, or **VPN** in iOS Settings). Another VPN app may have switched it off.
- **Everything is slow, and `tailscale status` shows `relay "fra"` (or another city) for a device.** That connection is going through a DERP relay instead of directly. Some networks (hotels, offices, some mobile carriers) block direct connections. It still works, just slower. On the NAS, `tailscale netcheck` shows what the home network allows; enabling **UPnP** or **NAT-PMP** on your home router usually lets Tailscale make direct connections more often.
- **The OMV dashboard opens but logs me out constantly when using HTTPS.** Clear the browser's cookies for the NAS, then log in again at the `https://nas.tail1234.ts.net` address only. Mixing `http://nas` and the HTTPS address in the same browser can confuse OMV's session.
- **Windows says `\\nas\media` is not accessible.** Try the IP form `\\100.64.10.20\media`. If that works, Windows isn't using MagicDNS yet; sign out of Tailscale and back in from the tray icon. If neither works, check the share opens at home with `\\nas.local\media` first.
- **The iPhone Files app can't connect to the server.** Use the full name or the IP, not the short name, and make sure Tailscale is on. If it still fails, the Files app sometimes caches a failed connection: remove the server from **Shared** and add it again.
- **NFS mounts are refused over Tailscale but SMB works.** Add `100.64.0.0/10` to the NFS share's clients, as in step 8.
- **Syncthing still shows `relay://` for the NAS.** Check the device's **Addresses** for the NAS (step 9) are spelled exactly, with commas between them, and that Tailscale is on on that device. On a phone, check Syncthing is allowed to run on mobile data.
- **After enabling the subnet router, a Linux PC at home lost its connection to local devices.** A Linux computer at home that has `--accept-routes` on tries to reach the home network through the NAS instead of directly. Run `sudo tailscale set --accept-routes=false` on machines that are always at home.
