import type { MigrationContext, IrreversibleMigration } from '@db/types';
import type { ProjectRole } from '@/databases/entities/ProjectRelation';
import type { User } from '@/databases/entities/User';
import { generateNanoId } from '@/databases/utils/generators';

const projectAdminRole: ProjectRole = 'project:personalOwner';
const projectTable = 'project';
const projectRelationTable = 'project_relation';

type Table = 'shared_workflow' | 'shared_credentials';

const resourceIdColumns: Record<Table, string> = {
	shared_credentials: 'credentialsId',
	shared_workflow: 'workflowId',
};

export class CreateProject1705928727784 implements IrreversibleMigration {
	async setupTables({ schemaBuilder: { createTable, column } }: MigrationContext) {
		await createTable(projectTable).withColumns(
			column('id').varchar(36).primary.notNull,
			column('name').varchar(255),
			column('type').varchar(36),
		).withTimestamps;

		await createTable(projectRelationTable)
			.withColumns(
				column('projectId').varchar(36).primary.notNull,
				column('userId').uuid.primary.notNull,
				column('role').varchar().notNull,
			)
			.withIndexOn('projectId')
			.withIndexOn('userId')
			.withForeignKey('projectId', {
				tableName: projectTable,
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withForeignKey('userId', {
				tableName: 'user',
				columnName: 'id',
				onDelete: 'CASCADE',
			}).withTimestamps;
	}

	async alterSharedTable(
		table: Table,
		{
			escape,
			isMysql,
			runQuery,
			schemaBuilder: { addForeignKey, addColumns, createIndex, column, dropIndex },
		}: MigrationContext,
	) {
		// Add projectId column, this is set to a blank string by default because it's a primary key
		const projectIdColumn = column('projectId').varchar(36).notNull;
		const projectIdColumnName = escape.columnName('projectId');
		const userIdColumnName = escape.columnName('userId');
		await addColumns(table, [projectIdColumn]);

		const tableName = escape.tableName(table);
		const projectName = escape.tableName(projectTable);
		const relationTableName = escape.tableName(projectRelationTable);
		// const resourceIdColumn = resourceIdColumns[table];

		// Populate projectId
		const subQuery = `
				SELECT P.id as ${projectIdColumnName}, T.${userIdColumnName}
				FROM ${relationTableName} T
				LEFT JOIN ${projectName} P
				ON T.${projectIdColumnName} = P.id AND P.type = 'personal'
				LEFT JOIN ${tableName} S
				ON T.${userIdColumnName} = S.${userIdColumnName}
				WHERE P.id IS NOT NULL
		`;
		const swQuery = isMysql
			? `UPDATE ${tableName}, (${subQuery}) as mapping
				    SET ${tableName}.${projectIdColumnName} = mapping.${projectIdColumnName}
				    WHERE ${tableName}.${userIdColumnName} = mapping.${userIdColumnName}`
			: `UPDATE ${tableName}
						SET ${projectIdColumnName} = mapping.${projectIdColumnName}
				    FROM (${subQuery}) as mapping
				    WHERE ${tableName}.${userIdColumnName} = mapping.${userIdColumnName}`;

		await runQuery(swQuery);

		await addForeignKey(table, 'projectId', ['project', 'id']);

		// Index the new projectId column
		await createIndex(table, ['projectId']);

		// Set up new composite unique index
		// await createIndex(table, ['projectId', resourceIdColumn], true);
		await runQuery(`
			CREATE TABLE "shared_credentials_2" (
				"createdAt"	datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
				"updatedAt"	datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
				"deprecatedUserId"	varchar NOT NULL,
				"credentialsId"	varchar(36) NOT NULL,
				"role"	text NOT NULL,
				"projectId"	varchar(36) NOT NULL,
				CONSTRAINT "FK_shared_credentials_credentials" FOREIGN KEY("credentialsId") REFERENCES "credentials_entity"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
				CONSTRAINT "FK_shared_credentials_projects" FOREIGN KEY("projectId") REFERENCES "project"("id"),
				CONSTRAINT "FK_shared_credentials_user" FOREIGN KEY("deprecatedUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
				PRIMARY KEY("projectId","credentialsId")
			);
		`);
		await runQuery('DROP TABLE shared_credentials');
		await runQuery('ALTER TABLE shared_credentials_2 RENAME TO shared_credentials;');
	}

	async createUserPersonalProjects({ runQuery, runInBatches, escape }: MigrationContext) {
		const userTable = escape.tableName('user');
		const projectName = escape.tableName(projectTable);
		const projectRelationName = escape.tableName('project_relation');
		const projectIdColumn = escape.columnName('projectId');
		const userIdColumn = escape.columnName('userId');
		const getUserQuery = `SELECT id FROM ${userTable}`;
		await runInBatches<Pick<User, 'id'>>(getUserQuery, async (users) => {
			await Promise.all(
				users.map(async (user) => {
					const projectId = generateNanoId();
					await runQuery(`INSERT INTO ${projectName} (id, type) VALUES (:projectId, 'personal')`, {
						projectId,
					});

					await runQuery(
						`INSERT INTO ${projectRelationName} (${projectIdColumn}, ${userIdColumn}, role) VALUES (:projectId, :userId, :projectRole)`,
						{
							projectId,
							userId: user.id,
							projectRole: projectAdminRole,
						},
					);
				}),
			);
		});
	}

	async up(context: MigrationContext) {
		await this.setupTables(context);
		await this.createUserPersonalProjects(context);
		await this.alterSharedTable('shared_credentials', context);
		await this.alterSharedTable('shared_workflow', context);
	}

	// TODO down migration
}
