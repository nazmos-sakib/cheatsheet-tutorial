# Nazmos's Workbench

Tutorials from my projects and cheatsheets for the commands I use most.
Built with Jekyll and published with GitHub Pages.

## Publish it (one time)

1. Create a new GitHub repository, e.g. `cheatsheet-tutorial`, and push this folder to it.
2. In `_config.yml`, set:
   - `url` to `https://YOUR-USERNAME.github.io`
   - `baseurl` to `/` + the repository name, e.g. `/cheatsheet-tutorial`
   - `repository_url` to the repo's GitHub address (optional, enables "Edit on GitHub" links)
3. On GitHub: **Settings → Pages → Build and deployment**. Source: **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
4. After about a minute the site is live at `https://YOUR-USERNAME.github.io/cheatsheet-tutorial/`.

## Add content

The full walkthrough is the first tutorial on the site:
`_tutorials/add-content-to-this-site.md`.

Short version:

| To add… | Create |
|---|---|
| A tutorial | `_tutorials/my-topic.md` (copy `templates/tutorial.md`) |
| A cheatsheet | `_data/cheatsheets/tool.yml` + `_cheatsheets/tool.md` (copy from `templates/`) |
| About page changes | edit `_data/profile.yml` |

## Preview locally

```bash
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000/cheatsheet-tutorial/ (use your own `baseurl`).

## Where things live

```
_tutorials/            tutorials (Markdown)
_cheatsheets/          cheatsheet pages (Markdown front matter + intro)
_data/cheatsheets/     cheatsheet commands (YAML)
_data/profile.yml      About page content
_layouts/, _includes/  page templates and reusable blocks
assets/css/main.css    all styles; colours are variables at the top
assets/js/             copy buttons, contents list, filters, search, theme
templates/             starting files to copy (not published)
```
