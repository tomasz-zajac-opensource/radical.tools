# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

If you discover a security vulnerability, please report it via one of these channels:

- **GitHub Private Vulnerability Reporting** — use the [Security tab](https://github.com/tomasz-zajac-opensource/radical.tools/security/advisories/new) on this repository
- **Email** — contact the maintainer directly (see the GitHub profile)

Please include the following in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

We will acknowledge receipt within **72 hours** and aim to provide a fix or mitigation within **14 days** depending on severity.

## Scope

This policy covers the `radical.tools` desktop application and its source code. It does not cover third-party services (OpenAI, Anthropic, Gemini, etc.) connected via the AI assistant feature — report issues with those directly to their respective vendors.

## AI API Keys

The app stores AI provider API keys in Electron's local storage. **Never share your `localStorage` data or Electron app data directory.** Keys are never transmitted to any server other than the configured AI provider endpoint.
