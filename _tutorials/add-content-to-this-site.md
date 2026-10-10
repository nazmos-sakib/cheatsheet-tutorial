---
title: How to add a tutorial or cheatsheet to this site
description: The first tutorial on this site is about writing the next one. Every page here is a Markdown file; this is how to make one.
tags: [jekyll, git, meta]
tested_on: "Jekyll 3.10 via GitHub Pages"
time: "15 minutes"
updated: 2026-10-10
---

Every tutorial and cheatsheet on this site is a plain text file in the GitHub repository. You write Markdown, push it, and GitHub Pages turns it into a page with the layout, search, copy buttons and table of contents already in place. You never touch HTML.

This page is itself one of those files: `_tutorials/add-content-to-this-site.md`. Open it next to this page and compare the two whenever something is unclear.

## Find your way around the repository

Only a few folders matter for writing content. The rest is the theme, which you can leave alone.

{% include file.html name="Repository layout" %}

```text
_tutorials/              ← one .md file per tutorial
_cheatsheets/            ← one .md file per cheatsheet (title, tags, intro)
_data/cheatsheets/       ← the commands for each cheatsheet, as .yml
_data/profile.yml        ← everything on the About page
templates/               ← copy-paste starting points (not published)
_config.yml              ← site title, URL and settings

_layouts/  _includes/  assets/   ← the theme (HTML, CSS, JS)
```

The file name becomes the address. `_tutorials/parse-server-docker.md` is published at `/tutorials/parse-server-docker/`. Use lowercase words separated by hyphens.

## Preview the site on your computer

You can skip this and edit straight on github.com, but a local preview lets you see a page before anyone else does. You need Ruby and Bundler installed once (on macOS: `brew install ruby`, then follow the PATH hint it prints).

In the repository folder, install the gems the first time:

{% include cmd.html sheet="site-maintenance" id="bundle-install" %}

Then start the preview server:

{% include cmd.html sheet="site-maintenance" id="serve" %}

Open the address it prints. Leave it running while you write: every time you save a file, the site rebuilds and you just reload the browser.

{% include callout.html type="tip" text="The two commands above are not typed into this page. They are pulled from the **Site maintenance** cheatsheet, so if a command changes, you fix it in one place. Step 6 shows how." %}

## Create the tutorial file

Copy `templates/tutorial.md` into `_tutorials/` and rename it, for example `_tutorials/parse-server-docker.md`. The block between the two `---` lines at the top is the front matter. It describes the page:

{% include file.html name="_tutorials/parse-server-docker.md" %}

```yaml
---
title: Self-hosting Parse Server with Docker
description: Parse Server and MongoDB on a home server, with the dashboard behind a password.
tags: [docker, backend, parse]
tested_on: "Ubuntu 24.04, Docker 27.3"
time: "45 minutes"
updated: 2026-10-12
---
```

| Field | What it does |
|---|---|
| `title` | Page heading and the name in lists and search. Required. |
| `description` | One sentence shown under the title and in lists. |
| `tags` | Used by the tag filter on the Tutorials page. Reuse existing tags where you can. |
| `tested_on` | Versions you actually used. Future you will want this when a command stops working. |
| `time` | Rough time needed. Optional. |
| `updated` | Date in `YYYY-MM-DD`. Lists are sorted by it, newest first. |

Leave out any optional field you don't need; the page simply won't show it.

## Write the steps

Below the front matter, write normal Markdown. Each `##` heading becomes a **numbered step** with its own entry in the "On this page" list, so you never number anything by hand.

{% include file.html name="_tutorials/parse-server-docker.md" %}

```markdown
A short intro paragraph: what we're building and why.

## Install Docker

Explain the step, then show the command.

### Check the installation

A `###` heading is a sub-step. It shows up indented in the contents list.

## Write the compose file
```

If you want a `##` heading that is not a step, such as "Troubleshooting" at the end, add `{: .no-step}` on the line right after it:

```markdown
## Troubleshooting
{: .no-step}
```

## Add code, files and notes

**Code blocks** use three backticks and the language name. Every code block gets a copy button automatically.

````markdown
```bash
docker compose up -d
```
````

**File names.** When a code block is the content of a file, put a label on the line directly above it so readers know where it goes:

{% include file.html name="_tutorials/parse-server-docker.md" %}

````liquid
{% raw %}{% include file.html name="docker-compose.yml" %}

```yaml
services:
  mongo:
    image: mongo:7
```{% endraw %}
````

That renders like this:

{% include file.html name="docker-compose.yml" %}

```yaml
services:
  mongo:
    image: mongo:7
```

**Notes, tips and warnings** go in a callout. The `type` can be `note`, `tip` or `warning`, and `title` is optional:

```liquid
{% raw %}{% include callout.html type="warning" title="Back up first" text="This removes the database volume." %}{% endraw %}
```

{% include callout.html type="warning" title="Back up first" text="This removes the database volume." %}

**Images** go in `assets/img/`. Reference them with `relative_url` so the link works under the repository's sub-path:

```liquid
{% raw %}![Parse dashboard login]({{ '/assets/img/parse-dashboard.png' | relative_url }}){% endraw %}
```

## Reuse a command from a cheatsheet

If a command already lives in a cheatsheet, include it instead of copying it. Give the cheatsheet's file name and the command's `id`:

```liquid
{% raw %}{% include cmd.html sheet="site-maintenance" id="push" %}{% endraw %}
```

{% include cmd.html sheet="site-maintenance" id="push" %}

The command, its description and a link back to the cheatsheet all come from `_data/cheatsheets/site-maintenance.yml`.

## Add a cheatsheet

A cheatsheet is two files: the commands as data, and a short page that points to them.

**1. The commands.** Copy `templates/cheatsheet.yml` to `_data/cheatsheets/gradlew.yml` and fill it in. Sections become headings; each command becomes a row with a copy button.

{% include file.html name="_data/cheatsheets/gradlew.yml" %}

```yaml
sections:
  - name: Build
    commands:
      - id: assemble-debug
        cmd: ./gradlew assembleDebug
        desc: Build a debug APK into `app/build/outputs/apk/debug/`.
      - id: clean
        cmd: ./gradlew clean
        desc: Delete the `build/` folders so the next build starts fresh.

  - name: Test
    commands:
      - id: unit-tests
        cmd: ./gradlew test
        desc: Run the local unit tests for every module.
```

Indentation matters in YAML: use spaces, never tabs. If a command contains a colon followed by a space, or starts with a special character, wrap it in single quotes.

**2. The page.** Copy `templates/cheatsheet.md` to `_cheatsheets/gradlew.md`. The `sheet` field must match the `.yml` file name:

{% include file.html name="_cheatsheets/gradlew.md" %}

```yaml
---
title: Gradle wrapper
description: The ./gradlew tasks I use for Android builds.
sheet: gradlew
tags: [android, gradle]
updated: 2026-10-12
---

Optional intro text in Markdown goes here.
```

The cheatsheet page gets a filter box, and every command is added to the site search.

## Publish it

Check what changed, commit, and push:

{% include cmd.html sheet="site-maintenance" id="status" %}

{% include cmd.html sheet="site-maintenance" id="add-all" %}

{% include cmd.html sheet="site-maintenance" id="commit" %}

{% include cmd.html sheet="site-maintenance" id="push" %}

GitHub Pages rebuilds the site after every push. Open the repository's **Actions** tab to watch the "pages build and deployment" run; when it turns green, the new page is live.

{% include callout.html type="note" title="If the build fails" text="The Actions run shows the file and line that broke it. Usually it is YAML indentation or a missing `---` around the front matter. Fix it, commit and push again." %}

## Quick checklist
{: .no-step}

- File is in `_tutorials/` or `_cheatsheets/`, named in lowercase with hyphens.
- Front matter has at least `title`, and is wrapped in `---` lines.
- For a cheatsheet, `sheet:` matches the file name in `_data/cheatsheets/`.
- Images and internal links use `relative_url`.
- Previewed locally, or checked on the live site after the Actions run finished.
