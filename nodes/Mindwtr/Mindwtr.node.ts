import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
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

function getParamValue(executeFn: IExecuteFunctions, parameterName: string, i: number): string {
	const raw = executeFn.getNodeParameter(parameterName, i);
	if (typeof raw === 'string') return raw;
	if (raw && typeof raw === 'object' && 'value' in raw) {
		return (raw as IDataObject).value as string || '';
	}
	return '';
}

function getDbFromContext(): IDb {
	return {
		tasks: [
			{ id: 't1', title: 'Call Mom', status: 'inbox' },
			{ id: 't2', title: 'Process email inbox', status: 'next' },
			{ id: 't3', title: 'Draft project proposal', status: 'next', projectId: 'p1' },
			{ id: 't4', title: 'Buy paint samples', status: 'next', projectId: 'p2' },
			{ id: 't5', title: 'Waiting for design approval', status: 'waiting', projectId: 'p1' },
			{ id: 't6', title: 'Learn to play guitar', status: 'someday' },
			{ id: 't7', title: 'Weekly Grocery Run', status: 'next' },
		],
		projects: [
			{ id: 'p1', title: 'Website Redesign', status: 'active' },
			{ id: 'p2', title: 'Home Renovation', status: 'active' },
		],
		settings: {},
	};
}

export class Mindwtr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Mindwtr',
		name: 'mindwtr',
		icon: { light: 'file:mindwtr.svg', dark: 'file:mindwtr.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage Mindwtr tasks, projects, and subtasks via JSON file',
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
				displayName: 'Task',
				name: 'taskId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['update', 'delete', 'validate', 'attach', 'detach'],
					},
				},
				description: 'Select or enter the target task',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'getTasks',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 't1',
					},
				],
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
				displayName: 'Project',
				name: 'projectId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['attach'],
					},
				},
				description: 'The project to attach the task to',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'getProjects',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'p1',
					},
				],
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
						displayName: 'Project ID',
						name: 'projectId',
						type: 'string',
						default: '',
						description: 'Filter by project ID',
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
						displayName: 'Project ID',
						name: 'projectId',
						type: 'string',
						default: '',
						description: 'Project ID to associate with the task',
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
						displayName: 'Project ID',
						name: 'projectId',
						type: 'string',
						default: '',
						description: 'Project ID associated with the task',
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
				displayName: 'Project',
				name: 'projectId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['project'],
						operation: ['update', 'delete'],
					},
				},
				description: 'Select or enter the target project',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'getProjects',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'p1',
					},
				],
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
				displayName: 'Task',
				name: 'taskId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['subtask'],
						operation: ['create', 'update', 'delete', 'validate', 'getAll'],
					},
				},
				description: 'Select or enter the parent task',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'getTasks',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 't1',
					},
				],
			},
			{
				displayName: 'Subtask',
				name: 'subtaskId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['subtask'],
						operation: ['update', 'delete', 'validate'],
					},
				},
				description: 'Select or enter the target subtask',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: {
							searchListMethod: 'getSubtasks',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'st1',
					},
				],
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

	methods = {
		listSearch: {
			async getProjects(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
				const db = getDbFromContext();
				return {
					results: db.projects.map((p) => ({
						name: `${p.title} (${p.id})`,
						value: p.id,
					})),
				};
			},
			async getTasks(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
				const db = getDbFromContext();
				return {
					results: db.tasks.map((t) => ({
						name: `${t.title} (${t.id}) - [${t.status}]`,
						value: t.id,
					})),
				};
			},
			async getSubtasks(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
				const db = getDbFromContext();
				let taskId = '';
				const rawTaskId = this.getNodeParameter('taskId', 0);
				if (typeof rawTaskId === 'string') {
					taskId = rawTaskId;
				} else if (rawTaskId && typeof rawTaskId === 'object' && 'value' in rawTaskId) {
					taskId = (rawTaskId as IDataObject).value as string || '';
				}

				const task = db.tasks.find((t) => t.id === taskId);
				const subtasks = task?.subtasks || [];
				return {
					results: subtasks.map((st) => ({
						name: `${st.title} (${st.id})`,
						value: st.id,
					})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;

				const item = items[i];
				let db: IDb;

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
							tasks = tasks.filter((t) => t.projectId === filters.projectId);
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
							newTask.projectId = additionalFields.projectId as string;
						}
						if (additionalFields.dueDate) {
							newTask.dueDate = additionalFields.dueDate as string;
						}

						db.tasks.push(newTask);
					} else if (operation === 'update') {
						const taskId = getParamValue(this, 'taskId', i);
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

						const task = db.tasks.find((t) => t.id === taskId);
						if (!task) {
							throw new NodeOperationError(this.getNode(), `Task with ID "${taskId}" not found`, { itemIndex: i });
						}

						if (updateFields.title) task.title = updateFields.title as string;
						if (updateFields.status) task.status = updateFields.status as string;
						if (updateFields.projectId !== undefined) {
							if (updateFields.projectId === '') {
								delete task.projectId;
							} else {
								task.projectId = updateFields.projectId as string;
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
						const taskId = getParamValue(this, 'taskId', i);
						const initialLength = db.tasks.length;
						db.tasks = db.tasks.filter((t) => t.id !== taskId);
						if (db.tasks.length === initialLength) {
							throw new NodeOperationError(this.getNode(), `Task with ID "${taskId}" not found`, { itemIndex: i });
						}
					} else if (operation === 'validate') {
						const taskId = getParamValue(this, 'taskId', i);
						const completed = this.getNodeParameter('completed', i, true) as boolean;

						const task = db.tasks.find((t) => t.id === taskId);
						if (!task) {
							throw new NodeOperationError(this.getNode(), `Task with ID "${taskId}" not found`, { itemIndex: i });
						}

						task.status = completed ? 'completed' : 'inbox';
						task.updatedAt = now;
					} else if (operation === 'attach') {
						const taskId = getParamValue(this, 'taskId', i);
						const projectId = getParamValue(this, 'projectId', i);

						const task = db.tasks.find((t) => t.id === taskId);
						if (!task) {
							throw new NodeOperationError(this.getNode(), `Task with ID "${taskId}" not found`, { itemIndex: i });
						}

						const project = db.projects.find((p) => p.id === projectId);
						if (!project) {
							throw new NodeOperationError(this.getNode(), `Project with ID "${projectId}" not found`, { itemIndex: i });
						}

						task.projectId = projectId;
						task.updatedAt = now;
					} else if (operation === 'detach') {
						const taskId = getParamValue(this, 'taskId', i);

						const task = db.tasks.find((t) => t.id === taskId);
						if (!task) {
							throw new NodeOperationError(this.getNode(), `Task with ID "${taskId}" not found`, { itemIndex: i });
						}

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
						const projectId = getParamValue(this, 'projectId', i);
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

						const project = db.projects.find((p) => p.id === projectId);
						if (!project) {
							throw new NodeOperationError(this.getNode(), `Project with ID "${projectId}" not found`, { itemIndex: i });
						}

						if (updateFields.title) project.title = updateFields.title as string;
						if (updateFields.status) project.status = updateFields.status as string;
						if (updateFields.color) project.color = updateFields.color as string;
						project.updatedAt = now;
					} else if (operation === 'delete') {
						const projectId = getParamValue(this, 'projectId', i);
						const initialLength = db.projects.length;
						db.projects = db.projects.filter((p) => p.id !== projectId);
						if (db.projects.length === initialLength) {
							throw new NodeOperationError(this.getNode(), `Project with ID "${projectId}" not found`, { itemIndex: i });
						}
						for (const task of db.tasks) {
							if (task.projectId === projectId) {
								delete task.projectId;
								task.updatedAt = now;
							}
						}
					}
				} else if (resource === 'subtask') {
					const taskId = getParamValue(this, 'taskId', i);
					const task = db.tasks.find((t) => t.id === taskId);
					if (!task) {
						throw new NodeOperationError(this.getNode(), `Task with ID "${taskId}" not found`, { itemIndex: i });
					}
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
						const subtaskId = getParamValue(this, 'subtaskId', i);
						const title = this.getNodeParameter('title', i) as string;

						const subtask = task.subtasks.find((st) => st.id === subtaskId);
						if (!subtask) {
							throw new NodeOperationError(this.getNode(), `Subtask with ID "${subtaskId}" not found in task "${taskId}"`, { itemIndex: i });
						}
						if (title) subtask.title = title;
						subtask.updatedAt = now;
						task.updatedAt = now;
					} else if (operation === 'delete') {
						const subtaskId = getParamValue(this, 'subtaskId', i);
						const initialLen = task.subtasks.length;
						task.subtasks = task.subtasks.filter((st) => st.id !== subtaskId);
						if (task.subtasks.length === initialLen) {
							throw new NodeOperationError(this.getNode(), `Subtask with ID "${subtaskId}" not found in task "${taskId}"`, { itemIndex: i });
						}
						task.updatedAt = now;
					} else if (operation === 'validate') {
						const subtaskId = getParamValue(this, 'subtaskId', i);
						const completed = this.getNodeParameter('completed', i, true) as boolean;

						const subtask = task.subtasks.find((st) => st.id === subtaskId);
						if (!subtask) {
							throw new NodeOperationError(this.getNode(), `Subtask with ID "${subtaskId}" not found in task "${taskId}"`, { itemIndex: i });
						}
						subtask.status = completed ? 'completed' : 'needsAction';
						subtask.updatedAt = now;
						task.updatedAt = now;
					}
				}

				const jsonString = JSON.stringify(db, null, 2);
				item.json = { ...db };
				item.binary = item.binary || {};
				item.binary[binaryPropertyName] = await this.helpers.prepareBinaryData(
					Buffer.from(jsonString, 'utf8'),
					'data.json',
					'application/json'
				);

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
