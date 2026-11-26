# Display hostnames

The Holiday Lights setup uses two Raspberry Pi Zero 2 W displays. Each build is named after a star, and that name is the Pi's hostname.

| Display | Hostname | Username | Password |
| --- | --- | --- | --- |
| Display 1 | `mizar` | `pi` | `mizar` |
| Display 2 | `alcor` | `pi` | `alcor` |

Set the hostname, username and password in Raspberry Pi Imager (Edit settings). These are simple test credentials, not meant to be secure.

SSH uses the hostname instead of `pizero.local`:

```sh
ssh pi@mizar.local
ssh pi@alcor.local
```

The step-by-step guide ([`pi_zero_headless_guide.md`](../guides/pi_zero_headless_guide.md)) still uses `pizero` and `<user>` in its examples. For these displays, use `mizar` or `alcor` as the host and `pi` as the user.
