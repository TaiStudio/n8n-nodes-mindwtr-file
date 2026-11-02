# Changelog

## 26.11.1

### Changed

- Every operation now returns the data in the **exact same JSON shape as the input**: a wrapper such as `data` (from the "Extract From File" node) stays in place, every extra input key (metadata, etc.) is kept untouched, and only `tasks`, `projects` and `settings` are updated. `settings` is only present when the input had it.
- **Get Many** operations now return that same shape with the list reduced to the entries matching the filters and limit (a "filtered base"), instead of a flat list of individual items. For subtasks, `tasks` contains the selected parent task with its subtasks.
- When "Always Output Data" is enabled, a failed operation keeps the input shape and adds an `error` key, so a failed run never replaces the data with a bare error object.
- The data stored as a JSON string in the input is handed back as a JSON string.
