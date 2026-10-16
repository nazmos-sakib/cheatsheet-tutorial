# syntax=docker/dockerfile:1

# ---------- Stage 1: build the site with Jekyll ----------
# The full ruby image already has the compilers some gems need.
# It's big, but only this stage uses it: the final image is just nginx.
FROM ruby:3.3 AS build

WORKDIR /src

# Install gems first, so this slow layer is reused when only content changes
COPY Gemfile ./
RUN bundle install

# Now the rest of the site
COPY . .

# The address people open this copy of the site at. Set SITE_URL in .env.
ARG SITE_URL=http://localhost:8080
ENV JEKYLL_ENV=production

# Serve from the root of the domain (baseurl ""), not /cheatsheet-tutorial
RUN printf 'url: "%s"\nbaseurl: ""\n' "$SITE_URL" > /tmp/_config.docker.yml \
 && bundle exec jekyll build --config _config.yml,/tmp/_config.docker.yml --destination /site

# ---------- Stage 2: serve the finished files with nginx ----------
FROM nginx:stable-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html

EXPOSE 80
