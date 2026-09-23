FROM node:lts-alpine

# Fonts for server-side SVG-to-PNG rendering of the stats OG image.
# Without these, resvg silently drops all text from the rendered card.
RUN apk add --no-cache font-dejavu

COPY app /notesx/app
COPY db /notesx/db
COPY userfiles /notesx/userfiles

WORKDIR /notesx/app

RUN npm install --omit=dev

ARG PACKAGE_VERSION
ENV APP_VERSION=${PACKAGE_VERSION}
ENV NODE_ENV=production

# libuv runs async filesystem calls on a pool of 4 threads by default. A
# bigger pool keeps the rest of the server responsive while those calls wait.
ENV UV_THREADPOOL_SIZE=16

# Build without type checking, as we have removed the Typescript
# dev-dependencies above to save space in the final build.
# Type checking is done in the repo before building the image.
RUN npx tsc --noCheck

CMD ["node", "dist/index.js" ]
