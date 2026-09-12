ALTER TABLE `order_items` ADD `batch_ref` text;--> statement-breakpoint
CREATE INDEX `order_items_batch_idx` ON `order_items` (`batch_ref`);