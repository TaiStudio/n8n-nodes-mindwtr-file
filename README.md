# n8n-nodes-mindwtr-file

This is an n8n community node package that allows you to manage **Mindwtr** tasks, projects, and subtasks directly within your n8n workflows using a JSON database file.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

---

## Features

Manage your structured Mindwtr JSON database file across three main resources:

- **Task**: Create, update, delete, retrieve, validate (complete), attach to project, and detach from project.
- **Project**: Create, update, and delete projects (with status and color support).
- **Subtask**: Create, update, delete, retrieve, and validate subtasks within specific tasks.

## Installation

Follow the [official installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for n8n community nodes:

1. Go to **Settings > Community Nodes** in your n8n instance.
2. Select **Install**.
3. Enter `@taistudio/n8n-nodes-mindwtr-file` into the npm package name field.
4. Accept the risk disclaimer and click **Install**.

## How It Works

The Mindwtr node operates on a JSON file passed via an n8n binary property (default: `data`). 
1. Read a JSON file (e.g. from disk, S3, or HTTP) into binary data.
2. Pass it through the Mindwtr node to perform operations (create task, update project, validate subtask, etc.).
3. The node updates the JSON database structure and outputs both the updated JSON object and the updated file as binary data for subsequent nodes in your workflow.

### Referencing items by ID or by name

Every field that expects an ID (task, project or subtask) also accepts the **name** as found in the JSON file on input:

- exact name, case-insensitive (e.g. `website redesign`)
- or a single name containing what you typed (e.g. `redesign` → `Website Redesign`)
- the exact ID keeps working as before
- leaving the field empty still auto-detects the item from the input data

If the name is unknown or matches several items, the node fails with an error that lists every available name together with its ID, so the correct reference is always easy to find.

## Operations & Parameters

### 1. Task
- **Create**: Add a new task with title, status, contexts, tags, due date, and optional project ID or name.
- **Update**: Modify task title, status, project association, contexts, tags, or due date.
- **Delete**: Remove a task by its ID or name.
- **Get Many**: Retrieve tasks with filtering options (by status or project ID or name) and limit controls.
- **Validate**: Mark a task as completed or incomplete.
- **Attach to Project**: Assign a task to an existing project.
- **Detach From Project**: Remove project association from a task.

### 2. Project
- **Create**: Add a new project with title, status, and hex color code.
- **Update**: Modify project title, status, or color.
- **Delete**: Remove a project by its ID or name (and unassign any associated tasks).

### 3. Subtask
- **Create**: Add a subtask to a specific task.
- **Update**: Modify subtask title.
- **Delete**: Remove a subtask by ID or name.
- **Get Many**: Retrieve all subtasks for a given task.
- **Validate**: Mark a subtask as completed or incomplete.

## Credentials

This node does not require external API credentials, as it processes local or workflow-provided JSON files directly.

## Compatibility

- **n8n version**: v1.0.0 or higher
- **Node API Version**: 1
- **Strict Mode**: Enabled

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [GitHub Repository](https://github.com/TaiStudio/n8n-nodes-mindwtr-file)
- [Issue Tracker](https://github.com/TaiStudio/n8n-nodes-mindwtr-file/issues)

## License

[MIT License](LICENSE) © Tai Studio
