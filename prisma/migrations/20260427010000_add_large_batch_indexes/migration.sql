CREATE INDEX `NewsletterBatch_siteId_idx` ON `NewsletterBatch`(`siteId`);
CREATE INDEX `NewsletterBatch_batchId_idx` ON `NewsletterBatch`(`batchId`);

CREATE INDEX `NewsletterMessages_newsletterBatchId_idx` ON `NewsletterMessages`(`newsletterBatchId`);
CREATE INDEX `NewsletterErrors_newsletterBatchId_idx` ON `NewsletterErrors`(`newsletterBatchId`);

CREATE INDEX `NewsletterNotifications_type_timestamp_idx` ON `NewsletterNotifications`(`type`, `timestamp`);
CREATE INDEX `NewsletterNotifications_timestamp_idx` ON `NewsletterNotifications`(`timestamp`);
