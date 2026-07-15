# Contributing to GPT Delagger

Thanks for helping keep long ChatGPT conversations responsive.

## Before opening a change

- Search existing issues first.
- Keep changes focused; the extension deliberately has no runtime dependencies or build step.
- For selector or detector changes, include a minimal fixture in `test/mock.html` that reproduces the relevant DOM shape without private conversation content.
- Never include real prompts, account data, session tokens, or copied private conversations in an issue or fixture.

## Local workflow

1. Fork and clone the repository.
2. Load the repository folder through `chrome://extensions` → **Load unpacked**.
3. Run the regression checks:

   ```bash
   node test/logic-smoke.mjs
   ```

4. Open `test/mock.html` for an offline visual check.
5. If testing against ChatGPT, verify that normal prose, completed images, and the most recent configured turns remain intact.

## Pull requests

Explain the behavior you observed, the smallest DOM marker that reliably identifies it, and how you checked for false positives. Screenshots are helpful, but remove personal data first.

By contributing, you agree that your contribution is licensed under the MIT License.
