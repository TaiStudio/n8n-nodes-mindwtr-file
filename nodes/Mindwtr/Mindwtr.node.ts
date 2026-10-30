import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchItems,
	INodeListSearchResult,

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

/** Anything in the input data that can be referenced by ID or by name */
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
		`${entityLabel} with ID or name "${value}"${context} not found in the input data. Available ${plural}: ${formatEntityList(
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

// ==========================================================================
// Resource locator helpers: the ID fields can be filled from a list built
// out of the data present on the node's input.
// ==========================================================================

/** A page is small enough for the editor to scroll through without lagging */
const LIST_PAGE_SIZE = 100;

/**
 * Accepts whatever an ID field may hold: a resource locator object
 * (`{ mode, value }`), a plain string, or nothing at all.
 */
function toReference(value: unknown): string {
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value === 'number') {
		return String(value);
	}
	if (value !== null && typeof value === 'object') {
		const nested = (value as { value?: unknown }).value;
		if (typeof nested === 'string') {
			return nested.trim();
		}
		if (typeof nested === 'number') {
			return String(nested);
		}
	}
	return '';
}

/** Binary reference, as the editor resolves it from an expression such as `={{ $binary.data }}` */
interface IBinaryReference {
	data?: unknown;
	id?: unknown;
}

type IListSource = { db: IDb } | { error: string };

const LIST_SOURCE_NOT_SET =
	'The list could not read the input data. Set the "List Source" parameter below to the parsed data of the input item, e.g. `={{ $json }}`, then open the list again.';

const MINDWTR_DATA_INVALID =
	'The input data does not look like Mindwtr data: every task and project needs both an "id" and a "title".';

const MINDWTR_DATA_EMPTY =
	'No task or project was found in the input data. Run the workflow once, or pin the input data, so the editor can read it.';

/** Payload keys a node upstream may nest the data under, e.g. `{ data: … }` */
const LIST_SOURCE_WRAPPER_KEYS = ['data', 'json', 'body', 'result', 'output', 'content'] as const;

/** How deep wrappers are followed before giving up on the input data */
const MAX_WRAPPER_DEPTH = 3;

interface ICollectedEntities {
	tasks: unknown[];
	projects: unknown[];
	settings: IDataObject;
}

function isNamedEntity(value: unknown): value is INamedEntity {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as INamedEntity).id === 'string' &&
		typeof (value as INamedEntity).title === 'string'
	);
}

/**
 * Finds the tasks and projects inside whatever the input item holds: the data
 * itself, a bare list of tasks, a single task, or a payload nested under a
 * common key such as the `data` returned by the "Extract From File" node.
 */
function collectEntities(value: unknown, depth = 0): ICollectedEntities {
	if (depth > MAX_WRAPPER_DEPTH || value === null || typeof value !== 'object') {
		return { tasks: [], projects: [], settings: {} };
	}

	if (Array.isArray(value)) {
		// Either a bare list of entities, or one wrapper per input item
		const collected: ICollectedEntities = { tasks: [], projects: [], settings: {} };
		for (const entry of value) {
			const inner = collectEntities(entry, depth + 1);
			collected.tasks.push(...inner.tasks);
			collected.projects.push(...inner.projects);
			if (Object.keys(collected.settings).length === 0) {
				collected.settings = inner.settings;
			}
		}

		if (collected.tasks.length === 0 && value.length > 0 && value.every(isNamedEntity)) {
			collected.tasks.push(...value);
		}

		return collected;
	}

	const record = value as Record<string, unknown>;

	// The data itself
	if (Array.isArray(record.tasks) || Array.isArray(record.projects)) {
		const settings =
			typeof record.settings === 'object' && record.settings !== null
				? (record.settings as IDataObject)
				: {};
		return {
			tasks: record.tasks as unknown[],
			projects: (record.projects as unknown[]) ?? [],
			settings,
		};
	}

	// A single task or project on its own
	if (isNamedEntity(record)) {
		return { tasks: [record], projects: [], settings: {} };
	}

	// Something wrapping the data, e.g. `{ data: … }` from "Extract From File"
	for (const key of LIST_SOURCE_WRAPPER_KEYS) {
		if (key in record) {
			const inner = collectEntities(unwrapJsonValue(record[key]), depth + 1);
			if (inner.tasks.length > 0 || inner.projects.length > 0) {
				return inner;
			}
		}
	}

	return { tasks: [], projects: [], settings: {} };
}

/** A node upstream may hand the data over as a JSON string rather than an object */
function unwrapJsonValue(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}

	const trimmed = value.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
		return value;
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

/** Turns the parsed input data into the entities the lists are built from */
function parseMindwtrDb(raw: unknown): IListSource {
	const collected = collectEntities(raw);

	if (collected.tasks.length === 0 && collected.projects.length === 0) {
		return { error: MINDWTR_DATA_EMPTY };
	}

	if (!collected.tasks.every(isNamedEntity) || !collected.projects.every(isNamedEntity)) {
		return { error: MINDWTR_DATA_INVALID };
	}

	return {
		db: {
			tasks: collected.tasks as ITask[],
			projects: collected.projects as IProject[],
			settings: collected.settings,
		},
	};
}

function parseJsonBuffer(buffer: Buffer): IListSource {
	try {
		return parseMindwtrDb(JSON.parse(buffer.toString('utf8')));
	} catch {
		return { error: 'The input data could not be read as JSON.' };
	}
}

/**
 * Turns the resolved "List Source" parameter into the entities to list.
 *
 * The editor resolves the parameter before the list is requested, so the value is
 * already the input data of the item — the parsed JSON when it is exposed as such.
 * A binary reference is still accepted, as long as n8n keeps the bytes inline.
 */
async function resolveListSourceValue(raw: unknown): Promise<IListSource> {
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
			try {
				return await resolveListSourceValue(JSON.parse(trimmed));
			} catch {
				return { error: 'The input data could not be read as JSON.' };
			}
		}
		return { error: LIST_SOURCE_NOT_SET };
	}

	if (raw === null || typeof raw !== 'object') {
		return { error: LIST_SOURCE_NOT_SET };
	}

	if (Array.isArray(raw)) {
		return parseMindwtrDb(raw);
	}

	const reference = raw as IBinaryReference;
	const inlineData = typeof reference.data === 'string' ? reference.data : '';
	const rawId = typeof reference.id === 'string' ? reference.id.trim() : '';

	// A binary reference, when the data has not been extracted into JSON yet
	if (inlineData !== '' && rawId !== '' && !Array.isArray((raw as Partial<IDb>).tasks)) {
		const separator = rawId.indexOf(':');
		const mode = separator === -1 ? '' : rawId.slice(0, separator);

		if (mode !== '' && mode !== 'filesystem' && mode !== 'filesystem-v2') {
			return parseJsonBuffer(Buffer.from(inlineData, 'base64'));
		}

		return {
			error:
				`The input file ("${rawId}") is kept by n8n in its "${mode}" binary data mode, where this node cannot read it. ` +
				'Extract the JSON with a node such as "Extract From File" and connect it to this node, or fill the ID fields by hand.',
		};
	}

	return parseMindwtrDb(raw);
}

/** Loads the input data once, then serves one page of the matching entries */
async function listFromInput(
	ctx: ILoadOptionsFunctions,
	filter: string | undefined,
	paginationToken: string | undefined,
	buildResults: (db: IDb, query: string) => INodeListSearchItems[],
): Promise<INodeListSearchResult> {
	const source = await resolveListSourceValue(ctx.getCurrentNodeParameter('listSource'));
	if ('error' in source) {
		return { results: [{ name: `⚠ ${source.error}`, value: '', disabled: true }] };
	}

	const query = (filter ?? '').trim().toLowerCase();
	const matching = buildResults(source.db, query);

	const offset = Number.parseInt(paginationToken ?? '', 10) || 0;
	const page = matching.slice(offset, offset + LIST_PAGE_SIZE);

	return {
		results: page,
		paginationToken:
			offset + page.length < matching.length ? String(offset + page.length) : undefined,
	};
}

function filterByQuery<T extends { name: string }>(items: T[], query: string): T[] {
	return query === '' ? items : items.filter((item) => item.name.toLowerCase().includes(query));
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
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many projects',
						description: 'Retrieve many projects',
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
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchTasks',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'ID or name',
					},
				],
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
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchProjects',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'ID or name',
					},
				],
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
						resource: ['task', 'project'],
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
						resource: ['task', 'project'],
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
						type: 'resourceLocator',
						default: { mode: 'list', value: '' },
						modes: [
							{
								displayName: 'From List',
								name: 'list',
								type: 'list',
								typeOptions: {
									searchListMethod: 'searchProjects',
									searchable: true,
								},
							},
							{
								displayName: 'ID',
								name: 'id',
								type: 'string',
								placeholder: 'ID or name',
							},
						],
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
						type: 'resourceLocator',
						default: { mode: 'list', value: '' },
						modes: [
							{
								displayName: 'From List',
								name: 'list',
								type: 'list',
								typeOptions: {
									searchListMethod: 'searchProjects',
									searchable: true,
								},
							},
							{
								displayName: 'ID',
								name: 'id',
								type: 'string',
								placeholder: 'ID or name',
							},
						],
						description:
							'Project ID or name to associate with the task, as found in the file on input',
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
						type: 'resourceLocator',
						default: { mode: 'list', value: '' },
						modes: [
							{
								displayName: 'From List',
								name: 'list',
								type: 'list',
								typeOptions: {
									searchListMethod: 'searchProjects',
									searchable: true,
								},
							},
							{
								displayName: 'ID',
								name: 'id',
								type: 'string',
								placeholder: 'ID or name',
							},
						],
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
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchProjects',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'ID or name',
					},
				],
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
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchTasks',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'ID or name',
					},
				],
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
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'searchSubtasks',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'ID or name',
					},
				],
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
				displayName: 'List Source',
				name: 'listSource',
				type: 'string',
				default: '={{ $json }}',
				description:
					'Input data used to fill the "From list" mode of the ID fields. Defaults to the whole input item; point it to a property of that item when the data is nested, e.g. the "data" property returned by the "Extract From File" node.',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description:
					'Name of the binary property to read the JSON file from, and to write the updated file back to. Only used when a file is still attached to the input item; ignored when the data already comes as JSON.',
			},
		],
	};

	methods = {
		listSearch: {
			async searchTasks(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await listFromInput(this, filter, paginationToken, (db, query) =>
					filterByQuery(
						db.tasks.map((task) => ({
							name: `${task.title} [${task.id}] (${task.status})`,
							value: task.id,
						})),
						query,
					),
				);
			},
			async searchProjects(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await listFromInput(this, filter, paginationToken, (db, query) =>
					filterByQuery(
						db.projects.map((project) => ({
							name: `${project.title} [${project.id}] (${project.status})`,
							value: project.id,
						})),
						query,
					),
				);
			},
			async searchSubtasks(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				// Subtasks of the selected task when there is one, every subtask otherwise
				const parentReference = toReference(this.getCurrentNodeParameter('taskId'));

				return await listFromInput(this, filter, paginationToken, (db, query) => {
					const parents =
						parentReference === '' ? db.tasks : findEntityMatches(db.tasks, parentReference);

					if (parents.length === 0) {
						return [
							{
								name: `⚠ Task reference "${parentReference}" was not found in the input data.`,
								value: '',
								disabled: true,
							},
						];
					}

					const subtasks = parents.flatMap((task) =>
						(task.subtasks ?? []).map((subtask) => ({
							name: `${task.title} > ${subtask.title} [${subtask.id}]`,
							value: subtask.id,
						})),
					);

					return filterByQuery(subtasks, query);
				});
			},
		},
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
						// No binary file: the data has been extracted into JSON upstream
						const parsed = parseMindwtrDb(item.json);
						if ('error' in parsed) {
							throw new NodeOperationError(this.getNode(), parsed.error, { itemIndex: i });
						}
						db = parsed.db;
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
						const filterProjectRef = toReference(filters.projectId);
						if (filterProjectRef) {
							const project = resolveRequired<IProject>(
								this,
								i,
								db.projects,
								filterProjectRef,
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

						const additionalProjectRef = toReference(additionalFields.projectId);
						if (additionalProjectRef) {
							const project = resolveRequired<IProject>(
								this,
								i,
								db.projects,
								additionalProjectRef,
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
							toReference(this.getNodeParameter('taskId', i, '')) ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');

						if (updateFields.title) task.title = updateFields.title as string;
						if (updateFields.status) task.status = updateFields.status as string;
						if (updateFields.projectId !== undefined) {
							const updateProjectRef = toReference(updateFields.projectId);
							if (updateProjectRef === '') {
								delete task.projectId;
							} else {
								const project = resolveRequired<IProject>(
									this,
									i,
									db.projects,
									updateProjectRef,
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
							toReference(this.getNodeParameter('taskId', i, '')) ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');
						db.tasks = db.tasks.filter((t) => t.id !== task.id);
					} else if (operation === 'validate') {
						const taskRef =
							toReference(this.getNodeParameter('taskId', i, '')) ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const completed = this.getNodeParameter('completed', i, true) as boolean;

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');

						task.status = completed ? 'completed' : 'inbox';
						task.updatedAt = now;
					} else if (operation === 'attach') {
						const taskRef =
							toReference(this.getNodeParameter('taskId', i, '')) ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';
						const projectRef =
							toReference(this.getNodeParameter('projectId', i, '')) ||
							(item.json.projectId as string) ||
							(item.json.id as string) ||
							'';

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');
						const project = resolveRequired<IProject>(this, i, db.projects, projectRef, 'Project');

						task.projectId = project.id;
						task.updatedAt = now;
					} else if (operation === 'detach') {
						const taskRef =
							toReference(this.getNodeParameter('taskId', i, '')) ||
							(item.json.id as string) ||
							(item.json.taskId as string) ||
							'';

						const task = resolveRequired<ITask>(this, i, db.tasks, taskRef, 'Task');

						delete task.projectId;
						task.updatedAt = now;
					}
				} else if (resource === 'project') {
					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = this.getNodeParameter('limit', i, 50) as number;

						let projects = db.projects;
						if (!returnAll) {
							projects = projects.slice(0, limit);
						}

						for (const project of projects) {
							returnData.push({
								json: project as unknown as IDataObject,
								pairedItem: { item: i },
							});
						}
						continue;
					} else if (operation === 'create') {
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
							toReference(this.getNodeParameter('projectId', i, '')) ||
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
							toReference(this.getNodeParameter('projectId', i, '')) ||
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
						toReference(this.getNodeParameter('taskId', i, '')) ||
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
							toReference(this.getNodeParameter('subtaskId', i, '')) ||
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
							toReference(this.getNodeParameter('subtaskId', i, '')) ||
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
							toReference(this.getNodeParameter('subtaskId', i, '')) ||
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
