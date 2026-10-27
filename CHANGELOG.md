# Changelog

## 26.10.14 - 2026-10-27

### Added

- "From list" mode on every ID field (task, project, subtask), including the ones nested in
  filters, additional fields and update fields. The list is built from the data given by the new
  "List Source" parameter, which defaults to the binary file on input (`={{ $binary.data }}`).
- Subtasks are listed under the task they belong to, and are narrowed down to the selected task
  when one is set.
- `Get Many` operation on the Project resource, with the same "Return All" / "Limit" options as
  the other resources.

### Changed

- ID fields are now resource locators: they still accept a typed ID or name (existing workflows
  keep working), and can also be picked from the list.

### Notes

- The list is resolved by the editor, so the workflow has to have been run once (or an execution
  opened) before a list can be shown.
- n8n only hands the content of a binary file to expressions when it keeps binary data in memory.
  On a default installation ("filesystem" mode), point "List Source" at the data itself (for
  example the `$json` of a node that already outputs it), or run n8n with
  `N8N_DEFAULT_BINARY_DATA_MODE=memory`.
