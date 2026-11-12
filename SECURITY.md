# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. Include the affected version or commit, steps to reproduce, and the impact you observed.

We will acknowledge your report and keep you updated as we investigate and fix the issue.

## Known limitations

`npm audit` currently reports no critical or high severity advisories. Two moderate advisories remain in `react-router-dom` 6.x, where the fix requires a major upgrade to 7.x. Run `npm audit` for the current list.

## Deployment notes

- The UI stores the session token in the browser's `localStorage`. Any cross-site scripting bug could expose it, so serve the UI only from an origin you control and keep dependencies up to date.
- Serve the UI and the backend over HTTPS. Bearer tokens are sent on every request.
- `VITE_*` variables are embedded in the public JavaScript bundle. Never put secrets in them.
- The nginx config in this repository proxies `/api/` to the backend and sets no security headers. Add headers such as `Content-Security-Policy` and `X-Content-Type-Options` in your own deployment.
- The backend ([starrocks-api](https://github.com/PttemDev/starrocks-api)) enforces roles and `read_only` environments. Read its [SECURITY.md](https://github.com/PttemDev/starrocks-api/blob/master/SECURITY.md) before you expose either component.
