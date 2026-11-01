CREATE TABLE `user_avatars` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` blob NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
