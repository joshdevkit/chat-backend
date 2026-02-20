/*
  Warnings:

  - A unique constraint covering the columns `[conversationId]` on the table `ConversationTheme` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ConversationTheme_conversationId_key" ON "ConversationTheme"("conversationId");
