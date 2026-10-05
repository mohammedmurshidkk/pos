ALTER TABLE `printers` ADD `connection` text DEFAULT 'network' NOT NULL;--> statement-breakpoint
ALTER TABLE `printers` ADD `system_name` text;