CREATE TABLE `rule_presets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `expression` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_presets_name_unique` ON `rule_presets` (`name`);
--> statement-breakpoint
INSERT INTO `rule_presets` (`name`, `expression`)
VALUES
  ('不低于官方价', 'own >= official'),
  ('不低于官方价 95%', 'own >= official * 0.95'),
  ('最多低 5 元', 'own >= official - 5');
