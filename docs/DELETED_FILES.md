# DELETED_FILES.md

Files removed during the repository reorganization on the `reorganize/structure`
branch. These files were either dead code (not referenced anywhere in the UI),
duplicates of files that were moved to `src/`, or build artifacts.

If you need to recover any of these files, check the Git history:
```bash
git log --all --full-history -- <filename>
git show <commit-sha>:<filename>
```

---

## Deleted files

| File | Reason for deletion |
|------|---------------------|
| `app.js` (root) | Old stub/draft from an earlier prototype. **Not referenced** by `index.html` or any other file. The active UI controller is `src/ui/app.js` (moved from `js/app.js`). |
| `settings.js` (root) | Used ES-module `export` syntax, which is incompatible with the browser IIFE pattern used by every other file. **Not referenced** by `index.html` or any other file. Replaced by the settings-read/write logic already present in `src/integrations/lc-framework.js` via `localStorage`. |
| `css/app.css` | **Moved** to `src/ui/css/app.css`. The original path is no longer referenced. |
| `js/lib/candle-utils.js` | **Moved** to `src/functions/candle-utils.js`. |
| `js/util-indicators.js` | **Moved** to `src/functions/util-indicators.js`. |
| `js/util-format.js` | **Moved** to `src/functions/util-format.js`. |
| `js/util-backtest.js` | **Moved** to `src/functions/util-backtest.js`. |
| `js/util-export.js` | **Moved** to `src/functions/util-export.js`. |
| `js/strategy-registry.js` | **Moved** to `src/strategies/strategy-registry.js`. |
| `js/engine-autotrader.js` | **Moved** to `src/strategies/engine-autotrader.js`. |
| `js/engine-strength.js` | **Moved** to `src/strategies/engine-strength.js`. |
| `js/lc-framework.js` | **Moved** to `src/integrations/lc-framework.js`. |
| `js/trading-api.js` | **Moved** to `src/integrations/trading-api.js`. |
| `js/engine-backtest.js` | **Moved** to `src/backtest/engine-backtest.js`. |
| `js/engine-backtest-signals.js` | **Moved** to `src/backtest/engine-backtest-signals.js`. |
| `js/ui-tabs.js` | **Moved** to `src/ui/ui-tabs.js`. |
| `js/app.js` | **Moved** to `src/ui/app.js`. |

---

> **Note:** All "moved" files are identical copies of the originals. The only
> code changes made during this reorganization are:
> - Added `module.exports` guards (Node.js compatible) to `util-indicators.js`,
>   `util-format.js`, and `util-backtest.js` so they can be unit-tested with Jest.
> - Added the three previously-missing util scripts (`util-format.js`,
>   `util-backtest.js`, `util-export.js`) to the `<script>` load order in
>   `index.html` (they were referenced by `engine-backtest.js` but not loaded).
