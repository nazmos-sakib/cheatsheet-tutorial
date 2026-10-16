---
title: SSH key configuration on pi
description: Log in to a Raspberry Pi with an SSH key instead of a password, then optionally switch password login off.
tags: [ssh, raspberry-pi, linux, security]
tested_on: "Raspberry Pi OS Bookworm (Debian 12), OpenSSH 9.2 on the Pi, macOS 15 as the client"
time: "20 minutes"
updated: 2026-10-11
---

Typing the Pi's password every time you connect gets old fast, and a password is the weakest way to protect a machine that is reachable over the network. With an SSH key, your computer proves who it is with a private key that never leaves it, and the Pi only stores the matching public key.

By the end of this tutorial you will log in with `ssh pi` and no password, and the Pi can refuse password logins entirely.

You need:

- A Raspberry Pi running Raspberry Pi OS, on the same network as your computer.
- The Pi's user name and password (the user you created in Raspberry Pi Imager).
- A terminal on your computer. On macOS and Linux that is Terminal; on Windows 10/11 use PowerShell, which ships with OpenSSH.

Commands are marked with where to run them: **on your computer** or **on the Pi**.

## Make sure SSH is on and you can reach the Pi

SSH has to be enabled on the Pi before anything else works. If you flashed the card with Raspberry Pi Imager and ticked **Enable SSH**, it already is. Otherwise, on the Pi itself (keyboard and screen attached):

```bash
sudo raspi-config nonint do_ssh 0
```

That is the same as **Interface Options → SSH → Yes** in the `raspi-config` menu.

Next, find the Pi's address. On the Pi:

```bash
hostname -I
```

It prints something like `192.168.1.42`. Most networks also let you use the host name with `.local` on the end, for example `raspberrypi.local`.

Now check that a normal password login works, **on your computer** (replace `pi` with your user name and the address with yours):

```bash
ssh pi@192.168.1.42
```

The first time, SSH asks you to confirm the Pi's fingerprint. Type `yes`, enter the password, and you should get a prompt on the Pi. Type `exit` to come back.

{% include callout.html type="tip" text="Give the Pi a fixed address (a DHCP reservation in your router's settings) so the IP in this tutorial doesn't change next week." %}

## Check for an existing key

You may already have a key from GitHub or another server. **On your computer**:

```bash
ls -l ~/.ssh/id_*.pub
```

If you see `id_ed25519.pub` (or `id_rsa.pub`), you already have a key pair. You can reuse it and skip to step 4, or create a separate one for the Pi in the next step.

If you get "No such file or directory", you have no key yet. Carry on.

## Generate a key pair

**On your computer**, create an Ed25519 key. It is short, fast and the current recommended type:

```bash
ssh-keygen -t ed25519 -C "your-name@your-computer"
```

The `-C` text is only a label so you can recognise the key later. SSH then asks two things:

1. **File to save the key**: press Enter to accept `~/.ssh/id_ed25519`. If you already have a key with that name and want to keep it, type a new name such as `~/.ssh/id_ed25519_pi`.
2. **Passphrase**: type one. It encrypts the private key on disk, so a stolen laptop doesn't hand over access to your Pi. The next step stops you having to type it every time.

You now have two files:

| File | What it is |
|---|---|
| `~/.ssh/id_ed25519` | The **private** key. Never copy it anywhere or share it. |
| `~/.ssh/id_ed25519.pub` | The **public** key. This is the one that goes on the Pi. |

{% include callout.html type="warning" title="Keep the private key private" text="Anyone who has the file without `.pub` can log in as you. Don't paste it into chats, commit it to a repository, or copy it to the Pi." %}

## Let your computer remember the passphrase

The SSH agent holds the unlocked key in memory so you type the passphrase once per session, not once per login.

### macOS

Add the key to the agent and save the passphrase in the macOS Keychain:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

The `~/.ssh/config` file in step 7 makes this survive a restart.

### Linux

Most desktops start an agent for you. Add the key:

```bash
ssh-add ~/.ssh/id_ed25519
```

### Windows (PowerShell)

Start the agent service once (in an **Administrator** PowerShell), then add the key in a normal one:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add $env:USERPROFILE\.ssh\id_ed25519
```

## Copy the public key to the Pi

The Pi keeps the public keys it trusts in a file called `~/.ssh/authorized_keys` in the user's home folder. `ssh-copy-id` creates that file with the right permissions and appends your key to it.

**On your computer** (macOS and Linux):

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@192.168.1.42
```

Enter the Pi's password one last time. It should end with "Number of key(s) added: 1".

### Windows, or no ssh-copy-id

Windows doesn't include `ssh-copy-id`. This does the same thing in one line from PowerShell:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh pi@192.168.1.42 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

On macOS or Linux, the same command with `cat ~/.ssh/id_ed25519.pub |` at the start works too.

{% include callout.html type="note" title="Setting up a new Pi?" text="Raspberry Pi Imager can do this step for you. In **OS customisation → Services**, choose **Allow public-key authentication only** and paste the contents of your `.pub` file. The Pi then boots with your key already installed." %}

## Test the key login

**On your computer**, connect again:

```bash
ssh pi@192.168.1.42
```

This time it should log you straight in, or ask only for the key's passphrase (not the Pi's password) if the agent doesn't have it yet.

To prove the key is really being used, and not the password, force SSH to try keys only:

```bash
ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no pi@192.168.1.42
```

If that logs you in, key authentication works. If it says `Permission denied (publickey)`, don't go any further; see Troubleshooting below.

## Add a shortcut in your SSH config

Instead of remembering the user and address, give the Pi a short name. **On your computer**, open (or create) `~/.ssh/config`:

{% include file.html name="~/.ssh/config" %}

```text
Host pi
    HostName 192.168.1.42
    User pi
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    # macOS only: load the passphrase from the Keychain
    AddKeysToAgent yes
    UseKeychain yes
```

Remove the last three lines on Linux and Windows (`UseKeychain` is macOS only). `IdentitiesOnly yes` makes SSH offer just this key, which avoids "Too many authentication failures" if you have several keys.

Now this is all you need:

```bash
ssh pi
```

The shortcut works for copying files too, for example `scp notes.txt pi:~/`.

## Turn off password login (optional)

Once keys work, you can stop the Pi accepting passwords over SSH. Bots that guess passwords then have nothing to guess. Only do this after step 6 succeeded.

{% include callout.html type="warning" title="Don't lock yourself out" text="Keep your current SSH session open the whole time you do this step. If something goes wrong, you can still fix it from that session. If you are locked out anyway, attach a keyboard and screen to the Pi and undo the change there." %}

On Raspberry Pi OS Bookworm, the main config file reads every `.conf` file in `/etc/ssh/sshd_config.d/` first, and the first value it finds for a setting wins. So put your change in its own file there instead of editing the main one. **On the Pi**:

```bash
sudo nano /etc/ssh/sshd_config.d/10-key-only.conf
```

{% include file.html name="/etc/ssh/sshd_config.d/10-key-only.conf" %}

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

Save with `Ctrl+O`, Enter, and exit with `Ctrl+X`. Check the config for mistakes before applying it:

```bash
sudo sshd -t
```

No output means it is valid. Check which values SSH will actually use:

```bash
sudo sshd -T | grep -Ei 'passwordauthentication|kbdinteractive|permitrootlogin|pubkeyauthentication'
```

You want `passwordauthentication no` and `pubkeyauthentication yes`. If password authentication still says `yes`, another file in `/etc/ssh/sshd_config.d/` is setting it first; list them with `ls /etc/ssh/sshd_config.d/` and fix that file.

Apply the change:

```bash
sudo systemctl restart ssh
```

### Confirm passwords are refused

**On your computer**, open a **new** terminal window (leave the old session open) and try a password-only login:

```bash
ssh -o PubkeyAuthentication=no pi@192.168.1.42
```

It should fail straight away with `Permission denied (publickey)`. Then check that `ssh pi` still logs you in with the key. When both are true, you can close the old session.

## Add another computer later
{: .no-step}

Each computer should have its own key pair; don't copy your private key between machines. On the new computer, repeat steps 3 to 6. If password login is already off, `ssh-copy-id` can't log in, so append the new `.pub` file's line to `~/.ssh/authorized_keys` on the Pi from a computer that already has access.

To revoke a computer, delete its line from `~/.ssh/authorized_keys` on the Pi. The comment at the end of each line (the `-C` text from step 3) tells you which key is which.

## Troubleshooting
{: .no-step}

Add `-v` to any `ssh` command to see exactly which keys it offers and why the Pi says no:

```bash
ssh -v pi
```

- **It still asks for the Pi's password.** The key wasn't accepted. Usually the permissions on the Pi are too open, and SSH ignores the file. On the Pi, run `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`, and make sure your home folder isn't writable by others (`chmod go-w ~`).
- **`Permission denied (publickey)`.** Password login is off and the key wasn't accepted. Check the key is in `~/.ssh/authorized_keys` on the right user (`cat ~/.ssh/authorized_keys` on the Pi), and that your config points at the right `IdentityFile`. If you can't get in at all, use a keyboard and screen on the Pi, or put the SD card in another computer and edit the file there.
- **`WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`** Normal after reflashing the SD card, because the Pi has new host keys. If you know you reinstalled it, remove the old entry with `ssh-keygen -R 192.168.1.42` (and `ssh-keygen -R raspberrypi.local` if you use the name), then connect again. If you didn't reinstall anything, stop and find out why.
- **`Too many authentication failures`.** SSH tried every key in your agent before the right one. Add `IdentitiesOnly yes` and an `IdentityFile` line to the host in `~/.ssh/config` (step 7).
- **`Could not resolve hostname raspberrypi.local`.** `.local` names need mDNS, which some networks or Windows setups don't support. Use the IP address from `hostname -I` instead.
- **`Connection refused` or a timeout.** SSH isn't running or the address is wrong. On the Pi, check with `sudo systemctl status ssh` and `hostname -I`.
- **It asks for the key's passphrase every time.** The agent isn't holding the key. Run the `ssh-add` command from step 4 again, and on macOS add the `AddKeysToAgent` and `UseKeychain` lines from step 7.
