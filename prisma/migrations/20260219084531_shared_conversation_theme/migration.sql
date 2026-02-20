/*
  Warnings:

  - You are about to drop the column `userId` on the `ConversationTheme` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "ConversationTheme" DROP CONSTRAINT "ConversationTheme_userId_fkey";

-- DropIndex
DROP INDEX "ConversationTheme_conversationId_userId_key";

-- AlterTable
ALTER TABLE "ConversationTheme" DROP COLUMN "userId";
