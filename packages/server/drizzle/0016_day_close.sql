CREATE TABLE `day_closes` (
	`id` text PRIMARY KEY NOT NULL,
	`counter_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`closed_at` integer NOT NULL,
	FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `shifts` ADD `day_close_id` text REFERENCES day_closes(id);
