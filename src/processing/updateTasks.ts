import {IAutomatonSteps, StepsOutput} from "./automaton";
import {PluginTask} from "../vaultSearcher/vaultSearcher";
import {ModelsTask} from "../../vikunja_sdk";
import {App, Notice} from "obsidian";
import VikunjaPlugin from "../../main";
import {Processor} from "./processor";

interface UpdatedSplit {
	tasksToUpdateInVault: PluginTask[];
	tasksToUpdateInVikunja: PluginTask[];
}

class UpdateTasks implements IAutomatonSteps {
	app: App;
	plugin: VikunjaPlugin;
	processor: Processor;

	constructor(app: App, plugin: VikunjaPlugin, processor: Processor) {
		this.app = app;
		this.plugin = plugin;
		this.processor = processor;
	}

	async step(localTasks: PluginTask[], vikunjaTasks: ModelsTask[]): Promise<StepsOutput> {
		if (this.plugin.settings.debugging) console.log("Step UpdateTask: Starting update tasks");
		const {
			tasksToUpdateInVault,
			tasksToUpdateInVikunja
		} = this.splitTaskAfterUpdatedStatus(localTasks, vikunjaTasks);
		if (this.plugin.settings.debugging) console.log("Step UpdateTask: Split tasks after updated status, outstanding updates in vault", tasksToUpdateInVault, "outstanding updates in vikunja", tasksToUpdateInVikunja);

		await this.updateTasks(tasksToUpdateInVault, tasksToUpdateInVikunja);

		return {localTasks, vikunjaTasks};
	}


	/*
	 * Split tasks into two groups:
	 * - tasksToUpdateInVault: Tasks which have updates in Vikunja
	 * - tasksToUpdateInVikunja: Tasks which have updates in the vault
	 *
	 * tasksToUpdateInVault has already all informations needed for vault update.
	 */
	private splitTaskAfterUpdatedStatus(localTasks: PluginTask[], vikunjaTasks: ModelsTask[]): UpdatedSplit {
		if (this.plugin.settings.debugging) console.log("Step UpdateTask: Find tasks which have updates on the other platform");

		let tasksToUpdateInVault: PluginTask[] = [];
		let tasksToUpdateInVikunja: PluginTask[] = [];
		for (const task of localTasks) {
			const vikunjaTask = vikunjaTasks.find(vikunjaTask => vikunjaTask.id === task.task.id);
			if (this.plugin.settings.debugging) console.log("Step UpdateTask: found Vikunja task", vikunjaTask, " for Vault task", task.task);
			if (!vikunjaTask) continue;
			if (!vikunjaTask || !vikunjaTask.updated || !task.task.updated) {
				if (this.plugin.settings.debugging) console.log("Step UpdateTask: updated field is not defined", task, vikunjaTask);
				throw new Error("Task updated field is not defined");
			}
			if (task.isTaskEqual(vikunjaTask)) {
				if (this.plugin.settings.debugging) console.log("Step UpdateTask: Task is the same in both platforms", task, vikunjaTask);
				continue;
			}

			let comparison;
			if (vikunjaTask.updated > task.task.updated) {
				task.task = vikunjaTask;
				tasksToUpdateInVault.push(task);
				comparison = "Vikunja";
			} else {
				tasksToUpdateInVikunja.push(task);
				comparison = "Vault";
			}
			if (this.plugin.settings.debugging) console.log(`Step UpdateTask: Task updated will be updated in ${comparison}, updated on vikunja`, vikunjaTask.updated, " updated on vault", task.task.updated);
		}

		return {
			tasksToUpdateInVault,
			tasksToUpdateInVikunja
		};
	}

	private areTasksEqual(local: ModelsTask, vikunja: ModelsTask) {
	}

	private async updateTasks(tasksToUpdateInVault: PluginTask[], tasksToUpdateInVikunja: PluginTask[]) {
		if (this.plugin.settings.debugging) console.log("Step UpdateTask: Updating tasks in vault and Vikunja");
		await this.updateTasksInVikunja(tasksToUpdateInVikunja);
		await this.updateTasksInVault(tasksToUpdateInVault);
	}

	private async updateTasksInVikunja(updateTasks: PluginTask[]) {
		if (this.plugin.settings.debugging) console.log("Step UpdateTask: Update tasks in vikunja");

		// Sequential: updateTask calls addLabelToTask -> getOrCreateLabels, which picks
		// what to create from an in-memory map. Run concurrently, tasks sharing a tag
		// each create their own copy, which is how nine tasks tagged #sync produced
		// nine duplicate "sync" labels. This path runs on every sync after the first,
		// so leaving it concurrent would reintroduce the duplicates indefinitely.
		const failures: {title: string, error: string}[] = [];
		for (const task of updateTasks) {
			try {
				const answer = await this.plugin.tasksApi.updateTask(task)
				if (this.plugin.settings.debugging) console.log("Step UpdateTask: Updated task in Vikunja", task, answer);
				task.task = answer;
				await this.updateTasksInVault([task]);
			} catch (error: any) {
				const title = task.task.title ?? "(untitled)";
				failures.push({title, error: error?.message ?? String(error)});
				console.error("Step UpdateTask: Failed to update task", title, error);
			}
		}

		if (failures.length > 0) {
			new Notice(`Vikunja Plugin: ${failures.length} of ${updateTasks.length} task update(s) failed. See console.`);
			console.error("Step UpdateTask: Failed updates", failures);
		}
	}

	private async updateTasksInVault(updateTasks: PluginTask[]) {
		if (this.plugin.settings.debugging) console.log("Step UpdateTask: Update tasks in vault");

		for (const task of updateTasks) {
			await this.processor.updateToVault(task);
		}
	}

}

export default UpdateTasks;
