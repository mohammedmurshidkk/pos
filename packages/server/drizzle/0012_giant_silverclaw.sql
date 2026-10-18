ALTER TABLE `expenses` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `expenses` ADD `deleted_by` text REFERENCES employees(id);