-- CreateTable
CREATE TABLE "ConversationTheme" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bgColor" TEXT,
    "textColor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationTheme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTheme_conversationId_userId_key" ON "ConversationTheme"("conversationId", "userId");

-- AddForeignKey
ALTER TABLE "ConversationTheme" ADD CONSTRAINT "ConversationTheme_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTheme" ADD CONSTRAINT "ConversationTheme_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
