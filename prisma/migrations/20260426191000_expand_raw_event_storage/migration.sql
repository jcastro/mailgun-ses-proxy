ALTER TABLE `NewsletterNotifications`
    MODIFY COLUMN `rawEvent` LONGTEXT NOT NULL;

ALTER TABLE `SystemMailNotifications`
    MODIFY COLUMN `rawEvent` LONGTEXT NOT NULL;
