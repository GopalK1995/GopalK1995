# Contrast table (WCAG 2.x, 12 px text needs 4.5:1)

Computed from `src/styles/tokens.css` at `--brand-h` 245 by `src/components/ui/contrast.ts`; asserted in `src/components/ui/__tests__/contrast.test.ts`. "n/a" means the token is not used on that background.

| Text token | on --paper | on --surface | on --navy-900 |
|---|---|---|---|
| `--ink` | 16.82 | 17.82 | (1.05 n/a) |
| `--ink-2` | 7.85 | 8.32 | (2.05 n/a) |
| `--ink-3` | 5.11 | 5.42 | (3.14 n/a) |
| `--accent` | 5.00 | 5.30 | (3.21 n/a) |
| `--accent-strong` | 6.40 | 6.78 | (2.51 n/a) |
| `--success` | 5.96 | 6.32 | (2.70 n/a) |
| `--warn-ink` | 6.27 | 6.64 | (2.56 n/a) |
| `--danger` | 6.16 | 6.53 | (2.61 n/a) |
| `--info` | 5.33 | 5.65 | (3.02 n/a) |
| `--navy-ink` | (1.04 n/a) | (1.11 n/a) | 15.40 |
| `--navy-ink-2` | (1.99 n/a) | (2.11 n/a) | 8.08 |
| `--navy-ink-3` | (2.77 n/a) | (2.94 n/a) | 5.80 |
| `--accent-on-navy` | (2.12 n/a) | (2.25 n/a) | 7.57 |

State text on its own 12% fill over --surface:

| Token | ratio |
|---|---|
| `--success` | 5.27 |
| `--warn-ink` | 5.55 |
| `--danger` | 5.32 |
| `--info` | 4.75 |
