# Security policy

## Supported version

Security fixes are applied to the latest release.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose conversation data, broaden site access, execute untrusted code, or bypass Chrome extension security boundaries.

Use GitHub's private vulnerability reporting for this repository. Include:

- the affected version;
- clear reproduction steps;
- the impact you observed;
- any suggested mitigation;
- whether the report contains sensitive data.

You should receive an acknowledgement within seven days. Please allow time for a fix before public disclosure.

## Security model

GPT Delagger:

- requests only Chrome's `storage` permission;
- runs only on `chatgpt.com` and the legacy `chat.openai.com` host;
- performs no network requests;
- loads no remote code and has no third-party dependencies;
- stores only extension settings and user-authored CSS selectors.
