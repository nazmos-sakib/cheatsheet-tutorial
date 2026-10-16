---
title: Install npm packages with Docker
description: Set up a Node.js project and install its packages inside a throwaway container, so you don't need Node installed on your machine.
tags: [docker, node, npm, parse-server]
tested_on: "Docker Engine on Linux, node:24-bookworm-slim image"
time: "10 minutes"
updated: 2026-10-14
---

This one command creates a new Node.js project in a local `parse` folder and installs Parse Server, Express 5 and the Parse file storage adapter. npm runs inside a temporary Docker container, but every file it creates lands in your own folder, owned by you.

{% include cmd.html sheet="docker-compose" id="run-npm-install" %}

You need Docker installed, and a `parse` folder in the directory you run the command from:

```bash
mkdir -p parse
```

## The four parts at a glance

1. **Start a Docker container.** `sudo docker run ... node:24-bookworm-slim` starts a container with Node.js 24 on Debian Bookworm Slim.
2. **Connect your local folder.** `--mount ...` and `--workdir /app` make your local `parse` directory available inside the container.
3. **Initialize the project.** `npm init -y` creates a default `package.json` file.
4. **Install packages.** `npm install --save-exact ...` installs Parse Server, Express 5 and the Parse file storage adapter.

## What each Docker option does

### `docker run --rm`

- `docker run` creates and starts a new container from an image.
- `--rm` automatically removes the container when the command finishes.

{% include callout.html type="note" text="`--rm` removes the container, not the files in your mounted project directory. The installed packages and generated files remain in `parse` on your host machine." %}

### `--user "$(id -u):$(id -g)"`

This tells Docker to run the command as your current user's numeric user ID (UID) and group ID (GID).

The expression `"$(id -u):$(id -g)"` is evaluated by your host shell before Docker starts. For example, if your UID is `1000` and your GID is `1000`, Docker effectively receives:

```bash
--user 1000:1000
```

Why does this matter? Without this option, commands running inside a container might create files owned by `root` on your host machine. That can cause permission problems when editing or deleting those files later. With this option, files created by npm will generally be owned by your host user.

### `--env HOME=/tmp`

Sets the `HOME` environment variable inside the container to `/tmp`.

Many command-line programs, npm included, use `$HOME` to decide where to store configuration files, caches and user-specific settings. Here, this avoids relying on the container user's normal home directory, which might not exist or be writable when using a custom numeric UID.

This only sets the variable inside the container; it does not change your host machine's home directory.

### `--mount "type=bind,source=$PWD/parse,target=/app"`

This is one of the most important parts. It mounts a directory from your computer into the container.

| Option              | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `type=bind`         | Mount an existing host directory.                  |
| `source=$PWD/parse` | The local directory to mount.                      |
| `target=/app`       | Where that directory appears inside the container. |

### `--workdir /app`

Makes `/app` (your mounted `parse` folder) the directory the command runs in, so npm writes its files there.

### `sh -c '...'`

This tells the container to execute a shell command.

- `sh` starts a shell.
- `-c` tells that shell to execute the string that follows.
- The single quotes group the two npm commands into one string.

The shell runs:

```bash
npm init -y && npm install --save-exact parse-server@latest express@5 @parse/fs-files-adapter@latest
```

The `&&` means run the second command only if the first command succeeds.

The single quotes also ensure that this entire command string is passed to the shell inside the container rather than being executed by your host shell.

## What the npm commands do

### `npm init -y`

Initializes a new npm project. It creates a file called `package.json` containing default project metadata. The `-y` flag automatically accepts the default answers instead of asking you a series of questions.

### `npm install --save-exact ...`

Installs three npm packages and records them as dependencies in `package.json`:

- `parse-server@latest`: the Parse Server backend.
- `express@5`: the web framework Parse Server runs inside.
- `@parse/fs-files-adapter@latest`: stores uploaded files on the local file system.

`--save-exact` records the exact installed versions (for example `8.2.1` instead of `^8.2.1`), so later installs don't silently pick up newer versions.

## What files you have afterwards

Assuming the installation succeeds, your local directory looks roughly like this:

```text
your-current-directory/
└── parse/
    ├── node_modules/
    │   ├── parse-server/
    │   ├── express/
    │   └── ...
    ├── package.json
    └── package-lock.json
```

The exact contents of `node_modules` depend on the packages and their transitive dependencies. Notice that the project files live on your host machine, even though npm ran inside Docker.

## What happens when the command finishes

1. Docker starts the Node.js container.
2. The container uses `/app` as its working directory, backed by your local `parse` folder.
3. npm creates `package.json` and installs the requested packages.
4. The shell exits after the installation finishes.
5. Docker removes the temporary container because of `--rm`.
6. Your local files remain available for editing or use in a later container.

{% include callout.html type="tip" text="This command does not start Parse Server. It only prepares the project and installs its dependencies." %}

## Troubleshooting
{: .no-step}

- `bind source path does not exist`: unlike `-v`, `--mount` won't create the folder for you. Run `mkdir -p parse` first.
- Files still owned by `root`: check that `--user "$(id -u):$(id -g)"` is in the command and that you didn't run it from a root shell.
