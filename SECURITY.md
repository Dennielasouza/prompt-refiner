# Security policy

Prompt Refiner runs locally: the backend listens on `127.0.0.1`, your API key stays in `backend/.env` on your machine, and prompt text is never logged.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's **"Report a vulnerability"** button (Security tab → Advisories) to report privately. Include steps to reproduce and the impact you see. You'll get an answer as soon as possible.

Things we especially want to hear about: ways another website or extension could call the local backend, any path where prompt text or the API key could be logged or leaked, and content-script issues in pages the extension touches.
