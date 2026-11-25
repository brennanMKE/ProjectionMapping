# Display hostnames

The Holiday Lights setup uses two Raspberry Pi Zero 2 W displays. Each build is named after a star, and that name is the Pi's hostname.

| Display | Hostname | Notes |
| --- | --- | --- |
| Display 1 | `mizar` | Set as the hostname in Raspberry Pi Imager (Edit settings → Hostname). |
| Display 2 | `alcor` | Set as the hostname in Raspberry Pi Imager (Edit settings → Hostname). |

SSH then uses the hostnames instead of `pizero.local`, for example:

```sh
ssh <user>@mizar.local
ssh <user>@alcor.local
```

The step-by-step guide (`pi-zero-headless-guide.md`) still uses `pizero` as its example. Use `mizar` or `alcor` in its commands for each display.
