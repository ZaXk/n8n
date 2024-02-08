import { Service } from 'typedi';
import { DataSource, Repository } from '@n8n/typeorm';
import { Project } from '../entities/Project';

@Service()
export class ProjectRepository extends Repository<Project> {
	constructor(dataSource: DataSource) {
		super(Project, dataSource.manager);
	}

	async getPersonalProjectForUser(userId: string) {
		return await this.findOne({
			where: {
				type: 'personal',
				projectRelations: { userId },
			},
		});
	}

	async getPersonalProjectForUserOrFail(userId: string) {
		return await this.findOneOrFail({
			where: {
				type: 'personal',
				projectRelations: { userId },
			},
		});
	}

	async getPersonalProjectForUsers(userIds: string[]) {
		return await this.find({
			where: {
				type: 'personal',
				projectRelations: { userId: In(userIds) },
			},
		});
	}
}
