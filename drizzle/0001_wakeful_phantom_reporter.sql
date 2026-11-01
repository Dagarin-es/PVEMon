CREATE TABLE `notification_prefs` (
	`user_id` text NOT NULL,
	`element_id` text NOT NULL,
	`push` integer DEFAULT false NOT NULL,
	`email` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `element_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
