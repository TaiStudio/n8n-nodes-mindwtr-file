import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface ISubtask {
	id: string;
	title: string;
	status?: string;
	createdAt?: string;
	updatedAt?: string;
}

interface ITask {
	id: string;
	title: string;
	status: string;
	tags?: string[];
	contexts?: string[];
	projectId?: string;
	createdAt?: string;
	updatedAt?: string;
	dueDate?: string;
	subtasks?: ISubtask[];
}

interface IProject {
	id: string;
	title: string;
	status: string;
	color?: string;
	createdAt?: string;
	updatedAt?: string;
}

interface IDb {
	tasks: ITask[];
	projects: IProject[];
	settings: IDataObject;
}

/** Anything in the input file that can be referenced by ID or by name */
interface INamedEntity {
	id: string;
	title: string;
}

const MAX_LISTED_ENTITIES = 20;

function normalizeName(value: string | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

/** Human readable list of entities, used so errors double as a "list" of available names */
function formatEntityList(entities: INamedEntity[]): string {
	if (entities.length === 0) {
		return '(none)';
	}
	const shown = entities
		.slice(0, MAX_LISTED_ENTITIES)
		.map((entity) => `"${entity.title}" [${entity.id}]`);
	const remaining = entities.length - MAX_LISTED_ENTITIES;
	return remaining > 0 ? `${shown.join(', ')} and ${remaining} more` : shown.join(', ');
}

function findEntityMatches<T extends INamedEntity>(entities: T[], reference: string): T[] {
	const byId = entities.filter((entity) => entity.id === reference);
	if (byId.length > 0) {
		return byId;
	}

	const name = normalizeName(reference);
	const byName = entities.filter((entity) => normalizeName(entity.title) === name);
	if (byName.length > 0) {
		return byName;
	}

	return entities.filter((entity) => normalizeName(entity.title).includes(name));
}

/**
 * Resolves a reference that can either be an ID or a name taken from the binary file
 * on input (exact ID, then exact name, then a single name containing the reference).
 *
 * Returns `undefined` when the reference is empty, so the caller can fall back to
 * auto-detection from the input item.
 */
function resolveReference<T extends INamedEntity>(
	ctx: IExecuteFunctions,
	itemIndex: number,
	entities: T[],
	reference: string,
	entityLabel: string,
	context = '',
): T | undefined {
	const value = (reference ?? '').trim();
	if (!value) {
		return undefined;
	}

	const plural = `${entityLabel}s`;
	const matches = findEntityMatches(entities, value);

	if (matches.length === 1) {
		return matches[0];
	}

	if (matches.length > 1) {
		throw new NodeOperationError(
			ctx.getNode(),
			`${entityLabel} reference "${value}"${context} matches several entries. Matching ${plural}: ${formatEntityList(
				matches,
			)}. Use a more specific name or the exact ID.`,
			{ itemIndex },
		);
	}

	throw new NodeOperationError(
		ctx.getNode(),
		`${entityLabel} with ID or name "${value}"${context} not found in the input file. Available ${plural}: ${formatEntityList(
			entities,
		)}.`,
		{ itemIndex },
	);
}

/** Same as `resolveReference`, but fails when nothing was provided at all */
function resolveRequired<T extends INamedEntity>(
	ctx: IExecuteFunctions,
	itemIndex: number,
	entities: T[],
	reference: string,
	entityLabel: string,
	context = '',
): T {
	const match = resolveReference(ctx, itemIndex, entities, reference, entityLabel, context);
	if (match) {
		return match;
	}

	throw new NodeOperationError(
		ctx.getNode(),
		`No ${entityLabel.toLowerCase()} selected${context}: enter its ID or name, or connect an input item that provides one.`,
		{ itemIndex },
	);
}

export class Mindwtr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Mindwtr',
		name: 'mindwtr',
		icon: { light: 'file:mindwtr.svg', dark: 'file:mindwtr.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage Mindwtr tasks, projects, and subtasks via binary JSON file',
		defaults: {
			name: 'Mindwtr',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Project',
						value: 'project',
						description: 'Manage projects',
					},
					{
						name: 'Subtask',
						value: 'subtask',
						description: 'Manage subtasks',
					},
					{
						name: 'Task',
						value: 'task',
						description: 'Manage tasks',
					},
				],
				default: 'task',
			},
			// ----------------------------------------
			// Task Operations
			// ----------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['task'],
					},
				},
				options: [
					{
						name: 'Attach to Project',
						value: 'attach',
						action: 'Attach a task to a project',
						description: 'Attach a task to a specific project',
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Create a task',
						description: 'Create a new task',
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a task',
						description: 'Delete an existing task',
					},
					{
						name: 'Detach From Project',
						value: 'detach',
						action: 'Detach a task from a project',
						description: 'Remove project association from a task',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many tasks',
						description: 'Retrieve many tasks',
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a task',
						description: 'Update an existing task',
					},
					{
						name: 'Validate',
						value: 'validate',
						action: 'Validate a task',
						description: 'Mark a task as completed',
					},
				],
				default: 'create',
			},
			// ----------------------------------------
			// Project Operations
			// ----------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['project'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a project',
						description: 'Create a new project',
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a project',
						description: 'Delete an existing project',
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a project',
						description: 'Update an existing project',
					},
				],
				default: 'create',
			},
			// ----------------------------------------
			// Subtask Operations
			// ----------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['subtask'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a subtask',
						description: 'Create a new subtask for a task',
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a subtask',
						description: 'Delete an existing subtask',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many subtasks',
						description: 'Retrieve many subtasks of a task',
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a subtask',
						description: 'Update an existing subtask',
					},
					{
						name: 'Validate',
						value: 'validate',
						action: 'Validate a subtask',
						description: 'Mark a subtask as completed',
					},
				],
				default: 'create',
			},

			// ========================================
			// TASK FIELDS
			// ========================================
			{
				displayName: 'Task ID or Name',
				name: 'taskId',
				type: 'string',
				default: '',
				placeholder: 'ID or name',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['update', 'delete', 'validate', 'attach', 'detach'],
					},
				},
				description:
					'ID or name of the target task, as found in the file on input. Leave empty to auto-detect it from the input item.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['create'],
					},
				},
				description: 'Title of the new task',
			},
			{
				displayName: 'Project ID or Name',
				name: 'projectId',
				type: 'string',
				default: '',
				placeholder: 'ID or name',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['attach'],
					},
				},
				description:
					'ID or name of the project to attach the task to, as found in the file on input. Leave empty to auto-detect it from the input item.',
			},
			{
				displayName: 'Completed',
				name: 'completed',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['validate'],
					},
				},
				description: 'Whether the task is completed',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getAll'],
					},
				},
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getAll'],
						returnAll: [false],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getAll'],
					},
				},
				options: [
					{
						displayName: 'Project ID or Name',
						name: 'projectId',
						type: 'string',
						default: '',
						description: 'Filter by project ID or name, as found in the file on input',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Completed', value: 'completed' },
							{ name: 'Inbox', value: 'inbox' },
							{ name: 'Next', value: 'next' },
							{ name: 'Someday', value: 'someday' },
							{ name: 'Waiting', value: 'waiting' },
						],
						default: 'inbox',
						description: 'Filter by status',
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['create'],
					},
				},
				options: [
					{
						displayName: 'Contexts',
						name: 'contexts',
						type: 'string',
						default: '',
						description: 'Comma-separated list of contexts (e.g. @home,@work)',
					},
					{
						displayName: 'Due Date',
						name: 'dueDate',
						type: 'dateTime',
						default: '',
						description: 'Due date of the task',
					},
					{
						displayName: 'Project ID or Name',
						name: 'projectId',
						type: 'string',
						default: '',
						description: 'Project ID or name to associate with the task, as found in the file on input',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Completed', value: 'completed' },
							{ name: 'Inbox', value: 'inbox' },
							{ name: 'Next', value: 'next' },
							{ name: 'Someday', value: 'someday' },
							{ name: 'Waiting', value: 'waiting' },
						],
						default: 'inbox',
						description: 'Status of the task',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tags',
					},
				],
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['update'],
					},
				},
				options: [
					{
						displayName: 'Contexts',
						name: 'contexts',
						type: 'string',
						default: '',
						description: 'Comma-separated list of contexts',
					},
					{
						displayName: 'Due Date',
						name: 'dueDate',
						type: 'dateTime',
						default: '',
						description: 'Due date of the task',
					},
					{
						displayName: 'Project ID or Name',
						name: 'projectId',
						type: 'string',
						default: '',
						description:
							'Project ID or name associated with the task, as found in the file on input. Leave empty to detach the task from its project.',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Completed', value: 'completed' },
							{ name: 'Inbox', value: 'inbox' },
							{ name: 'Next', value: 'next' },
							{ name: 'Someday', value: 'someday' },
							{ name: 'Waiting', value: 'waiting' },
						],
						default: 'inbox',
						description: 'New status of the task',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tags',
					},
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						description: 'New title of the task',
					},
				],
			},

			// ========================================
			// PROJECT FIELDS
			// ========================================
			{
				displayName: 'Project ID or Name',
				name: 'projectId',
				type: 'string',
				default: '',
				placeholder: 'ID or name',
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['update', 'delete'],
					},
				},
				description:
					'ID or name of the target project, as found in the file on input. Leave empty to auto-detect it from the input item.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['create'],
					},
				},
				description: 'Title of the new project',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['create'],
					},
				},
				options: [
					{
						displayName: 'Color',
						name: 'color',
						type: 'color',
						default: '#3b82f6',
						description: 'Hex color code for the project',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'Archived', value: 'archived' },
							{ name: 'Completed', value: 'completed' },
						],
						default: 'active',
						description: 'Status of the project',
					},
				],
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['update'],
					},
				},
				options: [
					{
						displayName: 'Color',
						name: 'color',
						type: 'color',
						default: '',
						description: 'New hex color code for the project',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'Archived', value: 'archived' },
							{ name: 'Completed', value: 'completed' },
						],
						default: 'active',
						description: 'New status of the project',
					},
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						description: 'New title of the project',
					},
				],
			},

			// ========================================
			// SUBTASK FIELDS
			// ========================================
			{
				displayName: 'Task ID or Name',
				name: 'taskId',
				type: 'string',
				default: '',
				placeholder: 'ID or name',
				displayOptions: {
					show: {
						resource: ['subtask'],
						operation: ['create', 'update', 'delete', 'validate', 'getAll'],
					},
				},
				description:
					'ID or name of the parent task, as found in the file on input. Leave empty to auto-detect it from the input item.',
			},
			{
				displayName: 'Subtask ID or Name',
				name: 'subtaskId',
				type: 'string',
				default: '',
				placeholder: 'ID or name',
				displayOptions: {
					show: {
						resource: ['subtask'],
						operation: ['update', 'delete', 'validate'],
					},
				},
				description:
					'ID or name of the target subtask, as found in the file on input. Leave empty to auto-detect it from the input item.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['subtask'],
						operation: ['create', 'update'],
					},
				},
				description: 'Title of the subtask',
			},
			{
				displayName: 'Completed',
				name: 'completed',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						resource: ['subtask'],
						operation: ['validate'],
					},
				},
				description: 'Whether the subtask is completed',
			},

			// ========================================
			// OPTIONS / FILE
			// ========================================
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property containing the JSON file',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Shared DB state loaded once from binary data of the first item (or cached)
		let db: IDb | null = null;
		let sharedBinaryData!: IBinaryData;

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;

				const item = items[i];

				if (!db) {
					if (item.binary && item.binary[binaryPropertyName]) {
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
						db = JSON.parse(buffer.toString('utf8')) as IDb;
					} else {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${binaryPropertyName}" not found on input item`,
							{ itemIndex: i }
						);
					}
					db.tasks = db.tasks || [];
					db.projects = db.projects || [];
					db.settings = db.settings || {};
				}

				const now = new Date().toISOString();

				if (resource === 'task') {
					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = this.getNodeParameter('limit', i, 50) as number;
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;

						let tasks = db.tasks;

						if (filters.status) {
							tasks = tasks.filter((t) => t.status === filters.status);
						}
						if (filters.projectId) {
							const project = resolveRequired<IProject>(
								this,
								i,
								db.projects,
								filters.projectId as string,
								'Project',
							);
							tasks = tasks.filter((t) => t.projectId === project.id);
						}

						if (!returnAll) {
							tasks = tasks.slice(0, limit);
						}

						for (const task of tasks) {
							returnData.push({
								json: task as unknown as IDataObject,
								pairedItem: { item: i },
							});
						}
						continue;
					} else if (operation === 'create') {
						const title = this.getNodeParameter('title', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

						const tagsStr = (additionalFields.tags as string) || '';
						const contextsStr = (additionalFields.contexts as string) || '';

						const newTask: ITask = {
							id: 't_' + Date.now() + Math.random().toString(36).substring(2, 7),
							title,
							status: (additionalFields.status as string) || 'inbox',
							tags: tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [],
							contexts: contextsStr ? contextsStr.split(',').map((c) => c.trim()).filter(Boolean) : [],
							createdAt: now,
							updatedAt: now,
						};

						if (additionalFields.projectId) {
							const project = resolveRequired<IProject>(
								this,
								i,
								db.projects,
								additionalFields.projectId as string,
								'Project',
							);
							newTask.projectId = project.id;
						}
						if (additionalFields.dueDate) {
							newTask.dueDate = additionalFields.dueDate as string;
						}

						db.tasks.push(newTask);
					} else if (operation === 'update') {
						const taskRef =
							(this.getNodeParameter('taskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');

						if (updateFields.title) task.title = updateFields.title as string;
						if (updateFields.status) task.status = updateFields.status as string;
						if (updateFields.projectId !== undefined) {
							if (updateFields.projectId === '') {
								delete task.projectId;
							} else {
								const project = resolveRequired<IProject>(
									this,
									i,
									db.projects,
									updateFields.projectId as string,
									'Project',
								);
								task.projectId = project.id;
							}
						}
						if (updateFields.contexts !== undefined) {
							const contextsStr = (updateFields.contexts as string) || '';
							task.contexts = contextsStr ? contextsStr.split(',').map((c) => c.trim()).filter(Boolean) : [];
						}
						if (updateFields.tags !== undefined) {
							const tagsStr = (updateFields.tags as string) || '';
							task.tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
						}
						if (updateFields.dueDate !== undefined) {
							if (updateFields.dueDate === '') {
								delete task.dueDate;
							} else {
								task.dueDate = updateFields.dueDate as string;
							}
						}
						task.updatedAt = now;
					} else if (operation === 'delete') {
						const taskRef =
							(this.getNodeParameter('taskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');
						db.tasks = db.tasks.filter((t) => t.id !== task.id);
					} else if (operation === 'validate') {
						const taskRef =
							(this.getNodeParameter('taskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const completed = this.getNodeParameter('completed', i, true) as boolean;

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');

						task.status = completed ? 'completed' : 'inbox';
						task.updatedAt = now;
					} else if (operation === 'attach') {
						const taskRef =
							(this.getNodeParameter('taskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const projectRef =
							(this.getNodeParameter('projectId', i, '') as string).trim() ||
							(item.json.projectId as string) ||
							(item.json.id as string) ||
							'';

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');
						const project = resolveRequired<IProject>(this, i, db.projects, projectRef, 'Project');

						task.projectId = project.id;
						task.updatedAt = now;
					} else if (operation === 'detach') {
						const taskRef =
							(this.getNodeParameter('taskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');

						delete task.projectId;
						task.updatedAt = now;
					}
				} else if (resource === 'project') {
					if (operation === 'create') {
						const title = this.getNodeParameter('title', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

						const newProject: IProject = {
							id: 'p_' + Date.now() + Math.random().toString(36).substring(2, 7),
							title,
							status: (additionalFields.status as string) || 'active',
							color: (additionalFields.color as string) || '#3b82f6',
							createdAt: now,
							updatedAt: now,
						};

						db.projects.push(newProject);
					} else if (operation === 'update') {
						const projectRef =
							(this.getNodeParameter('projectId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.projectId as string) ||
							'';
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

						const project = resolveRequired<IProject>(this, i, db.projects, projectRef, 'Project');

						if (updateFields.title) project.title = updateFields.title as string;
						if (updateFields.status) project.status = updateFields.status as string;
						if (updateFields.color) project.color = updateFields.color as string;
						project.updatedAt = now;
					} else if (operation === 'delete') {
						const projectRef =
							(this.getNodeParameter('projectId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.projectId as string) ||
							'';
						const project = resolveRequired<IProject>(this, i, db.projects, projectRef, 'Project');
						db.projects = db.projects.filter((p) => p.id !== project.id);
						for (const task of db.tasks) {
							if (task.projectId === project.id) {
								delete task.projectId;
								task.updatedAt = now;
							}
						}
					}
				} else if (resource === 'subtask') {
					const taskRef =
						(this.getNodeParameter('taskId', i, '') as string).trim() ||
						(item.json.taskId as string) ||
						(item.json.id as string) ||
						'';
					const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');
					task.subtasks = task.subtasks || [];

					if (operation === 'getAll') {
						const subtasks = task.subtasks || [];
						for (const subtask of subtasks) {
							returnData.push({
								json: subtask as unknown as IDataObject,
								pairedItem: { item: i },
							});
						}
						continue;
					} else if (operation === 'create') {
						const title = this.getNodeParameter('title', i) as string;
						const newSubtask: ISubtask = {
							id: 'st_' + Date.now() + Math.random().toString(36).substring(2, 7),
							title,
							status: 'needsAction',
							createdAt: now,
							updatedAt: now,
						};
						task.subtasks.push(newSubtask);
						task.updatedAt = now;
					} else if (operation === 'update') {
						const subtaskRef =
							(this.getNodeParameter('subtaskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.subtaskId as string) ||
							'';
						const title = this.getNodeParameter('title', i) as string;

						const subtask = resolveRequired<ISubtask>(
							this,
							i,
							task.subtasks,
							subtaskRef,
							'Subtask',
							` in task "${task.id}"`,
						);
						if (title) subtask.title = title;
						subtask.updatedAt = now;
						task.updatedAt = now;
					} else if (operation === 'delete') {
						const subtaskRef =
							(this.getNodeParameter('subtaskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.subtaskId as string) ||
							'';
						const subtask = resolveRequired<ISubtask>(
							this,
							i,
							task.subtasks,
							subtaskRef,
							'Subtask',
							` in task "${task.id}"`,
						);
						task.subtasks = task.subtasks.filter((st) => st.id !== subtask.id);
						task.updatedAt = now;
					} else if (operation === 'validate') {
						const subtaskRef =
							(this.getNodeParameter('subtaskId', i, '') as string).trim() ||
							(item.json.id as string) ||
							(item.json.subtaskId as string) ||
							'';
						const completed = this.getNodeParameter('completed', i, true) as boolean;

						const subtask = resolveRequired<ISubtask>(
							this,
							i,
							task.subtasks,
							subtaskRef,
							'Subtask',
							` in task "${task.id}"`,
						);
						subtask.status = completed ? 'completed' : 'needsAction';
						subtask.updatedAt = now;
						task.updatedAt = now;
					}
				}

				const jsonString = JSON.stringify(db, null, 2);
				sharedBinaryData = await this.helpers.prepareBinaryData(
					Buffer.from(jsonString, 'utf8'),
					'data.json',
					'application/json'
				);

				item.json = { ...db };
				item.binary = item.binary || {};
				item.binary[binaryPropertyName] = sharedBinaryData;

				returnData.push({
					json: item.json,
					binary: item.binary,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
