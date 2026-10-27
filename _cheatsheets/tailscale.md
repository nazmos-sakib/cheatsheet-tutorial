---
title: Tailscale
description: Tailscale CLI commands for connecting, status, SSH, exit nodes, subnet routes, DNS, Taildrop, Serve and Funnel, each with a one-line reminder.
sheet: tailscale
tags: [tailscale, networking, vpn]
updated: 2026-10-21
---

The `tailscale` commands I use most on my Pi, NAS and laptops. Words in CAPS like `DEVICE`, `PORT`, `FILE` or `TAILNET` are placeholders for your own values; `DEVICE` is a machine name from `tailscale status`, and `TAILNET` is your tailnet's DNS name, such as `tail1234.ts.net` (see the [DNS page](https://login.tailscale.com/admin/dns) of the admin console).

On Linux, most commands that change something need `sudo`. Run `sudo tailscale set --operator=$USER` once and your user can run them without it. On Windows and macOS, the `tailscale` command comes with the app; on a Mac, use the app's **Settings → Install CLI** if `tailscale` isn't found.

New to Tailscale? [Reach your Raspberry Pi NAS from anywhere with Tailscale]({{ '/tutorials/tailscale-remote-access-openmediavault/' | relative_url }}) walks through the setup, and [Receive Taildrop files automatically on a Linux server]({{ '/tutorials/taildrop-auto-receive-on-linux/' | relative_url }}) turns `tailscale file get --loop` into a service.

## `tailscale up` vs `tailscale set`

- **`tailscale up`** connects the device and sets its options in one go. It expects you to repeat every non-default option you used before; leave one out and it refuses and prints the full command it wants.
- **`tailscale set`** changes only the options you name and leaves the rest alone. Use it for any change after the first `up`.
