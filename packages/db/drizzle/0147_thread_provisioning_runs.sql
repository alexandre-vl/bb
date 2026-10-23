CREATE TABLE IF NOT EXISTS `thread_provisioning_runs` (
	`provisioning_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`project_id` text NOT NULL,
	`environment_provider_id` text NOT NULL,
	`machine_kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_provisioning_runs_project_estimate_idx` ON `thread_provisioning_runs` (`project_id`,`environment_provider_id`,`machine_kind`,`finished_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_provisioning_runs_estimate_idx` ON `thread_provisioning_runs` (`environment_provider_id`,`machine_kind`,`finished_at`);