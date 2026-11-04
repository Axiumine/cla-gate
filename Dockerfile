# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Giovanni Manzoni
#
# E19-S01. One image serves the API and the built single-page app from one origin, and runs the migrations with another
# command (`node dist/server/migrate.js`). It is built from the checkout by `docker compose up --build`; nothing is ever
# pushed, and no registry, release workflow, SBOM or attestation exists (scripts/docker/no-publication.test.ts).
#
# NODE_VERSION must equal .nvmrc (scripts/docker/dockerfile.test.ts fails when they differ). The digest pins the multi-arch
# index of that exact tag; to refresh it after a Node bump: docker buildx imagetools inspect node:<version>-trixie-slim
ARG NODE_VERSION=26.13.0

FROM node:${NODE_VERSION}-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS base
WORKDIR /app

# Dependencies: the layers below depend on package.json, yarn.lock and .yarnrc.yml and on nothing else, so a source change
# does not reinstall packages. A Docker build context has no .git, so the lefthook postinstall has nothing to install.
FROM base AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@0.36.0 && corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable --mode=skip-build

# The single-page app (dist/web) and the server (dist/server).
FROM deps AS build
COPY . .
RUN yarn build

# Production dependencies only, from the same lockfile. `yarn workspaces focus` has no skip-build mode and runs the root
# `postinstall` (the lefthook installer, whose scripts are not in this stage), so that one script is dropped from the copy
# of package.json in this stage; the runtime stage takes package.json from the build stage, untouched.
FROM deps AS prod-deps
RUN npm pkg delete scripts.postinstall && yarn workspaces focus --all --production

# The final stage starts from the bare Node image again: no Yarn, no Corepack, no dev dependencies, no sources.
FROM base AS runtime
ARG SOURCE_COMMIT=unknown
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SOURCE_COMMIT=${SOURCE_COMMIT}
LABEL org.opencontainers.image.title="cla-gate" \
      org.opencontainers.image.source="https://github.com/Axiumine/cla-gate" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json /app/LICENSE ./
# Numeric, so that an orchestrator can verify that it is not root. The tree above belongs to root and this user cannot
# write to it; the server writes nothing outside /tmp, so the root filesystem can be read-only.
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 CMD ["node", "dist/server/healthcheck.js"]
CMD ["node", "dist/server/main.js"]
