# Security policy

## Reporting a vulnerability
Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository, and include what you found, how to reproduce it and what you think the impact is. You will get a reply within a few days.

## What Warden protects
- The control panel is reachable from the same computer only (`127.0.0.1`), validates the `Host` and `Origin` of every request, and needs a one-time link or your password.
- The Discord bot token stays in `.env` and is never returned by any panel endpoint.
- Everything runs and is stored locally; nothing is sent anywhere unless you press Send in the feedback dialog.

## What is your job as the host
- Keep `.env` private and never commit it. If a token leaks, reset it in the Discord Developer Portal and run `warden --token`.
- Do not expose the panel to the internet without an authenticated reverse proxy or SSH tunnel.
- Keep Node.js and dependencies up to date (`npm audit`).
