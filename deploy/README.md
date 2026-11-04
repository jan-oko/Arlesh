# Running arlesh-server on a NAS

Written for a Synology DS225+ (x86-64) with Container Manager and Docker 24.0.2. The same
files work on any Docker host with Compose v2. The image is `ghcr.io/jan-oko/arlesh-server`
(linux/amd64 and linux/arm64); it serves plain HTTP on `0.0.0.0:4750` as a non-root user
(uid 10001), keeps the SQLite database in `/data`, and keeps its tokens in that database.

## Set up on Synology Container Manager

1. **Registry access.** The image is private until the ghcr package is made public. In
   Container Manager, Registry, Settings, add `ghcr.io` with a GitHub username and a personal
   access token that has `read:packages`. (Over SSH: `docker login ghcr.io`.)
2. **A folder.** In File Station create `docker/arlesh/data`. Copy `docker-compose.yml` from this
   directory to `docker/arlesh/`.
3. **Ownership.** The container runs as uid 10001, which must be able to write the folder, and
   SQLite writes beside the file as well. Over SSH:
   `sudo chown -R 10001:10001 /volume1/docker/arlesh/data`.
4. **Project.** Container Manager, Project, Create: name `arlesh`, path `/volume1/docker/arlesh`,
   use the existing `docker-compose.yml`, build and start. (Over SSH: `docker compose up -d`.)
   To use another port, set `ARLESH_PORT=...` in a `.env` file beside the compose file.
5. **Check.** `curl -i http://<nas>:4750/health` answers `401` (up; every route needs a token).
   The container shows *healthy* after about half a minute.

## Seed it with an existing database (optional)

Stop the project, copy the app's `arlesh.db` over `data/arlesh.db` (the desktop app's data
directory; close the app first, and copy `arlesh.db-wal`/`-shm` too if present), `chown` it to
10001 again, and start. On start the server opens the database for writing and applies any
migrations newer than it, so an older database is brought up to date. Keep the original: a
migrated copy no longer opens in an older app. With no file there, an empty board is created.

## The first token, or pairing

```sh
docker exec arlesh-server arlesh-server token add phone     # prints the token once
```

Paste the server URL and the token into Settings, Server. Or pair without copying a token: enter
only the URL on the new device, which shows a six-digit PIN, then

```sh
docker exec arlesh-server arlesh-server pin list
docker exec arlesh-server arlesh-server pin approve 123456 --name phone
```

`token list` and `token revoke <client>` manage them later.

## Reaching it: Tailscale

The container speaks plain HTTP; Tailscale encrypts the path between your devices and the NAS.
Install Tailscale on the NAS and on the phone or laptop, then use `http://<nas-tailnet-name>:4750`
as the server URL. Do not forward the port on your router. For an HTTPS name inside the tailnet
run on the NAS `tailscale serve --bg 4750` (or `https / http://127.0.0.1:4750`), and use the URL
it prints. The server's own `--tls-cert` and `--tls-key` flags exist but are not needed here.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARLESH_DATABASE_URL` | `sqlite:////data/arlesh.db` | The database (SQLite only) |
| `ARLESH_DATABASE_URL_FILE` | | A file holding that URL, for a Docker secret; set `ARLESH_DATABASE_URL` to an empty value beside it |
| `ARLESH_SERVER__PORT` | `4750` | The port inside the container |
| `ARLESH_SERVER__HOST` | `0.0.0.0` | The address inside the container |

## Updating

`docker compose pull && docker compose up -d`. The data folder is untouched; migrations run on
start.
