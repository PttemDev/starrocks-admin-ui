# Contributing to StarRocks Admin UI

Thanks for helping out. Bug reports, fixes and new features are welcome.

## Setup

The UI needs the backend from [starrocks-api](https://github.com/PttemDev/starrocks-api). Follow the **Quick start** in the [README](README.md) to run both.

```bash
npm ci
npm run dev        # http://localhost:5173, proxies /api to the backend
```

## Before you open a pull request

```bash
npm run build      # tsc && vite build
npm audit          # please do not add new high or critical advisories
```

- The project has no automated tests or lint configuration yet. Adding them is a welcome contribution.
- Keep changes focused. One pull request per fix or feature makes review faster.
- Never commit secrets, tokens, `.env` files or internal hostnames. Use placeholders such as `example.com` in code, docs and screenshots, and demo data in screenshots.

## Pull request flow

1. Fork the repository and create a branch from `master`.
2. Make your change and run the checks above.
3. Open a pull request that explains what changed and why. Link the issue if there is one.

## Reporting bugs and security issues

Open an issue for bugs and feature requests. Please report security problems privately, as described in [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
