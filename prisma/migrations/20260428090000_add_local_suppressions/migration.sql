CREATE TABLE `SuppressedRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `source` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `lastEventType` VARCHAR(64) NULL,
    `lastMessageId` VARCHAR(255) NULL,
    `lastNewsletterBatchId` VARCHAR(191) NULL,
    `metadata` LONGTEXT NULL,
    `created` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SuppressedRecipient_siteId_email_key`(`siteId`, `email`),
    INDEX `SuppressedRecipient_siteId_active_idx`(`siteId`, `active`),
    INDEX `SuppressedRecipient_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
