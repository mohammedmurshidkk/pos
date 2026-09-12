PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`detail_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "employee_id", "action", "entity", "entity_id", "detail_json", "created_at") SELECT "id", "employee_id", "action", "entity", "entity_id", "detail_json", "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_ar` text,
	`kitchen_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kitchen_id`) REFERENCES `kitchens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name", "name_ar", "kitchen_id", "sort", "active", "created_at") SELECT "id", "name", "name_ar", "kitchen_id", "sort", "active", "created_at" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
CREATE TABLE `__new_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`printer_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_counters`("id", "name", "printer_id", "active", "created_at") SELECT "id", "name", "printer_id", "active", "created_at" FROM `counters`;--> statement-breakpoint
DROP TABLE `counters`;--> statement-breakpoint
ALTER TABLE `__new_counters` RENAME TO `counters`;--> statement-breakpoint
CREATE TABLE `__new_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "name", "phone", "created_at") SELECT "id", "name", "phone", "created_at" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `__new_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`pair_token` text NOT NULL,
	`default_counter_id` text,
	`last_seen` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`default_counter_id`) REFERENCES `counters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_devices`("id", "name", "type", "pair_token", "default_counter_id", "last_seen", "active", "created_at") SELECT "id", "name", "type", "pair_token", "default_counter_id", "last_seen", "active", "created_at" FROM `devices`;--> statement-breakpoint
DROP TABLE `devices`;--> statement-breakpoint
ALTER TABLE `__new_devices` RENAME TO `devices`;--> statement-breakpoint
CREATE TABLE `__new_employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text,
	`can_discount` integer DEFAULT false NOT NULL,
	`max_discount_percent` integer DEFAULT 0 NOT NULL,
	`can_save_without_kot` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_employees`("id", "name", "role", "pin_hash", "can_discount", "max_discount_percent", "can_save_without_kot", "active", "created_at") SELECT "id", "name", "role", "pin_hash", "can_discount", "max_discount_percent", "can_save_without_kot", "active", "created_at" FROM `employees`;--> statement-breakpoint
DROP TABLE `employees`;--> statement-breakpoint
ALTER TABLE `__new_employees` RENAME TO `employees`;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_category_id` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`paid_by` text NOT NULL,
	`shift_id` text,
	`paid_from_drawer` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`expense_category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_expenses`("id", "expense_category_id", "amount", "note", "paid_by", "shift_id", "paid_from_drawer", "created_at") SELECT "id", "expense_category_id", "amount", "note", "paid_by", "shift_id", "paid_from_drawer", "created_at" FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`name_ar` text,
	`price` integer NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "category_id", "name", "name_ar", "price", "is_available", "sort", "active", "created_at") SELECT "id", "category_id", "name", "name_ar", "price", "is_available", "sort", "active", "created_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `items` (`category_id`);--> statement-breakpoint
CREATE TABLE `__new_kitchens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_ar` text,
	`printer_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_kitchens`("id", "name", "name_ar", "printer_id", "active", "created_at") SELECT "id", "name", "name_ar", "printer_id", "active", "created_at" FROM `kitchens`;--> statement-breakpoint
DROP TABLE `kitchens`;--> statement-breakpoint
ALTER TABLE `__new_kitchens` RENAME TO `kitchens`;--> statement-breakpoint
CREATE TABLE `__new_kot_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`kitchen_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text DEFAULT 'new' NOT NULL,
	`lines_json` text NOT NULL,
	`printed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kitchen_id`) REFERENCES `kitchens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_kot_tickets`("id", "order_id", "kitchen_id", "seq", "kind", "lines_json", "printed_at", "created_at") SELECT "id", "order_id", "kitchen_id", "seq", "kind", "lines_json", "printed_at", "created_at" FROM `kot_tickets`;--> statement-breakpoint
DROP TABLE `kot_tickets`;--> statement-breakpoint
ALTER TABLE `__new_kot_tickets` RENAME TO `kot_tickets`;--> statement-breakpoint
CREATE INDEX `kot_order_idx` ON `kot_tickets` (`order_id`);--> statement-breakpoint
CREATE TABLE `__new_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`unit_price_snapshot` integer NOT NULL,
	`qty` integer NOT NULL,
	`modifiers_json` text DEFAULT '[]' NOT NULL,
	`note` text,
	`status` text DEFAULT 'new' NOT NULL,
	`kot_suppressed` integer DEFAULT false NOT NULL,
	`void_reason` text,
	`voided_by` text,
	`voided_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_order_items`("id", "order_id", "item_id", "name_snapshot", "unit_price_snapshot", "qty", "modifiers_json", "note", "status", "kot_suppressed", "void_reason", "voided_by", "voided_at", "created_by", "created_at") SELECT "id", "order_id", "item_id", "name_snapshot", "unit_price_snapshot", "qty", "modifiers_json", "note", "status", "kot_suppressed", "void_reason", "voided_by", "voided_at", "created_by", "created_at" FROM `order_items`;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_status_idx` ON `order_items` (`status`);--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`payment_mode_id` text NOT NULL,
	`amount` integer NOT NULL,
	`ref_no` text,
	`counter_id` text NOT NULL,
	`shift_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_mode_id`) REFERENCES `payment_modes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_payments`("id", "order_id", "payment_mode_id", "amount", "ref_no", "counter_id", "shift_id", "created_by", "created_at") SELECT "id", "order_id", "payment_mode_id", "amount", "ref_no", "counter_id", "shift_id", "created_by", "created_at" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_shift_idx` ON `payments` (`shift_id`);--> statement-breakpoint
CREATE TABLE `__new_print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`ref_id` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_print_jobs`("id", "printer_id", "kind", "payload_json", "status", "attempts", "last_error", "ref_id", "created_at", "completed_at") SELECT "id", "printer_id", "kind", "payload_json", "status", "attempts", "last_error", "ref_id", "created_at", "completed_at" FROM `print_jobs`;--> statement-breakpoint
DROP TABLE `print_jobs`;--> statement-breakpoint
ALTER TABLE `__new_print_jobs` RENAME TO `print_jobs`;--> statement-breakpoint
CREATE INDEX `print_jobs_status_idx` ON `print_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `print_jobs_printer_idx` ON `print_jobs` (`printer_id`);--> statement-breakpoint
CREATE TABLE `__new_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ip` text NOT NULL,
	`port` integer DEFAULT 9100 NOT NULL,
	`width` integer DEFAULT 80 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_printers`("id", "name", "ip", "port", "width", "enabled", "created_at") SELECT "id", "name", "ip", "port", "width", "enabled", "created_at" FROM `printers`;--> statement-breakpoint
DROP TABLE `printers`;--> statement-breakpoint
ALTER TABLE `__new_printers` RENAME TO `printers`;