---
title: Docker and Docker Compose
description: Everyday Docker commands, Docker Compose commands and compose-file snippets, each with a one-line reminder.
sheet: docker
tags: [docker, compose]
updated: 2026-10-16
---

The Docker and Docker Compose commands I use most, plus `compose.yaml` snippets. Words in CAPS like `CONTAINER`, `IMAGE` or `SERVICE` are placeholders for your own values. On Linux, put `sudo` in front of each command unless your user is in the `docker` group.

## Docker vs Docker Compose

- **Docker** (`docker ...`) works with one container or image at a time, and you pass every option on the command line. It sees every container on the machine.
- **Docker Compose** (`docker compose ...`) runs a whole app of several containers described in a `compose.yaml` file, and starts, stops and rebuilds them together. Run it in the folder with the `compose.yaml`; it only sees that project's containers.

Compose is built on Docker, so the plain `docker` commands work on Compose containers too. These use Compose v2 (`docker compose`, with a space); on older installs, type `docker-compose` instead.
